# Claude Code 指令：城主設計器 MOD-10（Part 1/3）
## Keeper Designer Instructions — 資料庫 + Seed Data + API

> **給 Claude Code：** 請建立城主設計器，包含前後端兩部分：
> 1. **後端 API**：在 `packages/server/src/routes/` 新增城主相關 CRUD 端點
> 2. **前端頁面**：在 `packages/client/public/admin/admin-keeper-designer.html` 建立介面
>
> 本模組是「城主版的卡片設計器」，管理城主的兩種卡片：
> - **神話卡（Mythos Cards）**：城主的「手牌」，有行動點花費、發動時機限制、結構化效果
> - **遭遇卡（Encounter Cards）**：不同地點風格的神秘事件，有敘事與選擇分支
>
> 同時管理城主的行動點系統（全域遊戲平衡設定）。
>
> 資料存入 PostgreSQL。所有裝置打開同一個網址就能存取同一份資料。
>
> **視覺原則：** 與 MOD-01 卡片設計器一致 — 功能優先，樸素清楚，
> 遵守 admin-shared.css 的暗黑哥德色彩系統（深色背景、金色強調色）。
>
> **本文件為 Part 1/3，涵蓋：資料庫結構 + 全部 Seed Data + 後端 API。**
> Part 2 涵蓋：神話卡編輯區（含結構化效果語言編輯器）+ 遭遇卡編輯區。
> Part 3 涵蓋：AI 生成 + 總覽面板 + 遊戲平衡設定。

---

# 第一部分：資料庫結構

## 1.1 架構總覽

新增 6 張資料表：

| 表名 | 用途 |
|------|------|
| `mythos_cards` | 神話卡主表 |
| `mythos_card_effects` | 神話卡動作子表（每張卡可含 1–N 個動作） |
| `encounter_cards` | 遭遇卡主表 |
| `encounter_card_options` | 遭遇卡選項子表（2–3 個選項） |
| `encounter_card_tag_map` | 遭遇卡與地點風格標籤的多對多關聯 |
| `game_balance_settings` | 全域遊戲平衡參數（城主行動點公式、升階成本等） |

## 1.2 mythos_cards — 神話卡主表

```sql
CREATE TABLE mythos_cards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              VARCHAR(64) UNIQUE NOT NULL,     -- e.g. 'mc_follower_summon_cthulhu'
  name_zh           VARCHAR(128) NOT NULL,           -- e.g. '深淵呼喚'
  name_en           VARCHAR(128) NOT NULL,

  -- 描述（僅城主/設計師看得到，玩家看不到神話卡內容）
  description_zh    TEXT,
  description_en    TEXT,

  -- 行動點花費
  action_cost       INTEGER NOT NULL DEFAULT 1 CHECK (action_cost >= 0 AND action_cost <= 10),

  -- 發動時機
  activation_timing VARCHAR(32) NOT NULL DEFAULT 'keeper_phase'
                    CHECK (activation_timing IN (
                      'investigator_phase_reaction',  -- 調查員階段響應
                      'keeper_phase',                 -- 敵人階段使用
                      'both'                          -- 兩者皆可
                    )),

  -- 卡片類型分類（用於 UI 分組與統計）
  card_category     VARCHAR(32) NOT NULL DEFAULT 'general'
                    CHECK (card_category IN (
                      'summon',         -- 召喚類（召喚怪物）
                      'environment',    -- 環境類（改變地點狀態）
                      'status',         -- 狀態類（對調查員施加狀態）
                      'global',         -- 全場類（全場傷害、全場效果）
                      'agenda',         -- 議程類（推進議程）
                      'chaos_bag',      -- 混沌袋操作類
                      'encounter',      -- 遭遇牌堆操作類
                      'cancel',         -- 響應取消類（限調查員階段響應）
                      'narrative',      -- 純敘事事件
                      'general'         -- 其他/混合
                    )),

  -- 強度標籤（對應行動點花費範圍）
  intensity_tag     VARCHAR(16) NOT NULL DEFAULT 'small'
                    CHECK (intensity_tag IN (
                      'small',     -- 小型事件（1–2 點）
                      'medium',    -- 中型事件（3–4 點）
                      'large',     -- 大型事件（5–6 點）
                      'epic'       -- 史詩事件（7+ 點）
                    )),

  -- 響應類限定（僅調查員階段響應）
  response_trigger  VARCHAR(64),                      -- 觸發條件 e.g. 'investigator_attacks', 'investigator_moves'

  -- 敘事
  flavor_text_zh    TEXT,                             -- 風味文字（城主朗讀給玩家聽的敘事）
  flavor_text_en    TEXT,

  -- 視覺素材
  art_url           TEXT,

  -- 設計備註
  design_notes      TEXT,

  -- 中繼資料
  effect_count      INTEGER NOT NULL DEFAULT 0,       -- 動作數量（自動計算）
  sort_order        INTEGER NOT NULL DEFAULT 0,
  design_status     VARCHAR(16) NOT NULL DEFAULT 'draft'
                    CHECK (design_status IN ('draft', 'review', 'approved')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mythos_category ON mythos_cards(card_category);
CREATE INDEX idx_mythos_timing ON mythos_cards(activation_timing);
CREATE INDEX idx_mythos_intensity ON mythos_cards(intensity_tag);
CREATE INDEX idx_mythos_status ON mythos_cards(design_status);
```

## 1.3 mythos_card_effects — 神話卡動作子表

每張神話卡包含 1–N 個結構化動作。動作是城主的「行為原子」。

```sql
CREATE TABLE mythos_card_effects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mythos_card_id    UUID NOT NULL REFERENCES mythos_cards(id) ON DELETE CASCADE,

  -- 動作代碼（完整清單見 §2.1）
  action_code       VARCHAR(64) NOT NULL,
  -- e.g. 'summon_monster', 'spawn_at_location', 'advance_agenda',
  --      'environment_change', 'inflict_status', 'damage_all',
  --      'draw_encounter', 'modify_chaos_bag', 'cancel_player_action' 等

  -- 動作參數（JSON 格式，結構依動作代碼而定）
  action_params     JSONB NOT NULL DEFAULT '{}',
  -- 範例：
  -- summon_monster: { "family_code": "house_cthulhu", "quantity": 1, "base_tier": 1, "location_rule": "nearest_to_clue" }
  -- advance_agenda: { "doom_tokens": 2 }
  -- environment_change: { "change_type": "darkness", "target_location_rule": "all" }
  -- inflict_status: { "status_code": "madness", "value": 1, "target_rule": "lowest_san" }
  -- damage_all: { "damage_physical": 1, "damage_horror": 1, "target_rule": "all_investigators" }
  -- draw_encounter: { "count": 1, "resolve_immediately": true }
  -- modify_chaos_bag: { "operation": "add", "token_type": "cultist", "quantity": 1 }
  -- cancel_player_action: { "action_type": "attack", "additional_penalty": null }

  -- 執行順序（一張卡內多個動作的先後）
  sort_order        INTEGER NOT NULL DEFAULT 0,

  -- 動作的文字化描述（用於顯示在設計器和 AI 生成時的人類可讀版本）
  description_zh    TEXT,
  description_en    TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mythos_effects_card ON mythos_card_effects(mythos_card_id);
CREATE INDEX idx_mythos_effects_action ON mythos_card_effects(action_code);
```

## 1.4 encounter_cards — 遭遇卡主表

```sql
CREATE TABLE encounter_cards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              VARCHAR(64) UNIQUE NOT NULL,     -- e.g. 'ec_library_whispers'
  name_zh           VARCHAR(128) NOT NULL,           -- e.g. '書架間的低語'
  name_en           VARCHAR(128) NOT NULL,

  -- 情境描述（玩家看得到的主要敘事）
  scenario_text_zh  TEXT NOT NULL,
  scenario_text_en  TEXT,

  -- 遭遇類型
  encounter_type    VARCHAR(32) NOT NULL DEFAULT 'choice'
                    CHECK (encounter_type IN (
                      'thriller',       -- 驚悚（陷阱、突發事件）
                      'choice',         -- 選擇困境（道德抉擇）
                      'trade',          -- 交易（提供交換機會）
                      'puzzle',         -- 謎題（智力挑戰）
                      'social',         -- 社交（NPC 互動）
                      'discovery'       -- 發現（揭露隱藏資訊）
                    )),

  -- 視覺素材
  art_url           TEXT,

  -- 設計備註
  design_notes      TEXT,

  -- 中繼資料
  option_count      INTEGER NOT NULL DEFAULT 0,       -- 選項數量（自動計算）
  tag_count         INTEGER NOT NULL DEFAULT 0,       -- 標籤數量（自動計算）
  sort_order        INTEGER NOT NULL DEFAULT 0,
  design_status     VARCHAR(16) NOT NULL DEFAULT 'draft'
                    CHECK (design_status IN ('draft', 'review', 'approved')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_encounter_type ON encounter_cards(encounter_type);
CREATE INDEX idx_encounter_status ON encounter_cards(design_status);
```

## 1.5 encounter_card_options — 遭遇卡選項子表

每張遭遇卡有 2–3 個選項。每個選項有自己的敘事、檢定、結果。

```sql
CREATE TABLE encounter_card_options (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_card_id UUID NOT NULL REFERENCES encounter_cards(id) ON DELETE CASCADE,

  -- 選項標籤（A / B / C）
  option_label      VARCHAR(4) NOT NULL,              -- e.g. 'A', 'B', 'C'

  -- 選項敘事（玩家看到的選擇文字）
  option_text_zh    TEXT NOT NULL,
  option_text_en    TEXT,

  -- 檢定設定（若此選項需要檢定）
  requires_check    BOOLEAN NOT NULL DEFAULT TRUE,
  check_attribute   VARCHAR(16),                      -- 檢定屬性（七大屬性之一）
  check_dc          INTEGER,                          -- 檢定 DC

  -- 成功結果
  success_narrative_zh  TEXT,                         -- 成功尾聲敘事
  success_narrative_en  TEXT,
  success_effects       JSONB NOT NULL DEFAULT '[]',  -- 成功機制效果
  -- 格式: [{ "action_code": "gain_clue", "params": { "amount": 1 } }]

  -- 失敗結果
  failure_narrative_zh  TEXT,                         -- 失敗尾聲敘事
  failure_narrative_en  TEXT,
  failure_effects       JSONB NOT NULL DEFAULT '[]',  -- 失敗機制效果

  -- 無檢定選項的結果（requires_check = FALSE 時使用）
  no_check_narrative_zh TEXT,
  no_check_narrative_en TEXT,
  no_check_effects      JSONB NOT NULL DEFAULT '[]',

  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (encounter_card_id, option_label),
  CONSTRAINT chk_check_fields CHECK (
    (requires_check = FALSE) OR
    (requires_check = TRUE AND check_attribute IS NOT NULL AND check_dc IS NOT NULL)
  )
);

CREATE INDEX idx_encounter_options_card ON encounter_card_options(encounter_card_id);
```

## 1.6 encounter_card_tag_map — 遭遇卡與地點風格標籤關聯

遭遇卡的「地點風格標籤」直接呼叫 MOD-08 的 `location_style_tags` 表，不重複建立。

```sql
CREATE TABLE encounter_card_tag_map (
  encounter_card_id UUID NOT NULL REFERENCES encounter_cards(id) ON DELETE CASCADE,
  tag_id            UUID NOT NULL REFERENCES location_style_tags(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (encounter_card_id, tag_id)
);

CREATE INDEX idx_encounter_tag_map_card ON encounter_card_tag_map(encounter_card_id);
CREATE INDEX idx_encounter_tag_map_tag ON encounter_card_tag_map(tag_id);
```

## 1.7 game_balance_settings — 全域遊戲平衡參數

城主行動點公式、怪物升階成本等全域參數，集中管理方便調整。

```sql
CREATE TABLE game_balance_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key     VARCHAR(64) UNIQUE NOT NULL,      -- e.g. 'keeper_action_base_difficulty_1'
  setting_group   VARCHAR(32) NOT NULL,             -- e.g. 'keeper_action_points', 'monster_upgrade_costs'
  name_zh         VARCHAR(128) NOT NULL,
  name_en         VARCHAR(128),
  description_zh  TEXT,
  description_en  TEXT,

  -- 值（統一用 JSONB 以支援不同型態的設定）
  value           JSONB NOT NULL,
  -- 範例：
  -- { "type": "number", "value": 3 }
  -- { "type": "formula", "base": 3, "per_player": 2 }
  -- { "type": "table", "rows": [...] }

  -- 元數據
  value_type      VARCHAR(16) NOT NULL DEFAULT 'number'
                  CHECK (value_type IN ('number', 'formula', 'table', 'text')),
  is_editable     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_balance_group ON game_balance_settings(setting_group);
```

## 1.8 admin-shared.js 新增常數

```javascript
// 神話卡發動時機
const MYTHOS_ACTIVATION_TIMINGS = {
  investigator_phase_reaction: { name_zh: '調查員階段響應', name_en: 'Investigator Phase Reaction', note: '只能在調查員行動時響應觸發' },
  keeper_phase:                { name_zh: '敵人階段使用',   name_en: 'Keeper Phase',                note: '城主在敵人階段主動打出' },
  both:                        { name_zh: '兩者皆可',       name_en: 'Both',                        note: '任一階段都可使用' },
};

// 神話卡類型分類
const MYTHOS_CATEGORIES = {
  summon:      { name_zh: '召喚類',     name_en: 'Summon',      icon: '👁' },
  environment: { name_zh: '環境類',     name_en: 'Environment', icon: '🌫' },
  status:      { name_zh: '狀態類',     name_en: 'Status',      icon: '☠' },
  global:      { name_zh: '全場類',     name_en: 'Global',      icon: '🌀' },
  agenda:      { name_zh: '議程類',     name_en: 'Agenda',      icon: '⏰' },
  chaos_bag:   { name_zh: '混沌袋類',   name_en: 'Chaos Bag',   icon: '🎲' },
  encounter:   { name_zh: '遭遇牌堆類', name_en: 'Encounter',   icon: '🃏' },
  cancel:      { name_zh: '響應取消類', name_en: 'Cancel',      icon: '✋' },
  narrative:   { name_zh: '純敘事',     name_en: 'Narrative',   icon: '📖' },
  general:     { name_zh: '其他/混合',  name_en: 'General',     icon: '❓' },
};

// 神話卡強度標籤
const MYTHOS_INTENSITIES = {
  small:  { name_zh: '小型事件', name_en: 'Small',  cost_range: '1-2', color: '#5A5A52' },
  medium: { name_zh: '中型事件', name_en: 'Medium', cost_range: '3-4', color: '#4A7C9B' },
  large:  { name_zh: '大型事件', name_en: 'Large',  cost_range: '5-6', color: '#C9A84C' },
  epic:   { name_zh: '史詩事件', name_en: 'Epic',   cost_range: '7+',  color: '#B84C4C' },
};

// 遭遇卡類型
const ENCOUNTER_TYPES = {
  thriller:  { name_zh: '驚悚',       name_en: 'Thriller',  desc_zh: '陷阱、突發事件' },
  choice:    { name_zh: '選擇困境',   name_en: 'Choice',    desc_zh: '道德抉擇' },
  trade:     { name_zh: '交易',       name_en: 'Trade',     desc_zh: '提供交換機會' },
  puzzle:    { name_zh: '謎題',       name_en: 'Puzzle',    desc_zh: '智力挑戰' },
  social:    { name_zh: '社交',       name_en: 'Social',    desc_zh: 'NPC 互動' },
  discovery: { name_zh: '發現',       name_en: 'Discovery', desc_zh: '揭露隱藏資訊' },
};

// 神話卡動作代碼完整清單
const MYTHOS_ACTION_CODES = {
  // 召喚類
  summon_monster:         { category: 'summon',      name_zh: '召喚怪物',          params: ['family_code', 'quantity', 'base_tier', 'location_rule'] },
  spawn_at_location:      { category: 'summon',      name_zh: '在地點生成標記',     params: ['token_type', 'location_rule'] },

  // 議程類
  advance_agenda:         { category: 'agenda',      name_zh: '推進議程',          params: ['doom_tokens'] },
  reveal_act:             { category: 'agenda',      name_zh: '強制翻面目標牌堆',   params: [] },

  // 環境類
  environment_change:     { category: 'environment', name_zh: '環境改變',          params: ['change_type', 'target_location_rule'] },
  disconnect_location:    { category: 'environment', name_zh: '斷開地點連接',      params: ['location_rule'] },

  // 狀態類
  inflict_status:         { category: 'status',      name_zh: '施加狀態',          params: ['status_code', 'value', 'target_rule'] },
  remove_buff:            { category: 'status',      name_zh: '移除正面狀態',      params: ['buff_code', 'target_rule'] },

  // 全場類
  damage_all:             { category: 'global',      name_zh: '全場傷害',          params: ['damage_physical', 'damage_horror', 'target_rule'] },
  force_check_all:        { category: 'global',      name_zh: '全場強制檢定',      params: ['check_attribute', 'check_dc', 'failure_effect'] },

  // 混沌袋類
  modify_chaos_bag:       { category: 'chaos_bag',   name_zh: '混沌袋操作',        params: ['operation', 'token_type', 'quantity'] },

  // 遭遇牌堆類
  draw_encounter:         { category: 'encounter',   name_zh: '強制抽遭遇卡',      params: ['count', 'resolve_immediately'] },
  shuffle_encounter_deck: { category: 'encounter',   name_zh: '重洗遭遇牌堆',      params: [] },

  // 響應取消類
  cancel_player_action:   { category: 'cancel',      name_zh: '取消玩家行動',      params: ['action_type', 'additional_penalty'] },
  force_reroll:           { category: 'cancel',      name_zh: '強制重擲',          params: ['target_rule', 'use_worse_result'] },

  // 敘事類
  narrative_only:         { category: 'narrative',   name_zh: '純敘事',            params: ['text'] },
  set_flag:               { category: 'narrative',   name_zh: '設定旗標',          params: ['flag_key', 'flag_value'] },
};

// 目標規則（動作參數中的 target_rule / location_rule）
const TARGET_RULES = {
  all_investigators:      { name_zh: '所有調查員',           scope: 'investigator' },
  nearest_investigator:   { name_zh: '最近的調查員',         scope: 'investigator' },
  lowest_hp:              { name_zh: '血量最低的調查員',      scope: 'investigator' },
  lowest_san:             { name_zh: '理智最低的調查員',      scope: 'investigator' },
  most_clues:             { name_zh: '線索最多的調查員',      scope: 'investigator' },
  random_investigator:    { name_zh: '隨機調查員',           scope: 'investigator' },
  all_locations:          { name_zh: '所有地點',             scope: 'location' },
  nearest_to_clue:        { name_zh: '最靠近線索的地點',      scope: 'location' },
  random_location:        { name_zh: '隨機地點',             scope: 'location' },
  connected_locations:    { name_zh: '所有相連地點',         scope: 'location' },
  keeper_choice:          { name_zh: '城主選擇',             scope: 'both' },
};

// 遭遇卡選項效果的動作代碼
const ENCOUNTER_EFFECT_CODES = {
  gain_clue:       { name_zh: '獲得線索',       params: ['amount'] },
  lose_clue:       { name_zh: '失去線索',       params: ['amount'] },
  gain_resource:   { name_zh: '獲得資源',       params: ['amount'] },
  lose_resource:   { name_zh: '失去資源',       params: ['amount'] },
  damage:          { name_zh: '承受物理傷害',   params: ['amount'] },
  horror:          { name_zh: '承受恐懼傷害',   params: ['amount'] },
  heal_damage:     { name_zh: '回復 HP',       params: ['amount'] },
  heal_horror:     { name_zh: '回復 SAN',      params: ['amount'] },
  draw_card:       { name_zh: '抽牌',           params: ['amount'] },
  discard_card:    { name_zh: '棄牌',           params: ['amount', 'rule'] },
  gain_card:       { name_zh: '獲得特定卡片',   params: ['card_def_id'] },
  inflict_status:  { name_zh: '施加狀態',       params: ['status_code', 'value'] },
  remove_status:   { name_zh: '移除狀態',       params: ['status_code'] },
  set_flag:        { name_zh: '設定劇情旗標',   params: ['flag_key', 'flag_value'] },
  advance_agenda:  { name_zh: '推進議程',       params: ['doom_tokens'] },
  gain_xp:         { name_zh: '獲得經驗值',     params: ['amount'] },
  custom:          { name_zh: '自訂效果',       params: ['description'] },
};
```

---

# 第二部分：Seed Data

## 2.1 game_balance_settings 預設資料

```sql
-- === 城主行動點公式 ===

INSERT INTO game_balance_settings (setting_key, setting_group, name_zh, description_zh, value, value_type, sort_order) VALUES

-- 難度基礎點數
('keeper_action_base_difficulty_1', 'keeper_action_points', '難度 1（簡單）基礎點數',
 '關卡難度為 1 時，城主每回合獲得的基礎行動點',
 '{"value": 2}', 'number', 1),

('keeper_action_base_difficulty_2', 'keeper_action_points', '難度 2（標準）基礎點數',
 '關卡難度為 2 時，城主每回合獲得的基礎行動點',
 '{"value": 3}', 'number', 2),

('keeper_action_base_difficulty_3', 'keeper_action_points', '難度 3（困難）基礎點數',
 '關卡難度為 3 時，城主每回合獲得的基礎行動點',
 '{"value": 4}', 'number', 3),

('keeper_action_base_difficulty_4', 'keeper_action_points', '難度 4（專家）基礎點數',
 '關卡難度為 4 時，城主每回合獲得的基礎行動點',
 '{"value": 5}', 'number', 4),

('keeper_action_base_difficulty_5', 'keeper_action_points', '難度 5（噩夢）基礎點數',
 '關卡難度為 5 時，城主每回合獲得的基礎行動點',
 '{"value": 6}', 'number', 5),

-- 人數加成（從第 2 人開始計算）
('keeper_action_per_player', 'keeper_action_points', '人數加成',
 '每多一名玩家（從第 2 人開始），城主每回合額外獲得的行動點',
 '{"value": 2}', 'number', 6),

-- 行動點累積規則
('keeper_action_accumulation', 'keeper_action_points', '跨回合累積',
 '城主未花費的行動點是否可跨回合累積',
 '{"value": true}', 'number', 7),

('keeper_action_max_accumulation', 'keeper_action_points', '累積上限',
 '城主行動點的累積上限（0 = 無上限）',
 '{"value": 0}', 'number', 8);

-- === 怪物升階成本 ===

INSERT INTO game_balance_settings (setting_key, setting_group, name_zh, description_zh, value, value_type, sort_order) VALUES

('monster_upgrade_minion_to_threat', 'monster_upgrade_costs', '雜兵 → 威脅',
 '將召喚的怪物從雜兵升階為威脅，需額外支付的行動點',
 '{"value": 2}', 'number', 1),

('monster_upgrade_threat_to_elite', 'monster_upgrade_costs', '威脅 → 精英',
 '將召喚的怪物從威脅升階為精英，需額外支付的行動點',
 '{"value": 3}', 'number', 2),

('monster_upgrade_elite_to_boss', 'monster_upgrade_costs', '精英 → 頭目',
 '將召喚的怪物從精英升階為頭目，需額外支付的行動點',
 '{"value": 4}', 'number', 3),

('monster_upgrade_boss_to_titan', 'monster_upgrade_costs', '頭目 → 巨頭',
 '將召喚的怪物從頭目升階為巨頭，需額外支付的行動點（巨頭級需關卡設計允許）',
 '{"value": 5}', 'number', 4);
```

## 2.2 神話卡範例 Seed Data

建立若干範例神話卡供管理員參考設計方向。**這些範例可在生產環境保留作為基礎卡庫。**

```sql
-- 範例 1：深淵呼喚（召喚類，小型）
INSERT INTO mythos_cards (code, name_zh, name_en, description_zh, action_cost,
  activation_timing, card_category, intensity_tag, flavor_text_zh, design_status)
VALUES (
  'mc_deep_call', '深淵呼喚', 'Call of the Deep',
  '從深淵中召喚一隻克蘇魯眷族的怪物。',
  2, 'keeper_phase', 'summon', 'small',
  '鹹濕的風從遠方吹來，海浪聲中夾雜著某種古老的節奏——牠們來了。',
  'approved'
);

INSERT INTO mythos_card_effects (mythos_card_id, action_code, action_params, description_zh, sort_order)
VALUES (
  (SELECT id FROM mythos_cards WHERE code = 'mc_deep_call'),
  'summon_monster',
  '{"family_code": "house_cthulhu", "quantity": 1, "base_tier": 1, "location_rule": "nearest_to_clue"}',
  '從克蘇魯眷族池中召喚 1 隻雜兵級怪物於最靠近線索的地點',
  0
);

-- 範例 2：末日推進（議程類，小型）
INSERT INTO mythos_cards (code, name_zh, name_en, description_zh, action_cost,
  activation_timing, card_category, intensity_tag, flavor_text_zh, design_status)
VALUES (
  'mc_doom_advance', '末日推進', 'Doom Advance',
  '加速議程推進速度。',
  1, 'keeper_phase', 'agenda', 'small',
  '時鐘指針加速轉動，某種不祥的計畫正在成熟。',
  'approved'
);

INSERT INTO mythos_card_effects (mythos_card_id, action_code, action_params, description_zh, sort_order)
VALUES (
  (SELECT id FROM mythos_cards WHERE code = 'mc_doom_advance'),
  'advance_agenda',
  '{"doom_tokens": 2}',
  '議程牌堆放置 2 個毀滅標記',
  0
);

-- 範例 3：黑暗降臨（環境類，中型）
INSERT INTO mythos_cards (code, name_zh, name_en, description_zh, action_cost,
  activation_timing, card_category, intensity_tag, flavor_text_zh, design_status)
VALUES (
  'mc_darkness_falls', '黑暗降臨', 'Darkness Falls',
  '全場地點陷入黑暗，並對理智最低的調查員施加發瘋狀態。',
  3, 'keeper_phase', 'environment', 'medium',
  '光源一個接一個熄滅，彷彿被無形之物吞噬。有人開始聽見不該聽見的聲音。',
  'approved'
);

INSERT INTO mythos_card_effects (mythos_card_id, action_code, action_params, description_zh, sort_order)
VALUES
  ((SELECT id FROM mythos_cards WHERE code = 'mc_darkness_falls'),
   'environment_change',
   '{"change_type": "darkness", "target_location_rule": "all_locations"}',
   '所有地點進入黑暗狀態',
   0),
  ((SELECT id FROM mythos_cards WHERE code = 'mc_darkness_falls'),
   'inflict_status',
   '{"status_code": "madness", "value": 1, "target_rule": "lowest_san"}',
   '對理智最低的調查員施加 1 點發瘋狀態',
   1);

-- 範例 4：不祥預感（響應類，小型）
INSERT INTO mythos_cards (code, name_zh, name_en, description_zh, action_cost,
  activation_timing, card_category, intensity_tag, response_trigger, flavor_text_zh, design_status)
VALUES (
  'mc_ill_omen', '不祥預感', 'Ill Omen',
  '響應調查員的攻擊行動，強制其重擲並取較差結果。',
  2, 'investigator_phase_reaction', 'cancel', 'small',
  'investigator_attacks',
  '就在扣下扳機的瞬間，一股寒意從脊椎竄上。時間彷彿慢了下來，你聽見了自己的心跳，以及——另一個東西的心跳。',
  'approved'
);

INSERT INTO mythos_card_effects (mythos_card_id, action_code, action_params, description_zh, sort_order)
VALUES (
  (SELECT id FROM mythos_cards WHERE code = 'mc_ill_omen'),
  'force_reroll',
  '{"target_rule": "last_attacker", "use_worse_result": true}',
  '強制攻擊方重擲，取較差結果',
  0
);

-- 範例 5：瀰漫的瘋狂（全場類，中型）
INSERT INTO mythos_cards (code, name_zh, name_en, description_zh, action_cost,
  activation_timing, card_category, intensity_tag, flavor_text_zh, design_status)
VALUES (
  'mc_creeping_madness', '瀰漫的瘋狂', 'Creeping Madness',
  '所有調查員承受 1 點恐懼傷害。',
  4, 'keeper_phase', 'global', 'medium',
  '某種不可名狀的低語同時在每個人的耳邊響起，用的是他們最親近之人的聲音。',
  'approved'
);

INSERT INTO mythos_card_effects (mythos_card_id, action_code, action_params, description_zh, sort_order)
VALUES (
  (SELECT id FROM mythos_cards WHERE code = 'mc_creeping_madness'),
  'damage_all',
  '{"damage_physical": 0, "damage_horror": 1, "target_rule": "all_investigators"}',
  '所有調查員承受 1 點恐懼傷害',
  0
);
```

## 2.3 遭遇卡範例 Seed Data

```sql
-- 範例 1：書架間的低語（圖書館風格，選擇困境）
INSERT INTO encounter_cards (code, name_zh, name_en, scenario_text_zh, encounter_type, design_status)
VALUES (
  'ec_library_whispers', '書架間的低語', 'Whispers Between the Shelves',
  '你正在書架之間尋找線索，忽然從深處傳來若有似無的低語。仔細一聽，那聲音用的是你某位已故親人的口吻。',
  'choice', 'approved'
);

-- 附加地點風格標籤
INSERT INTO encounter_card_tag_map (encounter_card_id, tag_id)
SELECT
  (SELECT id FROM encounter_cards WHERE code = 'ec_library_whispers'),
  id FROM location_style_tags WHERE code IN ('indoor_library', 'indoor_mansion');

-- 選項 A：上前傾聽
INSERT INTO encounter_card_options (encounter_card_id, option_label, option_text_zh,
  requires_check, check_attribute, check_dc,
  success_narrative_zh, success_effects,
  failure_narrative_zh, failure_effects, sort_order)
VALUES (
  (SELECT id FROM encounter_cards WHERE code = 'ec_library_whispers'),
  'A', '上前傾聽聲音的來源',
  TRUE, 'willpower', 4,
  '你穩住心神，靠近那個聲音。在書架最深處的地上，你發現了一張泛黃的紙條——上面記載著某個你一直在追查的線索。',
  '[{"action_code":"gain_clue","params":{"amount":2}}]',
  '那聲音越來越清晰，開始呼喚你的名字。你試圖逃離，但某種無形的存在已經在你心裡扎根。',
  '[{"action_code":"horror","params":{"amount":2}},{"action_code":"inflict_status","params":{"status_code":"madness","value":1}}]',
  0
);

-- 選項 B：大聲驅趕
INSERT INTO encounter_card_options (encounter_card_id, option_label, option_text_zh,
  requires_check, check_attribute, check_dc,
  success_narrative_zh, success_effects,
  failure_narrative_zh, failure_effects, sort_order)
VALUES (
  (SELECT id FROM encounter_cards WHERE code = 'ec_library_whispers'),
  'B', '大聲念出驅魔咒文，驅趕這個幻象',
  TRUE, 'willpower', 6,
  '你的聲音響徹圖書館，低語戛然而止。你感覺到某種東西被迫退去，同時你的精神也得到了鍛鍊。',
  '[{"action_code":"heal_horror","params":{"amount":1}},{"action_code":"gain_xp","params":{"amount":1}}]',
  '你的咒文失敗了，而那個聲音現在在笑。笑聲充滿整個圖書館，其他調查員也聽見了。',
  '[{"action_code":"advance_agenda","params":{"doom_tokens":1}}]',
  1
);

-- 選項 C：迅速離開
INSERT INTO encounter_card_options (encounter_card_id, option_label, option_text_zh,
  requires_check,
  no_check_narrative_zh, no_check_effects, sort_order)
VALUES (
  (SELECT id FROM encounter_cards WHERE code = 'ec_library_whispers'),
  'C', '什麼都不聽，立刻離開這區域',
  FALSE,
  '你強迫自己轉身離開，耳邊的低語逐漸遠去。你感到一陣疲憊，但至少保住了理智。',
  '[{"action_code":"inflict_status","params":{"status_code":"fatigue","value":1}}]',
  2
);

-- 範例 2：墓地的呼喚（墓地風格，驚悚）
INSERT INTO encounter_cards (code, name_zh, name_en, scenario_text_zh, encounter_type, design_status)
VALUES (
  'ec_graveyard_call', '墓地的呼喚', 'Call from the Grave',
  '當你走過墓碑之間，一座新翻的墳墓突然開始震動。泥土從墓碑旁滑落，某種東西正從下方掙扎著要出來。',
  'thriller', 'approved'
);

INSERT INTO encounter_card_tag_map (encounter_card_id, tag_id)
SELECT
  (SELECT id FROM encounter_cards WHERE code = 'ec_graveyard_call'),
  id FROM location_style_tags WHERE code = 'outdoor_graveyard';

INSERT INTO encounter_card_options (encounter_card_id, option_label, option_text_zh,
  requires_check, check_attribute, check_dc,
  success_narrative_zh, success_effects,
  failure_narrative_zh, failure_effects, sort_order)
VALUES
  ((SELECT id FROM encounter_cards WHERE code = 'ec_graveyard_call'),
   'A', '拿起武器準備戰鬥',
   TRUE, 'agility', 4,
   '你迅速抽出武器擺好架式。從墳墓爬出的食屍鬼被你的氣勢震懾，轉身逃入夜色中。',
   '[{"action_code":"gain_xp","params":{"amount":1}}]',
   '你的反應太慢了。食屍鬼撲上來給了你一下，然後遁入地底。',
   '[{"action_code":"damage","params":{"amount":2}}]',
   0),

  ((SELECT id FROM encounter_cards WHERE code = 'ec_graveyard_call'),
   'B', '嘗試與它溝通',
   TRUE, 'charisma', 5,
   '令人意外地，它對你的話語有了反應。它用破碎的語言告訴你一些這片墓地的秘密。',
   '[{"action_code":"gain_clue","params":{"amount":2}},{"action_code":"horror","params":{"amount":1}}]',
   '它對你發出刺耳的嘶吼，然後撲向你的臉。',
   '[{"action_code":"damage","params":{"amount":1}},{"action_code":"horror","params":{"amount":2}}]',
   1);
```

---

# 第三部分：後端 API

在 `packages/server/src/routes/` 新增以下端點。
所有端點前綴：`/api/admin/keeper`

## 3.1 神話卡 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| GET | `/mythos-cards` | 列出所有神話卡（支援多條件篩選） |
| GET | `/mythos-cards/:id` | 取得單一神話卡完整資料（含所有動作） |
| POST | `/mythos-cards` | 新增神話卡 |
| PUT | `/mythos-cards/:id` | 更新神話卡基本資訊 |
| DELETE | `/mythos-cards/:id` | 刪除神話卡（連同所有動作） |
| POST | `/mythos-cards/:id/duplicate` | 複製神話卡 |

### GET /mythos-cards 查詢參數

| 參數 | 類型 | 說明 |
|------|------|------|
| `card_category` | string | 按類型篩選 |
| `activation_timing` | string | 按發動時機篩選 |
| `intensity_tag` | string | 按強度標籤篩選 |
| `action_cost_min` | integer | 最低行動點花費 |
| `action_cost_max` | integer | 最高行動點花費 |
| `design_status` | string | 按設計狀態篩選 |
| `search` | string | 名稱/描述關鍵字搜尋 |

### GET /mythos-cards/:id 回傳格式

```json
{
  "mythos_card": {
    "id": "uuid",
    "code": "mc_deep_call",
    "name_zh": "深淵呼喚",
    "name_en": "Call of the Deep",
    "description_zh": "...",
    "action_cost": 2,
    "activation_timing": "keeper_phase",
    "card_category": "summon",
    "intensity_tag": "small",
    "flavor_text_zh": "...",
    "design_status": "approved",
    "effect_count": 1,
    "effects": [
      {
        "id": "uuid",
        "action_code": "summon_monster",
        "action_params": {
          "family_code": "house_cthulhu",
          "quantity": 1,
          "base_tier": 1,
          "location_rule": "nearest_to_clue"
        },
        "description_zh": "從克蘇魯眷族池中召喚 1 隻雜兵級怪物於最靠近線索的地點",
        "sort_order": 0
      }
    ]
  }
}
```

## 3.2 神話卡動作管理 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| POST | `/mythos-cards/:id/effects` | 為神話卡新增動作 |
| PUT | `/mythos-effects/:effect_id` | 更新動作 |
| DELETE | `/mythos-effects/:effect_id` | 刪除動作 |
| PUT | `/mythos-cards/:id/effects/reorder` | 批次調整動作順序 |

## 3.3 遭遇卡 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| GET | `/encounter-cards` | 列出所有遭遇卡 |
| GET | `/encounter-cards/:id` | 取得單一遭遇卡完整資料（含選項、標籤） |
| POST | `/encounter-cards` | 新增遭遇卡 |
| PUT | `/encounter-cards/:id` | 更新遭遇卡基本資訊 |
| DELETE | `/encounter-cards/:id` | 刪除遭遇卡（連同選項、標籤關聯） |
| POST | `/encounter-cards/:id/duplicate` | 複製遭遇卡 |

### GET /encounter-cards 查詢參數

| 參數 | 類型 | 說明 |
|------|------|------|
| `encounter_type` | string | 按遭遇類型篩選 |
| `style_tag_code` | string | 按地點風格標籤篩選（可多值） |
| `design_status` | string | 按設計狀態篩選 |
| `search` | string | 名稱/情境關鍵字搜尋 |

### GET /encounter-cards/:id 回傳格式

```json
{
  "encounter_card": {
    "id": "uuid",
    "code": "ec_library_whispers",
    "name_zh": "書架間的低語",
    "scenario_text_zh": "...",
    "encounter_type": "choice",
    "design_status": "approved",
    "option_count": 3,
    "tags": [
      { "id": "uuid", "code": "indoor_library", "name_zh": "圖書館" }
    ],
    "options": [
      {
        "id": "uuid",
        "option_label": "A",
        "option_text_zh": "上前傾聽聲音的來源",
        "requires_check": true,
        "check_attribute": "willpower",
        "check_dc": 4,
        "success_narrative_zh": "...",
        "success_effects": [
          { "action_code": "gain_clue", "params": { "amount": 2 } }
        ],
        "failure_narrative_zh": "...",
        "failure_effects": [...]
      }
    ]
  }
}
```

## 3.4 遭遇卡選項管理 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| POST | `/encounter-cards/:id/options` | 為遭遇卡新增選項 |
| PUT | `/encounter-options/:option_id` | 更新選項 |
| DELETE | `/encounter-options/:option_id` | 刪除選項 |

驗證規則：每張遭遇卡最少 2 個選項，最多 3 個。

## 3.5 遭遇卡標籤管理 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| PUT | `/encounter-cards/:id/tags` | 批次設定遭遇卡的標籤（整組覆寫） |

## 3.6 全域遊戲平衡設定 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| GET | `/balance` | 列出所有平衡參數（按分組） |
| GET | `/balance/:setting_key` | 取得單一參數 |
| PUT | `/balance/:setting_key` | 更新參數值 |
| POST | `/balance/simulate` | 模擬計算（依當前參數算城主點數） |

### POST /balance/simulate 請求格式

```json
{
  "difficulty": 3,
  "player_count": 4,
  "rounds": 5
}
```

回傳格式：

```json
{
  "base_points": 4,
  "player_bonus": 6,
  "per_round_total": 10,
  "accumulated_after_rounds": [10, 20, 30, 40, 50],
  "formula_text": "基礎 4 點 + 人數加成 6 點 = 每回合 10 點"
}
```

## 3.7 統計 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| GET | `/stats/overview` | 全域統計 |
| GET | `/stats/mythos-coverage` | 神話卡類型與強度覆蓋 |
| GET | `/stats/encounter-coverage` | 遭遇卡類型與地點風格覆蓋 |

### GET /stats/overview 回傳格式

```json
{
  "mythos_cards": {
    "total": 5,
    "by_category": { "summon": 1, "environment": 1, "global": 1, "agenda": 1, "cancel": 1 },
    "by_intensity": { "small": 3, "medium": 2, "large": 0, "epic": 0 },
    "by_timing": { "keeper_phase": 4, "investigator_phase_reaction": 1, "both": 0 },
    "by_status": { "draft": 0, "review": 0, "approved": 5 }
  },
  "encounter_cards": {
    "total": 2,
    "by_type": { "choice": 1, "thriller": 1 },
    "by_status": { "draft": 0, "review": 0, "approved": 2 },
    "tag_coverage": { "indoor_library": 1, "indoor_mansion": 1, "outdoor_graveyard": 1 }
  }
}
```

## 3.8 AI 生成 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| POST | `/ai/generate-mythos-card` | 生成單張神話卡 |
| POST | `/ai/generate-encounter-card` | 生成單張遭遇卡 |
| POST | `/ai/generate-mythos-batch` | 批次生成神話卡（同主題一組） |

完整 Prompt 設計見 Part 3 §11。

## 3.9 後端驗證規則

1. **Code 唯一性**：所有神話卡與遭遇卡的 code 各自全域唯一
2. **神話卡行動點範圍**：`action_cost` 必須介於 0–10
3. **響應類動作限制**：`card_category = 'cancel'` 或 `activation_timing = 'investigator_phase_reaction'` 時，必須設定 `response_trigger`
4. **遭遇卡選項數量**：遭遇卡必須有 2–3 個選項（`design_status` 改為 `review` 或 `approved` 時檢查）
5. **遭遇卡標籤**：至少一個地點風格標籤（`design_status` 改為 `review` 或 `approved` 時檢查）
6. **動作參數驗證**：神話卡的 `mythos_card_effects.action_params` 需驗證是否符合該 `action_code` 的參數規格（見 §1.8 `MYTHOS_ACTION_CODES`）

---

> **Part 1 結束。**
> Part 2 將涵蓋：神話卡編輯區（含結構化效果語言編輯器）+ 遭遇卡編輯區。
> Part 3 將涵蓋：AI 生成完整 Prompt + 總覽面板 + 遊戲平衡設定介面。
