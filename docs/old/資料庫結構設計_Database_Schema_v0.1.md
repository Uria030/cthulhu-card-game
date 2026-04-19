# 資料庫結構設計 v0.1
## Database Schema Design v0.1

> **文件用途｜Purpose**
> 本文件定義專案的 PostgreSQL 資料庫結構，供後端開發直接引用。
> 設計原則：模組化邊界清晰、狀態持續可靠、反作弊驗證、人數縮放內建。
>
> **技術組合｜Tech Stack**
> - 資料庫：PostgreSQL（主資料）+ Redis（即時狀態 / 快取）
> - 後端：Node.js + Fastify + TypeScript
> - 前端：React + TypeScript
> - ORM：Prisma（建議）
>
> **協作分工備註｜Collaboration Note**
> 專案原創者 Uria 不具備資工相關背景，對技術實作完全不介入。Uria 的職責是確認**邏輯正確性**與**流程合理性** — 也就是「這個功能的行為是否符合設計原則」和「玩家體驗的流程是否正確」。所有技術層面的決策（框架選擇、資料庫結構細節、程式碼架構、效能優化、部署方案等）皆由開發者自行判斷與決定，只要最終產出符合《核心設計原則》和《數值規格文件》的設計意圖即可。

---

## 一、模組邊界與資料庫分區｜Module Boundaries

依據支柱 7（模組化架構），資料庫分為四大區域：

```
┌─────────────────────────────────────────────────────┐
│  PLATFORM（平台層）                                   │
│  users, sessions, teams                              │
├──────────────────────┬──────────────────────────────┤
│  INVESTIGATOR MODULE │  SCENARIO MODULE             │
│  調查員模組           │  場景模組                     │
│  investigators       │  campaigns                    │
│  cards (definitions) │  scenarios                    │
│  factions            │  locations                    │
│  proficiencies       │  encounters                   │
│  skill_trees         │  act_decks / agenda_decks     │
│                      │  story_branches               │
├──────────────────────┴──────────────────────────────┤
│  RUNTIME（運行時 — 遊戲進行中的狀態）                   │
│  campaign_states, investigator_states,               │
│  game_sessions, combat_states                        │
│  ※ 高頻讀寫部分使用 Redis                             │
├─────────────────────────────────────────────────────┤
│  TEAM（團隊層）                                       │
│  team_spirits, cohesion, milestones                  │
└─────────────────────────────────────────────────────┘
```

---

## 二、平台層 Schema｜Platform Layer

### 2.1 users — 玩家帳號

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(32) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(64),
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  is_banned     BOOLEAN NOT NULL DEFAULT FALSE,
  role          VARCHAR(16) NOT NULL DEFAULT 'player'
                CHECK (role IN ('player', 'creator', 'admin'))
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
```

### 2.2 teams — 固定組隊

```sql
CREATE TABLE teams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(64) NOT NULL,
  created_by    UUID NOT NULL REFERENCES users(id),
  cohesion      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE team_members (
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

-- 團隊精神投資（最多 7 種，每種最多 5 點）
CREATE TABLE team_spirits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  spirit_def_id UUID NOT NULL REFERENCES spirit_definitions(id),
  points        INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0 AND points <= 5),
  adopted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, spirit_def_id)
);

-- 團隊精神定義（候選池，目標 32 種）
CREATE TABLE spirit_definitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_zh       VARCHAR(64) NOT NULL,
  name_en       VARCHAR(64) NOT NULL,
  description   TEXT,
  milestone_name_zh VARCHAR(64),
  milestone_name_en VARCHAR(64),
  milestone_desc TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 已解鎖的團隊里程碑
CREATE TABLE team_milestones (
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  spirit_def_id UUID NOT NULL REFERENCES spirit_definitions(id),
  unlocked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, spirit_def_id)
);
```

---

## 三、調查員模組 Schema｜Investigator Module

### 3.1 factions — 陣營定義

```sql
CREATE TABLE factions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(32) UNIQUE NOT NULL,  -- e.g. 'academy', 'order', 'ring'
  name_zh       VARCHAR(64) NOT NULL,
  name_en       VARCHAR(64) NOT NULL,
  description   TEXT,
  play_style    TEXT,
  color_primary VARCHAR(7),   -- hex color
  color_secondary VARCHAR(7),
  icon_url      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.2 card_definitions — 卡片定義（模板）

```sql
-- 卡片類型枚舉
CREATE TYPE card_type AS ENUM (
  'asset',        -- 資產（裝備、盟友、道具）
  'event',        -- 事件（一次性效果）
  'skill',        -- 技能（檢定加值用）
  'weakness',     -- 弱點（負面卡）
  'revelation',   -- 神啟卡（詛咒）
  'signature'     -- 簽名卡（調查員專屬）
);

CREATE TYPE card_slot AS ENUM (
  'hand',         -- 手持
  'body',         -- 身體
  'accessory',    -- 配件
  'arcane',       -- 神秘
  'ally',         -- 盟友
  'none'          -- 無欄位
);

CREATE TABLE card_definitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(64) UNIQUE NOT NULL,   -- 唯一識別碼 e.g. 'core_45_automatic'
  name_zh       VARCHAR(128) NOT NULL,
  name_en       VARCHAR(128) NOT NULL,
  card_type     card_type NOT NULL,
  faction_id    UUID REFERENCES factions(id),  -- NULL = 中立卡
  slot          card_slot NOT NULL DEFAULT 'none',

  -- 費用
  cost          INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0 AND cost <= 6),
  cost_currency VARCHAR(32) NOT NULL DEFAULT 'resource',  -- 貨幣類型

  -- 卡面數值
  skill_value   INTEGER NOT NULL DEFAULT 0,    -- 當加值使用時的固定修正
  damage        INTEGER NOT NULL DEFAULT 0,    -- 造成的固定傷害
  horror        INTEGER NOT NULL DEFAULT 0,    -- 造成的恐懼傷害
  health_boost  INTEGER NOT NULL DEFAULT 0,    -- 提供的生命加成
  sanity_boost  INTEGER NOT NULL DEFAULT 0,    -- 提供的理智加成

  -- 武器相關
  ammo          INTEGER,                        -- 彈藥數（NULL = 非武器）
  weapon_tier   INTEGER CHECK (weapon_tier BETWEEN 1 AND 6),

  -- 檢定相關
  check_attribute VARCHAR(16),  -- 使用哪個屬性檢定
  check_modifier  INTEGER DEFAULT 0,  -- 裝備提供的檢定修正

  -- 消耗
  is_consumable BOOLEAN NOT NULL DEFAULT FALSE,  -- 使用後是否移除出遊戲
  uses          INTEGER,                          -- 可使用次數（NULL = 無限）

  -- 敘事
  flavor_text   TEXT,           -- 風味文字
  art_url       TEXT,

  -- 中繼資料
  level         INTEGER NOT NULL DEFAULT 0,      -- 卡片等級（用於升級路徑）
  xp_cost       INTEGER NOT NULL DEFAULT 0,      -- 經驗值花費
  is_unique     BOOLEAN NOT NULL DEFAULT FALSE,  -- 是否為獨特卡（場上只能有一張）
  hand_limit_mod INTEGER NOT NULL DEFAULT 0,     -- 對手牌上限的修改

  -- 版本控制
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cards_faction ON card_definitions(faction_id);
CREATE INDEX idx_cards_type ON card_definitions(card_type);
CREATE INDEX idx_cards_code ON card_definitions(code);
```

### 3.3 card_effects — 卡片效果（多對多）

```sql
CREATE TYPE effect_trigger AS ENUM (
  'on_play',        -- 打出時
  'on_commit',      -- 當加值投入時
  'on_consume',     -- 消費時
  'on_enter',       -- 進場時
  'on_leave',       -- 離場時
  'on_draw',        -- 被抽到時（神啟卡用）
  'on_success',     -- 檢定成功時
  'on_failure',     -- 檢定失敗時
  'reaction',       -- 反應觸發
  'passive',        -- 持續被動
  'free_action'     -- 免費行動
);

CREATE TABLE card_effects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_def_id     UUID NOT NULL REFERENCES card_definitions(id) ON DELETE CASCADE,
  trigger_type    effect_trigger NOT NULL,
  effect_code     VARCHAR(64) NOT NULL,    -- 效果識別碼，對應程式邏輯
  effect_params   JSONB NOT NULL DEFAULT '{}',  -- 效果參數
  description_zh  TEXT,
  description_en  TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_card_effects_card ON card_effects(card_def_id);
```

### 3.4 investigator_templates — 調查員模板（預設角色）

```sql
CREATE TABLE investigator_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(64) UNIQUE NOT NULL,
  name_zh         VARCHAR(64) NOT NULL,
  name_en         VARCHAR(64) NOT NULL,
  title_zh        VARCHAR(64),            -- 稱號 e.g. "聯邦探員"
  title_en        VARCHAR(64),
  faction_id      UUID NOT NULL REFERENCES factions(id),

  -- 基礎屬性
  attr_strength   INTEGER NOT NULL CHECK (attr_strength BETWEEN 1 AND 5),
  attr_agility    INTEGER NOT NULL CHECK (attr_agility BETWEEN 1 AND 5),
  attr_constitution INTEGER NOT NULL CHECK (attr_constitution BETWEEN 1 AND 5),
  attr_intellect  INTEGER NOT NULL CHECK (attr_intellect BETWEEN 1 AND 5),
  attr_willpower  INTEGER NOT NULL CHECK (attr_willpower BETWEEN 1 AND 5),
  attr_perception INTEGER NOT NULL CHECK (attr_perception BETWEEN 1 AND 5),
  attr_charisma   INTEGER NOT NULL CHECK (attr_charisma BETWEEN 1 AND 5),

  -- 總點數驗證（觸發器或應用層驗證 = 21）
  -- attr_strength + attr_agility + ... + attr_charisma = 21

  -- 戰鬥熟練
  proficiency_ids UUID[],   -- 初始擁有的戰鬥熟練

  -- 簽名卡與弱點
  signature_card_ids UUID[],    -- 簽名卡（2-3 張）
  weakness_card_id   UUID REFERENCES card_definitions(id),  -- 個人弱點（1 張）

  -- 敘事
  backstory       TEXT,
  ability_text_zh TEXT,
  ability_text_en TEXT,
  art_url         TEXT,

  -- 中繼資料
  is_official     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES users(id),  -- 社群創建者
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 確保總點數 = 21 的檢查約束
ALTER TABLE investigator_templates
ADD CONSTRAINT chk_total_points CHECK (
  attr_strength + attr_agility + attr_constitution +
  attr_intellect + attr_willpower + attr_perception +
  attr_charisma = 21
);
```

### 3.5 proficiency_definitions — 戰鬥熟練定義

```sql
CREATE TABLE proficiency_definitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(64) UNIQUE NOT NULL,   -- e.g. 'firearms', 'melee', 'arcane'
  name_zh       VARCHAR(64) NOT NULL,
  name_en       VARCHAR(64) NOT NULL,
  category      VARCHAR(32) NOT NULL,           -- 'combat', 'investigation', 'social'
  attribute     VARCHAR(16) NOT NULL,           -- 對應的主要屬性
  prof_bonus    INTEGER NOT NULL DEFAULT 1,     -- 熟練加成
  spec_bonus    INTEGER NOT NULL DEFAULT 2,     -- 專精加成
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 四、場景模組 Schema｜Scenario Module

### 4.1 campaigns — 戰役定義

```sql
CREATE TABLE campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(64) UNIQUE NOT NULL,
  name_zh         VARCHAR(128) NOT NULL,
  name_en         VARCHAR(128) NOT NULL,
  description     TEXT,
  chapter_count   INTEGER NOT NULL DEFAULT 10,
  difficulty      VARCHAR(16) NOT NULL DEFAULT 'standard'
                  CHECK (difficulty IN ('easy', 'standard', 'hard', 'nightmare')),
  min_players     INTEGER NOT NULL DEFAULT 1,
  max_players     INTEGER NOT NULL DEFAULT 4,
  is_official     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES users(id),
  art_url         TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.2 scenarios — 場景（章節）定義

```sql
CREATE TYPE scenario_type AS ENUM (
  'main',           -- 主線章節
  'side',           -- 支線關卡
  'side_return'     -- 支線重返
);

CREATE TABLE scenarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  code            VARCHAR(64) NOT NULL,
  name_zh         VARCHAR(128) NOT NULL,
  name_en         VARCHAR(128) NOT NULL,
  scenario_type   scenario_type NOT NULL DEFAULT 'main',
  chapter_number  INTEGER,                    -- 主線章節序號
  branch_key      VARCHAR(16),                -- 分支識別 e.g. '10A', '10B'
  description     TEXT,

  -- 混沌袋修改
  chaos_bag_mods  JSONB NOT NULL DEFAULT '[]',  -- 此場景對混沌袋的增減

  -- 重返機制
  return_count    INTEGER NOT NULL DEFAULT 0,   -- 已重返次數（模板設 0，運行時增加）
  difficulty_scaling JSONB NOT NULL DEFAULT '{}', -- 重返時的難度縮放參數

  -- 人數縮放
  scaling_rules   JSONB NOT NULL DEFAULT '{}',  -- 人數縮放參數

  -- 勝利條件與結果
  outcome_types   JSONB NOT NULL DEFAULT '["victory","defeat","partial"]',

  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, code)
);
```

### 4.3 locations — 地點

```sql
CREATE TABLE locations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id     UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  code            VARCHAR(64) NOT NULL,
  name_zh         VARCHAR(128) NOT NULL,
  name_en         VARCHAR(128) NOT NULL,
  description     TEXT,

  -- 地點屬性
  shroud          INTEGER NOT NULL DEFAULT 2,   -- 調查難度
  clues_base      INTEGER NOT NULL DEFAULT 1,   -- 基礎線索數
  clues_per_player BOOLEAN NOT NULL DEFAULT TRUE, -- 是否按人數縮放

  -- 連接
  connections     UUID[] NOT NULL DEFAULT '{}',  -- 連接的地點 ID 列表
  travel_cost     INTEGER NOT NULL DEFAULT 1,    -- 移動到此地的行動點花費

  -- 可搜索的卡片資源
  discoverable_cards JSONB NOT NULL DEFAULT '[]', -- 場景中可發現的卡片

  -- 進入效果
  enter_effects   JSONB NOT NULL DEFAULT '[]',

  art_url         TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (scenario_id, code)
);
```

### 4.4 encounter_definitions — 遭遇卡定義

```sql
CREATE TABLE encounter_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id     UUID REFERENCES scenarios(id) ON DELETE CASCADE,  -- NULL = 通用遭遇
  code            VARCHAR(64) NOT NULL,
  name_zh         VARCHAR(128) NOT NULL,
  name_en         VARCHAR(128) NOT NULL,
  encounter_type  VARCHAR(32) NOT NULL CHECK (encounter_type IN ('enemy', 'treachery', 'environment')),

  -- 敵人專用欄位
  enemy_tier      INTEGER CHECK (enemy_tier BETWEEN 1 AND 5),
  dc              INTEGER,
  hp_base         INTEGER,
  hp_per_player   INTEGER DEFAULT 0,
  damage          INTEGER,
  horror_damage   INTEGER DEFAULT 0,
  regen           INTEGER DEFAULT 0,
  special_abilities JSONB NOT NULL DEFAULT '[]',

  -- 敘事狀態描述（E-4 隱藏資訊）
  status_descriptions JSONB NOT NULL DEFAULT '{}',
  -- 格式: {"healthy": "牠看起來毫髮無傷", "wounded": "牠的動作開始遲緩", ...}

  -- 弱點與抗性
  vulnerabilities JSONB NOT NULL DEFAULT '{}',
  resistances     JSONB NOT NULL DEFAULT '{}',

  -- 行為模式
  behavior_pattern JSONB NOT NULL DEFAULT '{}',

  -- 戰鬥敘事（E-2）
  attack_narratives JSONB NOT NULL DEFAULT '[]',
  -- 格式: [{"action": "撲擊", "success": "...", "failure": "..."}, ...]

  quantity        INTEGER NOT NULL DEFAULT 1,  -- 遭遇牌堆中的數量
  art_url         TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.5 act_cards / agenda_cards — 行動牌堆與議程牌堆

```sql
CREATE TABLE act_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id     UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  sequence        INTEGER NOT NULL,
  name_zh         VARCHAR(128) NOT NULL,
  name_en         VARCHAR(128) NOT NULL,
  description     TEXT,
  clues_required  INTEGER NOT NULL DEFAULT 1,
  clues_per_player BOOLEAN NOT NULL DEFAULT TRUE,
  advance_effects JSONB NOT NULL DEFAULT '[]',
  branch_condition JSONB,  -- 分支判斷條件
  next_act_id     UUID REFERENCES act_cards(id),
  UNIQUE (scenario_id, sequence)
);

CREATE TABLE agenda_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id     UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  sequence        INTEGER NOT NULL,
  name_zh         VARCHAR(128) NOT NULL,
  name_en         VARCHAR(128) NOT NULL,
  description     TEXT,
  doom_threshold  INTEGER NOT NULL DEFAULT 5,
  advance_effects JSONB NOT NULL DEFAULT '[]',
  next_agenda_id  UUID REFERENCES agenda_cards(id),
  UNIQUE (scenario_id, sequence)
);
```

### 4.6 story_branches — 分支路線

```sql
CREATE TABLE story_branches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id     UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  outcome_key     VARCHAR(32) NOT NULL,       -- 'victory', 'defeat', 'partial'
  condition       JSONB NOT NULL DEFAULT '{}', -- 觸發條件
  next_scenario_id UUID REFERENCES scenarios(id),
  narrative_zh    TEXT,
  narrative_en    TEXT,
  rewards         JSONB NOT NULL DEFAULT '{}', -- 獎勵
  penalties       JSONB NOT NULL DEFAULT '{}', -- 懲罰
  story_flags     JSONB NOT NULL DEFAULT '[]', -- 設定的劇情旗標
  UNIQUE (scenario_id, outcome_key)
);
```

---

## 五、運行時狀態 Schema｜Runtime State

### 5.1 campaign_states — 戰役進行狀態

```sql
CREATE TYPE campaign_status AS ENUM (
  'in_progress',
  'completed',
  'abandoned'
);

CREATE TABLE campaign_states (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id),
  team_id         UUID REFERENCES teams(id),   -- NULL = 單人
  created_by      UUID NOT NULL REFERENCES users(id),
  status          campaign_status NOT NULL DEFAULT 'in_progress',
  current_scenario_id UUID REFERENCES scenarios(id),
  current_chapter INTEGER NOT NULL DEFAULT 1,

  -- 持續狀態
  story_flags     JSONB NOT NULL DEFAULT '{}',   -- 劇情旗標
  chaos_bag       JSONB NOT NULL DEFAULT '[]',   -- 目前的混沌袋內容
  shared_resources JSONB NOT NULL DEFAULT '{}',  -- 共享資源
  npc_relations   JSONB NOT NULL DEFAULT '{}',   -- NPC 關係狀態

  -- 時間追蹤
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_campaign_states_user ON campaign_states(created_by);
CREATE INDEX idx_campaign_states_team ON campaign_states(team_id);
```

### 5.2 investigator_states — 調查員實例（活動中的角色）

```sql
CREATE TYPE investigator_status AS ENUM (
  'active',
  'downed',
  'dead',
  'retired'
);

CREATE TABLE investigator_states (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  template_id     UUID REFERENCES investigator_templates(id),  -- 可為 NULL（自建角色）
  campaign_state_id UUID REFERENCES campaign_states(id),

  name            VARCHAR(64) NOT NULL,
  status          investigator_status NOT NULL DEFAULT 'active',

  -- 當前屬性（含成長）
  attr_strength   INTEGER NOT NULL CHECK (attr_strength BETWEEN 1 AND 10),
  attr_agility    INTEGER NOT NULL CHECK (attr_agility BETWEEN 1 AND 10),
  attr_constitution INTEGER NOT NULL CHECK (attr_constitution BETWEEN 1 AND 10),
  attr_intellect  INTEGER NOT NULL CHECK (attr_intellect BETWEEN 1 AND 10),
  attr_willpower  INTEGER NOT NULL CHECK (attr_willpower BETWEEN 1 AND 10),
  attr_perception INTEGER NOT NULL CHECK (attr_perception BETWEEN 1 AND 10),
  attr_charisma   INTEGER NOT NULL CHECK (attr_charisma BETWEEN 1 AND 10),

  -- 陣營
  primary_faction_id UUID NOT NULL REFERENCES factions(id),
  secondary_faction_id UUID REFERENCES factions(id),  -- NULL = 尚未解鎖
  secondary_unlock_method VARCHAR(32),  -- 'narrative', 'resource', 'sacrifice'

  -- 生命 / 理智（含創傷侵蝕）
  hp_max          INTEGER NOT NULL,  -- 體質 × 2 + 5 - 累計身體創傷
  hp_current      INTEGER NOT NULL,
  san_max         INTEGER NOT NULL,  -- 意志 × 2 + 5 - 累計精神創傷
  san_current     INTEGER NOT NULL,
  physical_trauma INTEGER NOT NULL DEFAULT 0,
  mental_trauma   INTEGER NOT NULL DEFAULT 0,

  -- 資源
  resources       JSONB NOT NULL DEFAULT '{"resource": 5}',  -- 多貨幣

  -- 經驗值與成長
  experience      INTEGER NOT NULL DEFAULT 0,
  growth_points   INTEGER NOT NULL DEFAULT 0,  -- 可用的成長點數

  -- 熟練與專精
  proficiencies   JSONB NOT NULL DEFAULT '[]',    -- [{id, level: 'proficient'|'specialized'}]

  -- 中繼資料
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  died_at         TIMESTAMPTZ,                     -- 死亡時間（永久死亡）
  death_cause     TEXT                             -- 死亡原因敘事
);

CREATE INDEX idx_inv_states_user ON investigator_states(user_id);
CREATE INDEX idx_inv_states_campaign ON investigator_states(campaign_state_id);
CREATE INDEX idx_inv_states_status ON investigator_states(status);
```

### 5.3 deck_states — 牌組狀態

```sql
CREATE TYPE card_zone AS ENUM (
  'deck',           -- 牌庫
  'hand',           -- 手牌
  'play_area',      -- 場上（已裝備）
  'discard',        -- 棄牌堆
  'removed',        -- 移除出遊戲（消耗品用盡）
  'set_aside'       -- 暫置區
);

CREATE TABLE deck_cards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigator_state_id UUID NOT NULL REFERENCES investigator_states(id) ON DELETE CASCADE,
  card_def_id       UUID NOT NULL REFERENCES card_definitions(id),
  zone              card_zone NOT NULL DEFAULT 'deck',
  sort_order        INTEGER NOT NULL DEFAULT 0,   -- 牌庫中的順序
  uses_remaining    INTEGER,                       -- 剩餘使用次數
  ammo_remaining    INTEGER,                       -- 剩餘彈藥
  is_exhausted      BOOLEAN NOT NULL DEFAULT FALSE, -- 是否已消耗（橫置）
  modifications     JSONB NOT NULL DEFAULT '{}',    -- 強化 / 附加效果
  acquired_chapter  INTEGER,                        -- 在哪一章獲得
  acquired_method   VARCHAR(32),                    -- 'starting', 'exploration', 'reward', 'craft', 'trade'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deck_cards_inv ON deck_cards(investigator_state_id);
CREATE INDEX idx_deck_cards_zone ON deck_cards(zone);
```

### 5.4 scenario_play_states — 場景遊玩狀態

```sql
CREATE TABLE scenario_play_states (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_state_id UUID NOT NULL REFERENCES campaign_states(id) ON DELETE CASCADE,
  scenario_id       UUID NOT NULL REFERENCES scenarios(id),

  -- 場景內狀態
  current_act       INTEGER NOT NULL DEFAULT 1,
  current_agenda    INTEGER NOT NULL DEFAULT 1,
  doom_count        INTEGER NOT NULL DEFAULT 0,
  round_number      INTEGER NOT NULL DEFAULT 0,

  -- 地點狀態
  location_states   JSONB NOT NULL DEFAULT '{}',
  -- 格式: {location_id: {clues_remaining: N, revealed: bool, ...}}

  -- 遭遇牌堆
  encounter_deck    UUID[] NOT NULL DEFAULT '{}',
  encounter_discard UUID[] NOT NULL DEFAULT '{}',

  -- 場上敵人
  active_enemies    JSONB NOT NULL DEFAULT '[]',
  -- 格式: [{enc_def_id, hp_current, location_id, status_key, ...}]

  -- 重返次數（支線關卡用）
  return_count      INTEGER NOT NULL DEFAULT 0,

  -- 時間追蹤
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  outcome           VARCHAR(32)  -- 'victory', 'defeat', 'partial'
);
```

---

## 六、Redis 結構設計｜Redis Schema

Redis 用於高頻讀寫的即時遊戲狀態：

```
# 活動遊戲 Session
game:{session_id}:state        → Hash: 完整遊戲狀態快照
game:{session_id}:turn_order   → List: 回合順序
game:{session_id}:current_turn → String: 目前行動的調查員 ID
game:{session_id}:action_log   → List: 行動歷史（用於回放 / 斷線重連）

# 即時戰鬥狀態
combat:{session_id}:enemies    → Hash: 敵人即時 HP / 狀態
combat:{session_id}:effects    → List: 場上持續效果

# 多人同步
room:{session_id}:players      → Set: 連線中的玩家
room:{session_id}:ready        → Set: 已確認行動的玩家
room:{session_id}:chat         → List: 遊戲內聊天

# 快取
cache:card_def:{card_id}       → JSON: 卡片定義快取
cache:scenario:{scenario_id}   → JSON: 場景定義快取
cache:user:{user_id}:session   → String: 使用者當前 Session ID

# TTL 設定
# game:* → 24 小時（遊戲斷線後保留）
# cache:* → 1 小時（定期刷新）
# room:* → 2 小時（無活動自動清除）
```

---

## 七、資料完整性與安全｜Data Integrity & Security

### 7.1 永久死亡的資料處理

```sql
-- 角色死亡處理流程（由應用層觸發）
-- 1. 將 investigator_states.status 設為 'dead'
-- 2. 記錄 died_at 和 death_cause
-- 3. 將角色資料移至 memorial（紀念）表
-- 4. 原始資料保留 30 天後硬刪除

CREATE TABLE memorial (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  investigator_name VARCHAR(64) NOT NULL,
  faction_name    VARCHAR(64),
  chapters_survived INTEGER NOT NULL DEFAULT 0,
  death_cause     TEXT,
  final_stats     JSONB NOT NULL DEFAULT '{}',
  notable_achievements JSONB NOT NULL DEFAULT '[]',
  died_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 7.2 反作弊設計

```sql
-- 所有關鍵狀態變更都記錄審計日誌
CREATE TABLE audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  action          VARCHAR(64) NOT NULL,
  entity_type     VARCHAR(64) NOT NULL,
  entity_id       UUID NOT NULL,
  old_value       JSONB,
  new_value       JSONB,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_time ON audit_log(created_at);

-- 關鍵操作需要伺服器端驗證：
-- - 骰子結果（伺服器擲骰，客戶端只顯示）
-- - 混沌袋抽取（伺服器端隨機）
-- - HP/SAN 變更（伺服器計算）
-- - 卡片獲取 / 移除（伺服器驗證合法性）
-- - 角色死亡（伺服器判定）
```

---

## 八、索引策略｜Indexing Strategy

```sql
-- 複合索引（高頻查詢）
CREATE INDEX idx_deck_inv_zone ON deck_cards(investigator_state_id, zone);
CREATE INDEX idx_scenario_campaign_chapter ON scenarios(campaign_id, chapter_number);
CREATE INDEX idx_cards_faction_type ON card_definitions(faction_id, card_type);

-- 全文搜索（卡片搜索功能）
CREATE INDEX idx_cards_search ON card_definitions
  USING gin(to_tsvector('simple', name_zh || ' ' || name_en || ' ' || COALESCE(flavor_text, '')));
```

---

## 九、文件版本紀錄｜Version History

| 版本 | 日期 | 變更內容 |
|------|------|----------|
| v0.1 | 2026/04/12 | 初版建立 — 完整 Schema：平台層、調查員模組、場景模組、運行時狀態、Redis 結構、反作弊設計 |
