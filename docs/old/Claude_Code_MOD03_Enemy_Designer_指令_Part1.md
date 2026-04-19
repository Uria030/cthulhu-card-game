# Claude Code 指令：敵人設計器 MOD-03（Part 1/3）
## Enemy Designer Instructions — 資料庫 + Seed Data

> **給 Claude Code：** 請建立敵人設計器，包含前後端兩部分：
> 1. **後端 API**：在 `packages/server/src/routes/` 新增怪物相關 CRUD 端點
> 2. **前端頁面**：在 `packages/client/public/admin/admin-enemy-designer.html` 建立介面
>
> 本模組管理五層資料結構：
> **怪物家族 → 怪物種族（基礎設計）→ 位階變體（具體個體）→ 招式池 → 敘事狀態描述**
>
> 敵人設計器的產出是「填滿每個家族池裡的怪物貨架」。
> 場景設計器（MOD-07）只決定本場景開放哪些家族池；
> 城主 AI 在遊戲運行時從開放的家族池中自行選擇召喚哪隻具體怪物。
>
> 資料存入 PostgreSQL。所有裝置打開同一個網址就能存取同一份資料。
>
> **視覺原則：** 與 MOD-01 卡片設計器一致 — 功能優先，樸素清楚，
> 遵守 admin-shared.css 的暗黑哥德色彩系統（深色背景、金色強調色）。
>
> **本文件為 Part 1/3，涵蓋：資料庫結構 + 全部 Seed Data。**
> Part 2 涵蓋：後端 API + 頁面佈局 + 編輯邏輯。
> Part 3 涵蓋：招式池管理 + AI 行為 + Gemini 生成 + 家族總覽面板。

---

# 第一部分：資料庫結構

## 1.1 架構總覽

從 `encounter_definitions` 表中分離敵人資料，建立獨立的怪物系統。
原因：怪物設計的複雜度（家族系統、位階變體、招式池、詞綴、狀態體系、AI 行為）
遠超出通用遭遇表能承載的範圍。分離後 `encounter_definitions` 只保留詭計（treachery）
和環境（environment）兩種遭遇類型。

新增五張資料表：

| 表名 | 用途 | 關係 |
|------|------|------|
| `monster_families` | 怪物家族定義（10 組） | 最上層 |
| `monster_species` | 怪物種族（基礎設計稿） | 歸屬家族 |
| `monster_variants` | 位階變體（具體可召喚個體） | 歸屬種族 |
| `monster_attack_cards` | 怪物招式卡（怪物的戰鬥風格） | 歸屬變體，可繼承種族級 |
| `monster_status_descriptions` | 敘事狀態描述（HP 階段→文字） | 歸屬變體 |

關係圖：

```
monster_families (10 組)
  └─► monster_species (N 個種族)
        └─► monster_variants (N 個位階變體)
              ├─► monster_attack_cards (N 張招式卡)
              └─► monster_status_descriptions (N 段敘事)
```

## 1.2 monster_families — 怪物家族定義

```sql
CREATE TABLE monster_families (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              VARCHAR(64) UNIQUE NOT NULL,    -- e.g. 'house_cthulhu'
  name_zh           VARCHAR(64) NOT NULL,           -- e.g. '克蘇魯眷族'
  name_en           VARCHAR(64) NOT NULL,           -- e.g. 'House of Cthulhu'
  patron_zh         VARCHAR(64),                    -- 主神中文 e.g. '克蘇魯'
  patron_en         VARCHAR(64),                    -- 主神英文 e.g. 'Cthulhu'
  patron_title_zh   VARCHAR(128),                   -- 主神稱號 e.g. '沉睡者、拉萊耶之主'
  patron_title_en   VARCHAR(128),
  theme_zh          TEXT,                           -- 主題描述
  theme_en          TEXT,
  family_type       VARCHAR(16) NOT NULL DEFAULT 'deity'
                    CHECK (family_type IN (
                      'deity',         -- 舊日支配者/外神眷族（克蘇魯、哈斯塔等）
                      'mortal',        -- 凡人墮落者
                      'undead',        -- 亡者回響
                      'independent'    -- 獨立存在
                    )),

  -- 混沌袋場景效果偏好（四個情境標記各對應什麼效果）
  -- 格式: { "skull": "blood_sacrifice", "cultist": "follower_response", ... }
  chaos_bag_preferences JSONB NOT NULL DEFAULT '{}',

  -- 家族戰鬥特色摘要
  attack_element    VARCHAR(16),                    -- 主要攻擊元素：physical/fire/ice/electric/arcane/mixed
  damage_focus      VARCHAR(16),                    -- 傷害偏重：hp/san/mixed
  combat_tempo_zh   TEXT,                           -- 戰鬥節奏描述
  combat_tempo_en   TEXT,
  typical_keywords  JSONB NOT NULL DEFAULT '[]',    -- 典型詞綴列表 e.g. ["massive", "crush"]
  ai_preference     VARCHAR(32),                    -- 家族預設 AI 偏好代碼

  -- 元素弱點與抗性（家族級預設，種族/變體可覆寫）
  weaknesses        JSONB NOT NULL DEFAULT '[]',    -- e.g. ["fire", "electric"]
  resistances       JSONB NOT NULL DEFAULT '[]',    -- e.g. ["ice"]
  immunities        JSONB NOT NULL DEFAULT '[]',    -- e.g. []（神秘永遠不在此列）

  -- 家族常用狀態
  inflicted_statuses  JSONB NOT NULL DEFAULT '[]',  -- 施放的負面狀態 e.g. [{"code":"wet","frequency":"high"}, ...]
  self_buffs          JSONB NOT NULL DEFAULT '[]',  -- 使用的正面狀態
  status_immunities   JSONB NOT NULL DEFAULT '[]',  -- 狀態免疫 e.g. ["frozen","wet"]

  -- 恐懼特色（家族級預設範圍）
  fear_radius_range   JSONB NOT NULL DEFAULT '[1, 2]',   -- [min, max]
  fear_value_range    JSONB NOT NULL DEFAULT '[1, 3]',   -- [min, max]
  fear_design_note_zh TEXT,                              -- 設計意圖說明
  fear_design_note_en TEXT,

  -- 風格卡池傾向（調查員用什麼屬性防禦此家族）
  -- 格式: { "strength": "high", "constitution": "high", "agility": "medium", ... }
  defense_attribute_tendency JSONB NOT NULL DEFAULT '{}',

  -- 敵對家族
  rival_family_codes  JSONB NOT NULL DEFAULT '[]',  -- e.g. ["house_hastur"]
  rival_note_zh       TEXT,                         -- 敵對原因
  rival_note_en       TEXT,

  -- 未來擴充預留
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE = 預留未啟用
  expansion_note    TEXT,                           -- 擴充版說明

  -- 中繼資料
  sort_order        INTEGER NOT NULL DEFAULT 0,
  design_status     VARCHAR(16) NOT NULL DEFAULT 'draft'
                    CHECK (design_status IN ('draft', 'review', 'approved')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 1.3 monster_species — 怪物種族（基礎設計稿）

每個種族是一類怪物的「原型」，例如「深潛者」、「拜亞基」、「蛇人」。
種族定義家族歸屬、基礎屬性傾向、基礎招式方向，但**不定義具體數值**。
具體數值由位階變體（monster_variants）定義。

```sql
CREATE TABLE monster_species (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id         UUID NOT NULL REFERENCES monster_families(id) ON DELETE CASCADE,
  code              VARCHAR(64) UNIQUE NOT NULL,    -- e.g. 'deep_one'
  name_zh           VARCHAR(64) NOT NULL,           -- e.g. '深潛者'
  name_en           VARCHAR(64) NOT NULL,           -- e.g. 'Deep One'
  description_zh    TEXT,                           -- 種族描述
  description_en    TEXT,
  lore_zh           TEXT,                           -- 神話學背景
  lore_en           TEXT,

  -- 種族級預設（位階變體繼承，可覆寫）
  base_attack_element VARCHAR(16) DEFAULT 'physical', -- 基礎攻擊元素
  base_ai_preference  VARCHAR(32),                   -- 基礎 AI 偏好（NULL = 用家族預設）
  base_weaknesses     JSONB,                         -- NULL = 用家族預設
  base_resistances    JSONB,                         -- NULL = 用家族預設
  base_immunities     JSONB,                         -- NULL = 用家族預設
  base_status_immunities JSONB,                      -- NULL = 用家族預設

  -- 位階範圍（此種族可以出現在哪些位階）
  tier_min          INTEGER NOT NULL DEFAULT 1 CHECK (tier_min BETWEEN 1 AND 5),
  tier_max          INTEGER NOT NULL DEFAULT 3 CHECK (tier_max BETWEEN 1 AND 5),

  -- 種族級典型詞綴（變體繼承後可追加）
  base_keywords     JSONB NOT NULL DEFAULT '[]',    -- e.g. ["massive"]

  -- 種族級防禦屬性傾向（變體繼承，招式卡生成參考）
  -- 格式同家族的 defense_attribute_tendency
  defense_attribute_tendency JSONB,                  -- NULL = 用家族預設

  -- 設計備註
  design_notes      TEXT,

  -- 中繼資料
  variant_count     INTEGER NOT NULL DEFAULT 0,     -- 下轄變體數量（自動計算）
  art_url           TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  design_status     VARCHAR(16) NOT NULL DEFAULT 'draft'
                    CHECK (design_status IN ('draft', 'review', 'approved')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_tier_range CHECK (tier_min <= tier_max)
);

CREATE INDEX idx_species_family ON monster_species(family_id);
```

## 1.4 monster_variants — 位階變體（具體可召喚個體）

每個變體是一隻**可被城主召喚的具體怪物**。
例如「深潛者（雜兵）」「深潛者精英」「深潛者長老」各自是獨立變體。
變體繼承種族的家族歸屬、元素弱點/抗性、AI 偏好等，可覆寫任何欄位。

```sql
CREATE TABLE monster_variants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  species_id        UUID NOT NULL REFERENCES monster_species(id) ON DELETE CASCADE,
  code              VARCHAR(64) UNIQUE NOT NULL,    -- e.g. 'deep_one_minion', 'deep_one_elite'
  name_zh           VARCHAR(64) NOT NULL,           -- e.g. '深潛者（雜兵）', '深潛者精英'
  name_en           VARCHAR(64) NOT NULL,

  -- 位階（五階）
  tier              INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 5),
  -- 1=雜兵 2=威脅 3=精英 4=頭目 5=巨頭

  -- 核心戰鬥數值
  dc                INTEGER NOT NULL,               -- 防禦 DC
  hp_base           INTEGER NOT NULL,               -- 基礎 HP
  hp_per_player     INTEGER NOT NULL DEFAULT 0,     -- 每增加一名玩家 +N HP
  damage_physical   INTEGER NOT NULL DEFAULT 0,     -- 物理傷害
  damage_horror     INTEGER NOT NULL DEFAULT 0,     -- 恐懼傷害
  regen_per_round   INTEGER NOT NULL DEFAULT 0,     -- 每回合回血
  spell_defense     INTEGER NOT NULL DEFAULT 0      -- 法術防禦值 (0-9)
                    CHECK (spell_defense BETWEEN 0 AND 9),

  -- 攻擊次數
  attacks_per_round INTEGER NOT NULL DEFAULT 1,     -- 每回合攻擊次數

  -- 恐懼系統（獨立於傷害）
  fear_radius       INTEGER NOT NULL DEFAULT 1,     -- 恐懼半徑（地點數）
  fear_value        INTEGER NOT NULL DEFAULT 1,     -- 恐懼檢定失敗時的 SAN 傷害
  fear_type         VARCHAR(16) NOT NULL DEFAULT 'first_sight'
                    CHECK (fear_type IN (
                      'first_sight',   -- 首次看到時觸發（標準）
                      'per_round',     -- 每回合觸發（巨頭級）
                      'on_reveal'      -- 偽裝揭露時觸發（奈亞眷族）
                    )),

  -- 移動
  movement_speed    INTEGER NOT NULL DEFAULT 1,     -- 每回合移動格數
  movement_type     VARCHAR(16) NOT NULL DEFAULT 'ground'
                    CHECK (movement_type IN (
                      'ground',        -- 地面移動
                      'flying',        -- 飛行（下回合直接出現在目標地點）
                      'dimensional',   -- 維度跳躍（猶格眷族）
                      'burrowing'      -- 地底鑽行（預留）
                    )),

  -- 詞綴（關鍵字）
  keywords          JSONB NOT NULL DEFAULT '[]',
  -- 格式: ["massive", "crush", "hunter"]
  -- 完整詞綴代碼表見 §2.3

  -- 元素與抗性（覆寫種族/家族預設）
  attack_element    VARCHAR(16),                    -- NULL = 用種族預設
  weaknesses        JSONB,                          -- NULL = 用種族預設
  resistances       JSONB,                          -- NULL = 用種族預設
  immunities        JSONB,                          -- NULL = 用種族預設

  -- 抗性數值（減免點數）
  resistance_values JSONB NOT NULL DEFAULT '{}',
  -- 格式: { "physical": 2, "ice": 1 }（減免 N 點該元素傷害）

  -- 狀態體系（覆寫種族/家族預設）
  inflicted_statuses  JSONB,                        -- NULL = 用種族預設
  self_buffs          JSONB,                        -- NULL = 用種族預設
  status_immunities   JSONB,                        -- NULL = 用種族預設

  -- AI 行為
  ai_preference     VARCHAR(32),                    -- NULL = 用種族/家族預設
  ai_preference_param VARCHAR(32),                  -- 偏好參數 e.g. 'perception'（lowest_attr 用）
  ai_behavior_notes TEXT,                           -- AI 行為補充說明

  -- 特殊規則（頭目/巨頭級）
  is_undefeatable   BOOLEAN NOT NULL DEFAULT FALSE, -- 不可擊敗（巨頭級劇情怪）
  phase_count       INTEGER NOT NULL DEFAULT 1,     -- 多階段戰鬥（頭目/巨頭）
  phase_rules       JSONB NOT NULL DEFAULT '[]',    -- 階段轉換規則
  -- 格式: [{ "phase": 2, "trigger": "hp_below_50", "effects": [...] }]

  legendary_actions  JSONB NOT NULL DEFAULT '[]',   -- 傳奇行動（頭目/巨頭）
  -- 格式: [{ "name_zh": "海嘯", "trigger": "round_start", "effect": {...} }]

  environment_effects JSONB NOT NULL DEFAULT '[]',  -- 環境改變效果
  -- 格式: [{ "trigger": "on_spawn", "effect": "darkness_all" }]

  -- 敘事
  description_zh    TEXT,
  description_en    TEXT,
  art_url           TEXT,

  -- 設計備註
  design_notes      TEXT,

  -- 中繼資料
  attack_card_count INTEGER NOT NULL DEFAULT 0,     -- 招式卡數量（自動計算）
  sort_order        INTEGER NOT NULL DEFAULT 0,
  design_status     VARCHAR(16) NOT NULL DEFAULT 'draft'
                    CHECK (design_status IN ('draft', 'review', 'approved')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_variants_species ON monster_variants(species_id);
CREATE INDEX idx_variants_tier ON monster_variants(tier);
```

## 1.5 monster_attack_cards — 怪物招式卡

怪物的戰鬥風格卡。與調查員風格卡（MOD-05）**對稱但反向**：
- 調查員風格卡決定「用什麼屬性攻擊」
- 怪物招式卡決定「調查員用什麼屬性防禦」

每張招式卡歸屬於一個位階變體。
若 `variant_id` 為 NULL 而 `species_id` 不為 NULL，表示這是**種族級共享招式**，
該種族下所有變體都可使用（除非變體有自己的同名招式覆蓋）。

```sql
CREATE TABLE monster_attack_cards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  species_id        UUID REFERENCES monster_species(id) ON DELETE CASCADE,  -- 種族級共享招式
  variant_id        UUID REFERENCES monster_variants(id) ON DELETE CASCADE, -- 變體專屬招式
  -- species_id 和 variant_id 至少一個不為 NULL

  code              VARCHAR(64) UNIQUE NOT NULL,    -- e.g. 'deep_one_claw_strike'
  name_zh           VARCHAR(64) NOT NULL,           -- e.g. '利爪撕裂'
  name_en           VARCHAR(64) NOT NULL,           -- e.g. 'Claw Strike'

  -- 防禦檢定
  defense_attribute VARCHAR(16) NOT NULL,           -- 調查員用什麼屬性防禦
  -- 七大屬性之一：strength/agility/constitution/intellect/willpower/perception/charisma

  dc_override       INTEGER,                        -- 覆寫 DC（NULL = 使用變體的 DC）
  damage_physical   INTEGER NOT NULL DEFAULT 0,     -- 物理傷害（覆寫變體基礎傷害）
  damage_horror     INTEGER NOT NULL DEFAULT 0,     -- 恐懼傷害
  damage_element    VARCHAR(16) NOT NULL DEFAULT 'physical',
  -- 元素：physical/fire/ice/electric/arcane

  -- 附加效果
  inflicts_status   JSONB NOT NULL DEFAULT '[]',
  -- 格式: [{ "code": "bleed", "value": 1, "duration": 3, "on": "hit" }]

  special_effect    JSONB NOT NULL DEFAULT '{}',
  -- 自由格式，供城主 AI 解讀的特殊效果
  -- e.g. { "type": "forced_move", "distance": 1 }
  -- e.g. { "type": "aoe", "radius": 1, "damage": 2 }

  -- 招式權重（城主 AI 選擇招式的機率權重）
  weight            INTEGER NOT NULL DEFAULT 10,    -- 預設等權重
  -- 權重越高，被抽到的機率越大

  -- 觸發條件（可選，部分招式有條件限制）
  use_condition     JSONB NOT NULL DEFAULT '{}',
  -- e.g. { "target_status": "wet" }（目標必須處於潮濕狀態才能用電擊）
  -- e.g. { "hp_below_percent": 50 }（HP 低於 50% 才解鎖的招式）
  -- e.g. { "phase": 2 }（頭目第二階段才解鎖）

  -- 三段敘事
  narrative_attack_zh  TEXT,                        -- 攻擊敘事 e.g. '深潛者張開沾滿海藻的利爪朝你撲來'
  narrative_attack_en  TEXT,
  narrative_hit_zh     TEXT,                        -- 命中敘事 e.g. '利爪劃破你的護甲，海水般冰冷的血液濺出'
  narrative_hit_en     TEXT,
  narrative_miss_zh    TEXT,                        -- 閃避敘事 e.g. '你側身躲開，利爪在牆壁上留下深深的抓痕'
  narrative_miss_en    TEXT,

  -- 中繼資料
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_attack_card_owner CHECK (
    species_id IS NOT NULL OR variant_id IS NOT NULL
  )
);

CREATE INDEX idx_attack_cards_species ON monster_attack_cards(species_id);
CREATE INDEX idx_attack_cards_variant ON monster_attack_cards(variant_id);
```

## 1.6 monster_status_descriptions — 敘事狀態描述

敵人 HP 不顯示數字，以敘事性狀態描述取代。
每個變體有自己的一組敘事階段描述。

```sql
CREATE TABLE monster_status_descriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id        UUID NOT NULL REFERENCES monster_variants(id) ON DELETE CASCADE,
  hp_threshold      INTEGER NOT NULL,               -- HP 百分比門檻 (0-100)
  -- e.g. 100 = 滿血, 75 = 受傷, 50 = 重傷, 25 = 瀕死, 0 = 死亡
  description_zh    TEXT NOT NULL,                  -- e.g. '牠看起來毫髮無傷'
  description_en    TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,     -- 顯示排序（由高到低）
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (variant_id, hp_threshold)
);

CREATE INDEX idx_status_desc_variant ON monster_status_descriptions(variant_id);
```

## 1.7 admin-shared.js 修正

### 修正 getModifier（規則書 v1.0）

```javascript
// 修正前（錯誤）：
getModifier: (attr) => Math.floor(attr / 2),

// 修正後（正確 — 屬性修正 1:1）：
getModifier: (attr) => attr,
```

### 修正 ENEMY_TIERS DC（規則書 v1.0 上調 +4）

```javascript
// 修正前（舊值）：
const ENEMY_TIERS = {
  1: { name: '雜兵', en: 'Minion', dc: 8,  ... },
  2: { name: '威脅', en: 'Threat', dc: 12, ... },
  3: { name: '精英', en: 'Elite',  dc: 16, ... },
  4: { name: '頭目', en: 'Boss',   dc: 20, ... },
  5: { name: '巨頭', en: 'Titan',  dc: 24, ... },
};

// 修正後（規則書 v1.0 — DC 全面上調 +4）：
const ENEMY_TIERS = {
  1: { name: '雜兵', en: 'Minion', dc: 12, hpRange: [3, 5],   dmgRange: [1, 2],  regen: 0,     spellDef: [0, 1], attacks: 1 },
  2: { name: '威脅', en: 'Threat', dc: 16, hpRange: [8, 14],  dmgRange: [2, 4],  regen: 0,     spellDef: [1, 3], attacks: 1 },
  3: { name: '精英', en: 'Elite',  dc: 20, hpRange: [18, 28], dmgRange: [3, 6],  regen: [0,1], spellDef: [3, 5], attacks: 1 },
  4: { name: '頭目', en: 'Boss',   dc: 24, hpRange: [35, 50], dmgRange: [4, 8],  regen: [1,3], spellDef: [5, 7], attacks: [2, 3] },
  5: { name: '巨頭', en: 'Titan',  dc: 28, hpRange: [55, 70], dmgRange: [6, 10], regen: [3,5], spellDef: [7, 9], attacks: [2, 3] },
};
```

### 新增怪物相關常數

```javascript
// 怪物位階代碼
const MONSTER_TIERS = {
  1: { code: 'minion', name_zh: '雜兵', name_en: 'Minion' },
  2: { code: 'threat', name_zh: '威脅', name_en: 'Threat' },
  3: { code: 'elite',  name_zh: '精英', name_en: 'Elite' },
  4: { code: 'boss',   name_zh: '頭目', name_en: 'Boss' },
  5: { code: 'titan',  name_zh: '巨頭', name_en: 'Titan' },
};

// 怪物詞綴完整清單（來自規則書第二章 §11）
const MONSTER_KEYWORDS = {
  // 移動類
  swift:              { category: 'movement',    name_zh: '快速',     name_en: 'Swift',             effect_zh: '每回合移動 2 格' },
  flying:             { category: 'movement',    name_zh: '飛行',     name_en: 'Flying',            effect_zh: '不在地圖上移動，下回合放置在敏捷最低的調查員地點' },

  // 交戰類
  hunter:             { category: 'engagement',  name_zh: '獵手',     name_en: 'Hunter',            effect_zh: '移動後若進入交戰，立刻額外攻擊一次' },
  massive:            { category: 'engagement',  name_zh: '巨大',     name_en: 'Massive',           effect_zh: '與地點中所有調查員交戰' },
  apathetic:          { category: 'engagement',  name_zh: '冷漠',     name_en: 'Apathetic',         effect_zh: '不主動與調查員交戰' },

  // 死亡效果類
  crush:              { category: 'death_effect', name_zh: '壓垮',    name_en: 'Crush',             effect_zh: '被擊敗後，同地點調查員做閃避檢定，失敗受物理傷害' },
  curse_on_death:     { category: 'death_effect', name_zh: '詛咒',    name_en: 'Curse on Death',    effect_zh: '被擊敗後，同地點調查員做意志檢定，失敗受恐懼傷害' },
  haunting:           { category: 'death_effect', name_zh: '鬧鬼',    name_en: 'Haunting',          effect_zh: '死亡後附著在地點上，調查失敗時復活' },

  // 防禦類
  physical_resistance: { category: 'defense',    name_zh: '物理抗性', name_en: 'Physical Resistance', effect_zh: '減免指定點數的物理傷害' },
  physical_immunity:   { category: 'defense',    name_zh: '物理免疫', name_en: 'Physical Immunity',   effect_zh: '不受物理傷害' },
  fire_resistance:     { category: 'defense',    name_zh: '火屬性抗性', name_en: 'Fire Resistance',    effect_zh: '減免指定點數的火屬性傷害' },
  ice_resistance:      { category: 'defense',    name_zh: '冰屬性抗性', name_en: 'Ice Resistance',     effect_zh: '減免指定點數的冰屬性傷害' },
  electric_resistance: { category: 'defense',    name_zh: '雷屬性抗性', name_en: 'Electric Resistance', effect_zh: '減免指定點數的雷屬性傷害' },

  // 特殊類
  swarm:              { category: 'special',     name_zh: '群體',     name_en: 'Swarm',             effect_zh: '此怪有指定數量的分身一起行動' },
};

// AI 偏好代碼（來自規則書第二章 §10.5）
const AI_PREFERENCES = {
  nearest:      { name_zh: '最近',     name_en: 'Nearest',     desc_zh: '追蹤最近的調查員' },
  lowest_hp:    { name_zh: '血量最低', name_en: 'Lowest HP',   desc_zh: '追蹤當前 HP 最低的調查員' },
  lowest_san:   { name_zh: '理智最低', name_en: 'Lowest SAN',  desc_zh: '追蹤當前 SAN 最低的調查員' },
  most_clues:   { name_zh: '線索最多', name_en: 'Most Clues',  desc_zh: '追蹤持有最多線索的調查員' },
  last_attacker:{ name_zh: '仇恨',     name_en: 'Last Attacker', desc_zh: '追蹤上回合攻擊過牠的調查員' },
  lowest_attr:  { name_zh: '屬性最低', name_en: 'Lowest Attr', desc_zh: '追蹤指定屬性最低的調查員（需指定屬性）' },
  random:       { name_zh: '隨機',     name_en: 'Random',      desc_zh: '隨機選擇' },
};

// 攻擊元素
const ATTACK_ELEMENTS = {
  physical: { name_zh: '物理', name_en: 'Physical', color: '#8A8778' },
  fire:     { name_zh: '火',   name_en: 'Fire',     color: '#B84C4C' },
  ice:      { name_zh: '冰',   name_en: 'Ice',      color: '#4A7C9B' },
  electric: { name_zh: '雷',   name_en: 'Electric',  color: '#C9A84C' },
  arcane:   { name_zh: '神秘', name_en: 'Arcane',    color: '#7B4EA3' },
};

// 負面狀態完整清單（來自怪物家族設計草案 v2）
const NEGATIVE_STATUSES = {
  poison:          { name_zh: '中毒', name_en: 'Poison',    effect_zh: '受到的傷害 +X' },
  bleed:           { name_zh: '流血', name_en: 'Bleed',     effect_zh: '回合結束時扣 X 點 HP' },
  burning:         { name_zh: '燃燒', name_en: 'Burning',   effect_zh: '回合開始扣 HP，火攻增傷，移除潮濕' },
  frozen:          { name_zh: '冷凍', name_en: 'Frozen',    effect_zh: '移動花費 +1，冰攻增傷' },
  darkness:        { name_zh: '黑暗', name_en: 'Darkness',  effect_zh: '攻擊命中 -2' },
  disarm:          { name_zh: '繳械', name_en: 'Disarm',    effect_zh: '不能用資產攻擊' },
  doom_status:     { name_zh: '毀滅', name_en: 'Doom',      effect_zh: '回合結束受傷' },
  fatigue:         { name_zh: '疲勞', name_en: 'Fatigue',   effect_zh: '不能抽牌和獲得資源' },
  madness:         { name_zh: '發瘋', name_en: 'Madness',   effect_zh: '受到的恐懼 +X' },
  marked:          { name_zh: '標記', name_en: 'Marked',    effect_zh: '受到的傷害和恐懼都 +X' },
  vulnerable:      { name_zh: '脆弱', name_en: 'Vulnerable', effect_zh: '受到的物理傷害 +X' },
  silence:         { name_zh: '沈默', name_en: 'Silence',   effect_zh: '無法施法' },
  weakness_status: { name_zh: '無力', name_en: 'Weakness',  effect_zh: '近戰傷害降低' },
  wet:             { name_zh: '潮濕', name_en: 'Wet',       effect_zh: '電擊傷害 +X' },
  weakened:        { name_zh: '弱化', name_en: 'Weakened',  effect_zh: '下次擲骰取差的' },
};

// 正面狀態完整清單（怪物自身使用）
const POSITIVE_STATUSES = {
  empowered:    { name_zh: '強化', name_en: 'Empowered',    effect_zh: '下次擲骰取好的' },
  armor:        { name_zh: '護甲', name_en: 'Armor',        effect_zh: '降低物理傷害' },
  ward:         { name_zh: '護盾', name_en: 'Ward',         effect_zh: '降低恐懼傷害' },
  stealth:      { name_zh: '隱蔽', name_en: 'Stealth',      effect_zh: '不觸發藉機攻擊' },
  haste:        { name_zh: '加速', name_en: 'Haste',        effect_zh: '額外行動點' },
  regeneration: { name_zh: '再生', name_en: 'Regeneration',  effect_zh: '回合開始恢復 HP' },
};

// 混沌袋情境標記場景效果選項（來自規則書第二章 §5.4）
const CHAOS_BAG_SCENE_EFFECTS = {
  skull: {
    blood_sacrifice:   { name_zh: '血祭',     effect_zh: '施法者獲得流血 X' },
    death_touch:       { name_zh: '死亡之觸', effect_zh: '施法者受 X 點 HP 傷害' },
    trauma_erosion:    { name_zh: '創傷侵蝕', effect_zh: '施法者 HP 上限 -1' },
    life_drain:        { name_zh: '生命流逝', effect_zh: '施法者獲得無力狀態' },
    life_cost:         { name_zh: '生命代價', effect_zh: '失去盟友或資產' },
  },
  cultist: {
    doom_advance:      { name_zh: '末日推進', effect_zh: '放置毀滅標記' },
    follower_response: { name_zh: '信徒回應', effect_zh: '生成 1 隻敵人' },
    ritual_resonance:  { name_zh: '儀式共鳴', effect_zh: '怪物回血' },
    exposed:           { name_zh: '暴露',     effect_zh: '失去隱蔽' },
    dark_ritual:       { name_zh: '黑暗儀式', effect_zh: '板塊進入黑暗' },
  },
  tablet: {
    forbidden_knowledge: { name_zh: '禁忌知識', effect_zh: '施法者受 X 點恐懼傷害' },
    mad_whisper:         { name_zh: '瘋狂低語', effect_zh: '施法者獲得發瘋狀態' },
    memory_collapse:     { name_zh: '記憶崩解', effect_zh: '隨機棄手牌' },
    mental_exhaustion:   { name_zh: '精神枯竭', effect_zh: '施法者獲得疲勞狀態' },
    forbidden_truth:     { name_zh: '不應知曉之事', effect_zh: '神啟卡洗入牌庫' },
  },
  elder_thing: {
    rift_expand:       { name_zh: '裂隙擴張', effect_zh: '開啟次元門' },
    spacetime_warp:    { name_zh: '時空扭曲', effect_zh: '隨機傳送' },
    otherworld_seep:   { name_zh: '異界滲透', effect_zh: '放置鬧鬼' },
    space_sever:       { name_zh: '空間斷裂', effect_zh: '斷開地點連接' },
    otherworld_fire:   { name_zh: '異界之火', effect_zh: '板塊失火' },
    void_chill:        { name_zh: '虛空寒流', effect_zh: '冷凍狀態' },
  },
};

// 恐懼觸發類型
const FEAR_TYPES = {
  first_sight: { name_zh: '初見', name_en: 'First Sight', desc_zh: '第一次看到時觸發' },
  per_round:   { name_zh: '每回合', name_en: 'Per Round', desc_zh: '每回合開始時觸發（巨頭級）' },
  on_reveal:   { name_zh: '揭露時', name_en: 'On Reveal', desc_zh: '偽裝揭露時觸發' },
};

// 移動類型
const MOVEMENT_TYPES = {
  ground:      { name_zh: '地面', name_en: 'Ground' },
  flying:      { name_zh: '飛行', name_en: 'Flying' },
  dimensional: { name_zh: '維度跳躍', name_en: 'Dimensional' },
  burrowing:   { name_zh: '地底鑽行', name_en: 'Burrowing' },
};
```

---

# 第二部分：Seed Data

建立資料表後，灌入以下預設資料。
**所有規則書與怪物家族設計草案中已有的文字敘述都必須作為預設值填入。**

## 2.1 怪物家族 Seed Data（10 組）

### 七大主神家族

```sql
-- 1. 克蘇魯眷族
INSERT INTO monster_families (code, name_zh, name_en, patron_zh, patron_en, patron_title_zh,
  family_type, theme_zh, attack_element, damage_focus, combat_tempo_zh,
  typical_keywords, ai_preference, weaknesses, resistances, immunities,
  inflicted_statuses, self_buffs, status_immunities,
  fear_radius_range, fear_value_range, fear_design_note_zh,
  defense_attribute_tendency, rival_family_codes, rival_note_zh,
  chaos_bag_preferences, sort_order, design_status)
VALUES (
  'house_cthulhu', '克蘇魯眷族', 'House of Cthulhu',
  '克蘇魯', 'Cthulhu', '沉睡者、拉萊耶之主',
  'deity',
  '海洋、沉睡、夢境入侵、潮汐般不可阻擋的壓迫。',
  'physical', 'hp',
  '慢但沉重 — 每一擊傷害高，攻擊頻率低',
  '["massive", "crush"]',
  'nearest',
  '["fire", "electric"]',
  '["ice"]',
  '[]',
  '[{"code":"wet","frequency":"high","note":"海水浸泡、觸手黏液"},{"code":"vulnerable","frequency":"medium","note":"觸手纏繞後暴露弱點"},{"code":"madness","frequency":"low","note":"僅高階單位的夢境入侵"}]',
  '[{"code":"armor","frequency":"high","note":"堅硬的鱗片和甲殼"},{"code":"regeneration","frequency":"medium","note":"星之眷族與克蘇魯本體的肉體再生"}]',
  '["frozen", "wet"]',
  '[1, 2]', '[2, 4]',
  '遠遠看不怕，近距離壓迫感極強',
  '{"strength":"high","constitution":"high","agility":"medium","willpower":"low"}',
  '["house_hastur"]', '水 vs 風',
  '{"skull":"blood_sacrifice","cultist":"follower_response","tablet":"forbidden_knowledge","elder_thing":"otherworld_seep"}',
  1, 'approved'
);

-- 2. 哈斯塔眷族
INSERT INTO monster_families (code, name_zh, name_en, patron_zh, patron_en, patron_title_zh,
  family_type, theme_zh, attack_element, damage_focus, combat_tempo_zh,
  typical_keywords, ai_preference, weaknesses, resistances, immunities,
  inflicted_statuses, self_buffs, status_immunities,
  fear_radius_range, fear_value_range, fear_design_note_zh,
  defense_attribute_tendency, rival_family_codes, rival_note_zh,
  chaos_bag_preferences, sort_order, design_status)
VALUES (
  'house_hastur', '哈斯塔眷族', 'House of Hastur',
  '哈斯塔', 'Hastur', '無以名狀者、黃衣之王',
  'deity',
  '風、天空、瘋狂、藝術腐化、黃色符號。一首詩、一齣戲、一個黃色的印記，就足以讓理智崩塌。',
  'physical', 'san',
  '不正面交鋒 — 從遠處持續消磨理智',
  '["flying", "curse_on_death"]',
  'lowest_san',
  '["physical"]',
  '["ice"]',
  '[]',
  '[{"code":"madness","frequency":"very_high","note":"黃色符號、瘋狂耳語 — 核心手段"},{"code":"weakened","frequency":"high","note":"精神動搖導致行動猶豫"},{"code":"silence","frequency":"medium","note":"封鎖施法者（黃衣之王的壓制）"},{"code":"darkness","frequency":"medium","note":"精神迷霧，看不清現實"},{"code":"marked","frequency":"low","note":"黃色印記標記目標（僅黃衣之王）"}]',
  '[{"code":"ward","frequency":"high","note":"精神護壁"},{"code":"stealth","frequency":"medium","note":"幻影般的存在"}]',
  '["madness", "darkness"]',
  '[3, 5]', '[1, 2]',
  '瀰漫性，遠遠就開始侵蝕，持續累積而非一擊崩潰',
  '{"willpower":"high","perception":"high","intellect":"medium","strength":"low"}',
  '["house_cthulhu"]', '風 vs 水',
  '{"skull":"life_drain","cultist":"doom_advance","tablet":"mad_whisper","elder_thing":"spacetime_warp"}',
  2, 'approved'
);

-- 3. 莎布·尼古拉絲眷族
INSERT INTO monster_families (code, name_zh, name_en, patron_zh, patron_en, patron_title_zh,
  family_type, theme_zh, attack_element, damage_focus, combat_tempo_zh,
  typical_keywords, ai_preference, weaknesses, resistances, immunities,
  inflicted_statuses, self_buffs, status_immunities,
  fear_radius_range, fear_value_range, fear_design_note_zh,
  defense_attribute_tendency, rival_family_codes, rival_note_zh,
  chaos_bag_preferences, sort_order, design_status)
VALUES (
  'house_shub', '莎布·尼古拉絲眷族', 'House of Shub-Niggurath',
  '莎布·尼古拉絲', 'Shub-Niggurath', '黑山羊、千子之母',
  'deity',
  '繁殖、森林、腐化的生命力、母性的扭曲。',
  'physical', 'hp',
  '群體壓制 — 數量多、單體不強、源源不絕',
  '["swarm", "hunter"]',
  'nearest',
  '["fire"]',
  '["ice"]',
  '[]',
  '[{"code":"poison","frequency":"very_high","note":"毒性分泌物、孢子 — 核心手段"},{"code":"bleed","frequency":"high","note":"觸手鞭打的撕裂傷"},{"code":"vulnerable","frequency":"medium","note":"酸液腐蝕護甲"},{"code":"fatigue","frequency":"low","note":"孢子造成的倦意"}]',
  '[{"code":"regeneration","frequency":"very_high","note":"瘋狂的生命力，核心家族特色"},{"code":"armor","frequency":"medium","note":"樹皮般的外殼（成體幼崽）"}]',
  '["poison", "bleed"]',
  '[2, 3]', '[1, 3]',
  '「越來越多」的恐懼，數量壓迫',
  '{"constitution":"high","agility":"high","strength":"medium","willpower":"low"}',
  '[]', NULL,
  '{"skull":"death_touch","cultist":"ritual_resonance","tablet":"mental_exhaustion","elder_thing":"rift_expand"}',
  3, 'approved'
);

-- 4. 奈亞拉托提普眷族
INSERT INTO monster_families (code, name_zh, name_en, patron_zh, patron_en, patron_title_zh,
  family_type, theme_zh, attack_element, damage_focus, combat_tempo_zh,
  typical_keywords, ai_preference, weaknesses, resistances, immunities,
  inflicted_statuses, self_buffs, status_immunities,
  fear_radius_range, fear_value_range, fear_design_note_zh,
  defense_attribute_tendency, rival_family_codes, rival_note_zh,
  chaos_bag_preferences, sort_order, design_status)
VALUES (
  'house_nyarlathotep', '奈亞拉托提普眷族', 'House of Nyarlathotep',
  '奈亞拉托提普', 'Nyarlathotep', '無貌之神、伏行之混沌、千面信使',
  'deity',
  '欺騙、偽裝、混沌、計謀、千面神。',
  'mixed', 'mixed',
  '不可預測 — 規則改寫、陷阱、詛咒',
  '[]',
  'most_clues',
  '[]',
  '[]',
  '[]',
  '[{"code":"marked","frequency":"high","note":"千面神的注視，鎖定獵物"},{"code":"madness","frequency":"high","note":"揭露真相時的精神衝擊"},{"code":"weakened","frequency":"medium","note":"心理操縱導致動搖"},{"code":"disarm","frequency":"medium","note":"夏蓋蟲族的精神控制"},{"code":"silence","frequency":"low","note":"封鎖認知"},{"code":"doom_status","frequency":"low","note":"奈亞的詛咒（僅化身級）"}]',
  '[{"code":"stealth","frequency":"very_high","note":"偽裝核心能力"},{"code":"empowered","frequency":"medium","note":"千面神的力量湧現（僅化身級）"},{"code":"ward","frequency":"medium","note":"精神層面的防禦"}]',
  '["marked", "weakened"]',
  '[0, 5]', '[0, 5]',
  '不固定 — 偽裝時為 0，真身揭露時全場最高',
  '{"perception":"high","intellect":"high","willpower":"high","charisma":"medium","strength":"low","agility":"low"}',
  '[]', '特殊 — 外神信使，可「客串」出現在任何家族的關卡中',
  '{"skull":"life_cost","cultist":"exposed","tablet":"forbidden_truth","elder_thing":"space_sever"}',
  4, 'approved'
);

-- 5. 猶格·索托斯眷族
INSERT INTO monster_families (code, name_zh, name_en, patron_zh, patron_en, patron_title_zh,
  family_type, theme_zh, attack_element, damage_focus, combat_tempo_zh,
  typical_keywords, ai_preference, weaknesses, resistances, immunities,
  inflicted_statuses, self_buffs, status_immunities,
  fear_radius_range, fear_value_range, fear_design_note_zh,
  defense_attribute_tendency, rival_family_codes, rival_note_zh,
  chaos_bag_preferences, sort_order, design_status)
VALUES (
  'house_yog', '猶格·索托斯眷族', 'House of Yog-Sothoth',
  '猶格·索托斯', 'Yog-Sothoth', '門之鑰、萬有即一',
  'deity',
  '維度、時空、門戶、角度、幾何恐怖。',
  'physical', 'mixed',
  '突襲型 — 憑空出現、攻擊、消失',
  '["flying"]',
  'lowest_attr',
  '[]',
  '["physical"]',
  '[]',
  '[{"code":"weakened","frequency":"high","note":"時空扭曲導致行動失準"},{"code":"madness","frequency":"high","note":"看到不該看到的維度"},{"code":"darkness","frequency":"medium","note":"維度重疊導致視覺混亂"},{"code":"doom_status","frequency":"medium","note":"時空侵蝕（精英以上）"},{"code":"fatigue","frequency":"low","note":"時間扭曲消耗精力"}]',
  '[{"code":"stealth","frequency":"very_high","note":"維度跳躍，消失在角度之間"},{"code":"haste","frequency":"medium","note":"時間扭曲帶來的超速行動（廷達洛斯獵犬）"}]',
  '["frozen", "burning"]',
  '[1, 1]', '[3, 5]',
  '在你旁邊憑空出現的瞬間衝擊',
  '{"perception":"high","intellect":"high","agility":"medium","willpower":"medium"}',
  '[]', NULL,
  '{"skull":"blood_sacrifice","cultist":"doom_advance","tablet":"memory_collapse","elder_thing":"spacetime_warp"}',
  5, 'approved'
);

-- 6. 克圖格亞眷族
INSERT INTO monster_families (code, name_zh, name_en, patron_zh, patron_en, patron_title_zh,
  family_type, theme_zh, attack_element, damage_focus, combat_tempo_zh,
  typical_keywords, ai_preference, weaknesses, resistances, immunities,
  inflicted_statuses, self_buffs, status_immunities,
  fear_radius_range, fear_value_range, fear_design_note_zh,
  defense_attribute_tendency, rival_family_codes, rival_note_zh,
  chaos_bag_preferences, sort_order, design_status)
VALUES (
  'house_cthugha', '克圖格亞眷族', 'House of Cthugha',
  '克圖格亞', 'Cthugha', '爆燃者、居於火焰者',
  'deity',
  '火焰、爆燃、恆星、毀滅性的光與熱。太陽墜落到你面前。',
  'fire', 'hp',
  '攻擊性極強 — 傷害高、防禦低、速戰速決',
  '["crush", "swift"]',
  'nearest',
  '["ice", "physical"]',
  '[]',
  '["fire"]',
  '[{"code":"burning","frequency":"very_high","note":"一切著火 — 核心手段"},{"code":"vulnerable","frequency":"high","note":"灼傷削弱防禦"},{"code":"bleed","frequency":"medium","note":"火焰灼傷的持續傷口"},{"code":"fatigue","frequency":"low","note":"高溫導致體力流失"}]',
  '[{"code":"empowered","frequency":"medium","note":"火焰暴走"},{"code":"haste","frequency":"medium","note":"火焰的急速蔓延（炎之精群體）"}]',
  '["burning", "frozen", "wet"]',
  '[2, 3]', '[1, 2]',
  '恐懼來自傷害本身而非精神侵蝕',
  '{"agility":"high","constitution":"high","strength":"medium","willpower":"low"}',
  '["house_hastur"]', '神話依據：《黑暗住民》中克圖格亞被召喚來對抗哈斯塔',
  '{"skull":"death_touch","cultist":"exposed","tablet":"forbidden_knowledge","elder_thing":"otherworld_fire"}',
  6, 'approved'
);

-- 7. 伊格眷族
INSERT INTO monster_families (code, name_zh, name_en, patron_zh, patron_en, patron_title_zh,
  family_type, theme_zh, attack_element, damage_focus, combat_tempo_zh,
  typical_keywords, ai_preference, weaknesses, resistances, immunities,
  inflicted_statuses, self_buffs, status_immunities,
  fear_radius_range, fear_value_range, fear_design_note_zh,
  defense_attribute_tendency, rival_family_codes, rival_note_zh,
  chaos_bag_preferences, sort_order, design_status)
VALUES (
  'house_yig', '伊格眷族', 'House of Yig',
  '伊格', 'Yig', '蛇之父',
  'deity',
  '蛇、毒、古老文明、隱伏、地底、腐朽的智慧。蛇人曾統治世界，牠們潛伏在地底等待時機。',
  'physical', 'hp',
  '伏擊型 — 先隱藏、再突襲、帶毒素 DoT',
  '["hunter", "apathetic"]',
  'lowest_hp',
  '["ice", "fire"]',
  '[]',
  '[]',
  '[{"code":"poison","frequency":"very_high","note":"蛇毒 — 核心手段"},{"code":"bleed","frequency":"high","note":"毒牙咬傷的持續出血"},{"code":"weakened","frequency":"medium","note":"蛇毒導致肌肉無力"},{"code":"weakness_status","frequency":"medium","note":"神經毒素麻痺"},{"code":"silence","frequency":"low","note":"蛇人祭司的封鎖咒語（僅祭司）"}]',
  '[{"code":"stealth","frequency":"very_high","note":"蛇的天然潛伏"},{"code":"armor","frequency":"medium","note":"蛇鱗的物理防禦"},{"code":"empowered","frequency":"low","note":"蛇人祭司的法術增幅（僅祭司）"}]',
  '["poison"]',
  '[1, 2]', '[1, 2]',
  '伏擊的恐懼在看到的瞬間才爆發',
  '{"constitution":"high","agility":"high","perception":"medium","strength":"medium"}',
  '[]', NULL,
  '{"skull":"blood_sacrifice","cultist":"follower_response","tablet":"mad_whisper","elder_thing":"otherworld_seep"}',
  7, 'approved'
);
```

### 三大非主神家族

```sql
-- 8. 凡人墮落者
INSERT INTO monster_families (code, name_zh, name_en, patron_zh, patron_en, patron_title_zh,
  family_type, theme_zh, attack_element, damage_focus, combat_tempo_zh,
  typical_keywords, ai_preference, weaknesses, resistances, immunities,
  inflicted_statuses, self_buffs, status_immunities,
  fear_radius_range, fear_value_range, fear_design_note_zh,
  defense_attribute_tendency, rival_family_codes, rival_note_zh,
  chaos_bag_preferences, sort_order, design_status)
VALUES (
  'fallen', '凡人墮落者', 'The Fallen',
  NULL, NULL, NULL,
  'mortal',
  '曾經是人類，因崇拜、瘋狂或貪欲而墮落。邪教徒、瘋狂學者、丘丘人。可搭配任何主神家族出現。',
  'physical', 'mixed',
  '雜兵為主，偶有精英級祭司或瘋狂學者',
  '[]',
  'nearest',
  '[]',
  '[]',
  '[]',
  '[]',
  '[]',
  '[]',
  '[1, 1]', '[0, 1]',
  '人類級恐懼，主要是數量和瘋狂行為',
  '{"strength":"medium","agility":"medium","constitution":"medium","intellect":"medium","willpower":"medium","perception":"medium","charisma":"medium"}',
  '[]', NULL,
  '{}',
  8, 'approved'
);

-- 9. 亡者回響
INSERT INTO monster_families (code, name_zh, name_en, patron_zh, patron_en, patron_title_zh,
  family_type, theme_zh, attack_element, damage_focus, combat_tempo_zh,
  typical_keywords, ai_preference, weaknesses, resistances, immunities,
  inflicted_statuses, self_buffs, status_immunities,
  fear_radius_range, fear_value_range, fear_design_note_zh,
  defense_attribute_tendency, rival_family_codes, rival_note_zh,
  chaos_bag_preferences, sort_order, design_status)
VALUES (
  'undying', '亡者回響', 'The Undying',
  NULL, NULL, NULL,
  'undead',
  '死而不朽的存在。食屍鬼、格拉基之僕從、蠕行者。徘徊在生死邊界。',
  'physical', 'mixed',
  '消耗型 — 擊殺後可能復活、持續騷擾',
  '["haunting", "curse_on_death"]',
  'lowest_hp',
  '["fire"]',
  '["ice"]',
  '[]',
  '[{"code":"madness","frequency":"high","note":"面對已死之物的恐懼"},{"code":"poison","frequency":"medium","note":"屍毒"},{"code":"fatigue","frequency":"medium","note":"死氣侵蝕生命力"}]',
  '[{"code":"regeneration","frequency":"high","note":"不死再生"},{"code":"armor","frequency":"medium","note":"僵硬的屍體難以傷害"}]',
  '["poison", "bleed", "fatigue"]',
  '[1, 2]', '[2, 3]',
  '面對已死之物行走的原始恐懼',
  '{"willpower":"high","constitution":"high","strength":"medium","agility":"low"}',
  '[]', NULL,
  '{}',
  9, 'approved'
);

-- 10. 獨立存在
INSERT INTO monster_families (code, name_zh, name_en, patron_zh, patron_en, patron_title_zh,
  family_type, theme_zh, attack_element, damage_focus, combat_tempo_zh,
  typical_keywords, ai_preference, weaknesses, resistances, immunities,
  inflicted_statuses, self_buffs, status_immunities,
  fear_radius_range, fear_value_range, fear_design_note_zh,
  defense_attribute_tendency, rival_family_codes, rival_note_zh,
  chaos_bag_preferences, sort_order, design_status)
VALUES (
  'independent', '獨立存在', 'Independent Entities',
  NULL, NULL, NULL,
  'independent',
  '不隸屬任何舊日支配者的獨立存在。修格斯、夜魘、星之彩、米·戈、古老者。任何關卡都可出現。',
  'mixed', 'mixed',
  '多樣化 — 每種獨立存在都有獨特的戰鬥模式',
  '[]',
  'random',
  '[]',
  '[]',
  '[]',
  '[]',
  '[]',
  '[]',
  '[1, 3]', '[1, 4]',
  '不可分類的未知帶來的恐懼',
  '{}',
  '[]', NULL,
  '{}',
  10, 'approved'
);
```

### 未來擴充預留（is_active = FALSE）

```sql
-- 預留：札特瓜眷族
INSERT INTO monster_families (code, name_zh, name_en, patron_zh, patron_en, patron_title_zh,
  family_type, theme_zh, is_active, expansion_note, sort_order, design_status)
VALUES (
  'house_tsathoggua', '札特瓜眷族', 'House of Tsathoggua',
  '札特瓜', 'Tsathoggua', '簡體常用「撒托古亞」，台灣慣用「札特瓜」',
  'deity',
  '地底、慵懶、黑暗、無形之子、沃米人',
  FALSE, '待擴充 — 沃米人暫放獨立存在類',
  11, 'draft'
);

-- 預留：修德·梅爾眷族
INSERT INTO monster_families (code, name_zh, name_en, patron_zh, patron_en, patron_title_zh,
  family_type, theme_zh, is_active, expansion_note, sort_order, design_status)
VALUES (
  'house_shudde_mell', '修德·梅爾眷族', 'House of Shudde M''ell',
  '修德·梅爾', 'Shudde M''ell', '鑽地魔蟲之主',
  'deity',
  '地震、鑽地、地底恐怖',
  FALSE, '待擴充',
  12, 'draft'
);

-- 預留：諾登斯（舊神系）
INSERT INTO monster_families (code, name_zh, name_en, patron_zh, patron_en, patron_title_zh,
  family_type, theme_zh, is_active, expansion_note, sort_order, design_status)
VALUES (
  'house_nodens', '諾登斯陣營', 'House of Nodens',
  '諾登斯', 'Nodens', '相對友善的古老存在、夜魘統領',
  'deity',
  '相對友善的古老存在、夜魘統領',
  FALSE, '待擴充 — 特殊家族，可能是盟友而非敵人',
  13, 'draft'
);
```

## 2.2 怪物種族 Seed Data

依據怪物家族設計草案 v2 中每個家族的「位階範圍」表，預填所有已命名的怪物種族。

```sql
-- === 克蘇魯眷族的種族 ===

INSERT INTO monster_species (family_id, code, name_zh, name_en, description_zh,
  tier_min, tier_max, base_keywords, sort_order, design_status)
VALUES
  ((SELECT id FROM monster_families WHERE code = 'house_cthulhu'),
   'deep_one', '深潛者', 'Deep One',
   '克蘇魯的基礎眷屬，半人半魚的海底生物。成群結隊從海中湧上岸邊。',
   1, 3, '[]', 1, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_cthulhu'),
   'star_spawn', '星之眷族', 'Star-Spawn of Cthulhu',
   '克蘇魯的直系眷屬，巨大的類克蘇魯存在。肉體再生能力極強。',
   3, 4, '["massive"]', 2, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_cthulhu'),
   'dagon', '達貢', 'Dagon',
   '父神達貢，深潛者的統帥。古老而強大的海底存在。',
   4, 4, '["massive", "crush"]', 3, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_cthulhu'),
   'hydra', '海德拉', 'Hydra',
   '母神海德拉，與達貢並列的深潛者統帥。',
   4, 4, '["massive", "crush"]', 4, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_cthulhu'),
   'cthulhu', '克蘇魯', 'Cthulhu',
   '沉睡者。拉萊耶之主。不可擊敗。',
   5, 5, '["massive"]', 5, 'draft');

-- === 哈斯塔眷族的種族 ===

INSERT INTO monster_species (family_id, code, name_zh, name_en, description_zh,
  tier_min, tier_max, base_keywords, sort_order, design_status)
VALUES
  ((SELECT id FROM monster_families WHERE code = 'house_hastur'),
   'yellow_acolyte', '黃衣信徒', 'Yellow Acolyte',
   '哈斯塔的凡人信徒，邪教徒變體。黃色符號的傳播者。',
   1, 2, '[]', 1, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_hastur'),
   'byakhee', '拜亞基', 'Byakhee',
   '星際飛行的怪物，哈斯塔的忠實眷族。',
   2, 3, '["flying"]', 2, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_hastur'),
   'lloigor_zhar', '羅伊格爾與札爾', 'Lloigor & Zhar',
   '雙子舊日支配者，哈斯塔的眷屬。',
   3, 4, '[]', 3, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_hastur'),
   'king_in_yellow', '黃衣之王', 'King in Yellow',
   '哈斯塔的化身之一。精神壓制能力極強。',
   4, 4, '["curse_on_death"]', 4, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_hastur'),
   'ithaqua', '伊塔庫亞', 'Ithaqua',
   '風行者。在暴風雪中狩獵的恐怖存在。',
   4, 5, '["flying", "swift"]', 5, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_hastur'),
   'hastur', '哈斯塔', 'Hastur',
   '無以名狀者。不可擊敗。',
   5, 5, '[]', 6, 'draft');

-- === 莎布·尼古拉絲眷族的種族 ===

INSERT INTO monster_species (family_id, code, name_zh, name_en, description_zh,
  tier_min, tier_max, base_keywords, sort_order, design_status)
VALUES
  ((SELECT id FROM monster_families WHERE code = 'house_shub'),
   'dark_young', '黑山羊幼崽', 'Dark Young',
   '莎布·尼古拉絲的子嗣。幼體成群出沒，成體龐大而致命。',
   1, 4, '["swarm"]', 1, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_shub'),
   'shub_niggurath', '莎布·尼古拉絲', 'Shub-Niggurath',
   '黑山羊、千子之母。不可擊敗。',
   5, 5, '["massive"]', 2, 'draft');

-- === 奈亞拉托提普眷族的種族 ===

INSERT INTO monster_species (family_id, code, name_zh, name_en, description_zh,
  tier_min, tier_max, base_keywords, sort_order, design_status)
VALUES
  ((SELECT id FROM monster_families WHERE code = 'house_nyarlathotep'),
   'nyar_cultist', '邪教信徒（偽裝）', 'Cultist (Disguised)',
   '奈亞拉托提普的凡人信徒，各種偽裝身分。',
   1, 2, '["apathetic"]', 1, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_nyarlathotep'),
   'shan', '夏蓋蟲族', 'Insect from Shaggai',
   '寄生型外星昆蟲，精神控制能力極強。',
   2, 3, '[]', 2, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_nyarlathotep'),
   'hunting_horror', '恐怖獵手', 'Hunting Horror',
   '奈亞拉托提普的僕從，黑暗中的獵手。',
   3, 3, '["flying", "hunter"]', 3, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_nyarlathotep'),
   'nyar_avatar', '奈亞拉托提普的化身', 'Avatar of Nyarlathotep',
   '千面神的化身之一。每次出現形態都不同。',
   4, 5, '[]', 4, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_nyarlathotep'),
   'nyarlathotep', '奈亞拉托提普', 'Nyarlathotep',
   '無貌之神、伏行之混沌、千面信使。不可擊敗。',
   5, 5, '[]', 5, 'draft');

-- === 猶格·索托斯眷族的種族 ===

INSERT INTO monster_species (family_id, code, name_zh, name_en, description_zh,
  tier_min, tier_max, base_keywords, sort_order, design_status)
VALUES
  ((SELECT id FROM monster_families WHERE code = 'house_yog'),
   'dimensional_shambler', '空鬼', 'Dimensional Shambler',
   '次元徘徊者，在維度之間遊蕩的恐怖存在。',
   2, 3, '[]', 1, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_yog'),
   'hound_of_tindalos', '廷達洛斯獵犬', 'Hound of Tindalos',
   '角度中的獵手，從時空裂縫中撲出。一旦鎖定獵物永不放棄。',
   3, 3, '["hunter", "swift"]', 2, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_yog'),
   'yog_sothoth', '猶格·索托斯', 'Yog-Sothoth',
   '門之鑰、萬有即一。不可擊敗。',
   5, 5, '[]', 3, 'draft');

-- === 克圖格亞眷族的種族 ===

INSERT INTO monster_species (family_id, code, name_zh, name_en, description_zh,
  tier_min, tier_max, base_keywords, sort_order, design_status)
VALUES
  ((SELECT id FROM monster_families WHERE code = 'house_cthugha'),
   'fire_vampire', '炎之精', 'Fire Vampire',
   '純火焰構成的生命體，小型但致命。',
   1, 2, '["swift"]', 1, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_cthugha'),
   'flame_construct', '火焰造物', 'Flame Construct',
   '由克圖格亞的火焰凝聚而成的戰鬥造物。',
   3, 3, '["crush"]', 2, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_cthugha'),
   'aphoom_zhah', '亞弗姆·扎', 'Aphoom-Zhah',
   '克圖格亞的後裔，冷焰之主。',
   4, 4, '[]', 3, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_cthugha'),
   'cthugha', '克圖格亞', 'Cthugha',
   '爆燃者、居於火焰者。不可擊敗。',
   5, 5, '["massive"]', 4, 'draft');

-- === 伊格眷族的種族 ===

INSERT INTO monster_species (family_id, code, name_zh, name_en, description_zh,
  tier_min, tier_max, base_keywords, sort_order, design_status)
VALUES
  ((SELECT id FROM monster_families WHERE code = 'house_yig'),
   'serpent_scout', '蛇人斥候', 'Serpent Scout',
   '蛇人的先遣偵察兵，善於潛伏和突襲。',
   1, 2, '["apathetic"]', 1, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_yig'),
   'serpent_warrior', '蛇人戰士', 'Serpent Warrior',
   '蛇人的正規戰鬥兵，裝備古老文明的武器。',
   2, 3, '["hunter"]', 2, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_yig'),
   'serpent_priest', '蛇人祭司', 'Serpent Priest',
   '蛇人的祭司，掌握古老魔法和蛇毒秘術。',
   3, 4, '[]', 3, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'house_yig'),
   'yig', '伊格', 'Yig',
   '蛇之父。頭目到巨頭級。',
   4, 5, '["massive"]', 4, 'draft');

-- === 凡人墮落者的種族 ===

INSERT INTO monster_species (family_id, code, name_zh, name_en, description_zh,
  tier_min, tier_max, base_keywords, sort_order, design_status)
VALUES
  ((SELECT id FROM monster_families WHERE code = 'fallen'),
   'cultist', '邪教徒', 'Cultist',
   '各種舊日支配者的凡人崇拜者。可搭配任何主神家族出現。',
   1, 2, '[]', 1, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'fallen'),
   'mad_scholar', '瘋狂學者', 'Mad Scholar',
   '因鑽研禁忌知識而失去理智的學者。',
   2, 3, '[]', 2, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'fallen'),
   'tcho_tcho', '丘丘人', 'Tcho-Tcho',
   '退化的人類部落，崇拜各種黑暗力量。',
   1, 3, '["swarm"]', 3, 'draft');

-- === 亡者回響的種族 ===

INSERT INTO monster_species (family_id, code, name_zh, name_en, description_zh,
  tier_min, tier_max, base_keywords, sort_order, design_status)
VALUES
  ((SELECT id FROM monster_families WHERE code = 'undying'),
   'ghoul', '食屍鬼', 'Ghoul',
   '以屍體為食的地底生物，曾經是人類。',
   1, 3, '["haunting"]', 1, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'undying'),
   'servant_of_glaaki', '格拉基之僕從', 'Servant of Glaaki',
   '被格拉基的棘刺刺穿後變成不死僕從的犧牲者。',
   2, 3, '["haunting", "curse_on_death"]', 2, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'undying'),
   'crawling_one', '蠕行者', 'Crawling One',
   '由無數蠕蟲構成的不死存在。',
   3, 4, '["swarm"]', 3, 'draft');

-- === 獨立存在的種族 ===

INSERT INTO monster_species (family_id, code, name_zh, name_en, description_zh,
  tier_min, tier_max, base_keywords, sort_order, design_status)
VALUES
  ((SELECT id FROM monster_families WHERE code = 'independent'),
   'shoggoth', '修格斯', 'Shoggoth',
   '不定形僕從，古老者創造的生物兵器。極度危險。',
   3, 4, '["massive"]', 1, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'independent'),
   'nightgaunt', '夜魘', 'Nightgaunt',
   '幻夢境生物，無面的黑色飛行生物。',
   2, 3, '["flying"]', 2, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'independent'),
   'colour_out_of_space', '星之彩', 'Colour out of Space',
   '來自宇宙的顏色，非物質存在。',
   3, 4, '[]', 3, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'independent'),
   'mi_go', '米·戈', 'Mi-Go',
   '猶格斯星的真菌生物，外星科學家。',
   2, 3, '["flying"]', 4, 'draft'),

  ((SELECT id FROM monster_families WHERE code = 'independent'),
   'elder_thing', '古老者', 'Elder Thing',
   '又稱「古老種族」，南極文明的創造者。',
   3, 4, '[]', 5, 'draft');
```

## 2.3 敘事狀態描述預設模板

所有怪物變體建立時，自動生成以下 5 階段敘事描述模板，
管理員可在設計器中針對每隻怪物自訂修改：

```javascript
const DEFAULT_STATUS_DESCRIPTIONS = [
  { hp_threshold: 100, description_zh: '牠看起來毫髮無傷。', sort_order: 5 },
  { hp_threshold: 75,  description_zh: '牠似乎受了一些傷，但行動不受影響。', sort_order: 4 },
  { hp_threshold: 50,  description_zh: '牠的動作開始遲緩，傷口清晰可見。', sort_order: 3 },
  { hp_threshold: 25,  description_zh: '牠拖著殘破的身軀，每一步都在顫抖。', sort_order: 2 },
  { hp_threshold: 0,   description_zh: '牠轟然倒下，不再動彈。', sort_order: 1 },
];
```

---

# 第三部分：設計原則提醒

## 3.1 神秘元素無抗性（絕對規則）

**神秘（Arcane）是遊戲中最強的攻擊元素。**

- `immunities` 和 `resistances` 欄位中**永遠不能出現 `arcane`**。
- 前端設計器在元素抗性/免疫的選項中，**不提供 `arcane` 選項**。
- 若管理員嘗試透過 API 設定神秘抗性，後端應拒絕並回傳錯誤訊息。

## 3.2 繼承優先順序

位階變體的每個欄位遵循以下繼承鏈：

```
變體自身值 > 種族預設值 > 家族預設值
```

若變體欄位為 NULL，回退到種族；種族也為 NULL，回退到家族。
前端顯示時，繼承來的值用較淡的顏色標示，覆寫值用正常顏色。

## 3.3 位階數值參考範圍

設計器中建立新變體時，根據選擇的位階自動帶入建議數值範圍（可調整）：

| 位階 | DC | HP | 傷害 | 回血 | 法術防禦 | 攻擊次數 |
|------|-----|------|------|------|---------|---------|
| 雜兵 | 12 | 3–5 | 1–2 | 0 | 0–1 | 1 |
| 威脅 | 16 | 8–14 | 2–4 | 0 | 1–3 | 1 |
| 精英 | 20 | 18–28 | 3–6 | 0–1 | 3–5 | 1 |
| 頭目 | 24 | 35–50 | 4–8 | 1–3 | 5–7 | 2–3 |
| 巨頭 | 28 | 55–70 | 6–10 | 3–5 | 7–9 | 2–3 |

> 來源：規則書 v1.0 第六章 §5.1（DC 已上調 +4 版）。

---

> **Part 1 結束。**
> Part 2 將涵蓋：後端 API + 頁面佈局 + 怪物種族編輯 + 位階變體編輯邏輯。
> Part 3 將涵蓋：招式池管理 + AI 行為配置 + Gemini AI 生成 + 家族總覽面板。
