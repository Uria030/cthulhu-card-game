# Claude Code 指令文件：MOD-11 調查員設計器（Part 1 / 3）
## Admin Module — Investigator Designer Build Instructions (Part 1 of 3)

> **模組代號：** MOD-11
> **模組名稱：** 調查員設計器（Investigator Designer）
> **本檔內容：** 資料庫結構、64 模板 Seed Data、後端 API 設計
> **配套檔案：** Part 2（設計器 UI）、Part 3（Gemini AI 整合與總覽面板）
> **撰寫日期：** 2026/04/16
> **撰寫者：** Claude Opus（GDD11 聊天室）

---

## 零、前置說明

### 0.1 模組定位

MOD-11 調查員設計器是 Admin Module v0.2.1 的調查員設計工具。其核心定位為：

1. **設計對象：** 調查員 ID 卡 + 專屬起始牌組（15–20 張預組）
2. **設計者：** 系統管理員／遊戲設計師
3. **產出：** 64 個預設調查員模板 + 玩家自建模板框架
4. **目的：** 為玩家端創角器提供可選的預設角色庫

### 0.2 與其他模組的關係

| 上游依賴 | 內容 |
|---------|------|
| MOD-05 戰鬥風格 | 提供戰鬥熟練清單給調查員模板選用 |
| MOD-01 卡片設計器 | 提供一般卡片供起始牌組挑選（非簽名卡） |

| 下游使用 | 內容 |
|---------|------|
| 玩家端創角器 | 讀取 64 個模板供玩家選擇 |
| MOD-10 城主設計器 | 遭遇卡效果可能引用調查員屬性 |

### 0.3 本模組不涉及的範圍

- **天賦樹投資**：天賦點在冒險中才獲取與投入，調查員模板不預先指定天賦路徑
- **簽名卡的 MOD-01 管理**：簽名卡屬於該調查員專屬，不進入 MOD-01 卡片設計器的通用卡池
- **陣營等級機制的邏輯實作**：陣營等級（Lv1 主陣營 vs Lv1 副陣營）目前為**待定設計空間**，Schema 預留欄位但不實作機制邏輯

---

## 一、資料庫結構

本模組新增 5 張資料表。所有表使用 `gen_random_uuid()` 作為主鍵預設值。

### 1.1 `investigator_templates` — 調查員模板主表

> **注意：** 此表已在資料庫 Schema v0.1 中存在，需要依本規格**改寫與擴充**。

```sql
-- 先 DROP 舊的約束（若存在）
ALTER TABLE investigator_templates DROP CONSTRAINT IF EXISTS chk_total_points;

-- 修正總點數約束：21 → 18
ALTER TABLE investigator_templates
ADD CONSTRAINT chk_total_points CHECK (
  attr_strength + attr_agility + attr_constitution +
  attr_intellect + attr_willpower + attr_perception +
  attr_charisma = 18
);

-- 擴充欄位：MBTI 四字碼、職業序號、偏重字母、時代標籤
ALTER TABLE investigator_templates
ADD COLUMN IF NOT EXISTS mbti_code         VARCHAR(4),
ADD COLUMN IF NOT EXISTS career_index      INTEGER CHECK (career_index BETWEEN 1 AND 4),
ADD COLUMN IF NOT EXISTS dominant_letter   VARCHAR(1),
ADD COLUMN IF NOT EXISTS era_tags          TEXT,
ADD COLUMN IF NOT EXISTS portrait_url      TEXT,
ADD COLUMN IF NOT EXISTS is_preset         BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_completed      BOOLEAN NOT NULL DEFAULT FALSE;

-- 索引
CREATE INDEX IF NOT EXISTS idx_inv_templates_mbti ON investigator_templates(mbti_code);
CREATE INDEX IF NOT EXISTS idx_inv_templates_preset ON investigator_templates(is_preset);
CREATE INDEX IF NOT EXISTS idx_inv_templates_completed ON investigator_templates(is_completed);

-- MBTI + career_index 的唯一性約束（僅對 is_preset = TRUE 的紀錄）
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_templates_mbti_career
  ON investigator_templates(mbti_code, career_index)
  WHERE is_preset = TRUE;
```

**欄位說明：**

| 欄位 | 說明 |
|------|------|
| `mbti_code` | MBTI 四字碼（如 'ENTJ'），僅用於預設模板，玩家自建可為 NULL |
| `career_index` | 職業序號 1–4，對應四字碼的字母位置 |
| `dominant_letter` | 此職業偏重的字母（E/I/S/N/T/F/J/P 其一），由 career_index 決定 |
| `era_tags` | 時代與背景自由文字標籤（如 "1925, 美國, 考古隊"） |
| `portrait_url` | 頭像圖片 URL |
| `is_preset` | 是否為 64 個預設骨架之一（TRUE = 預建的格子；FALSE = 玩家自建） |
| `is_completed` | 設計者是否已完成填寫（所有必要欄位都填滿才為 TRUE） |

### 1.2 `investigator_signature_cards` — 調查員簽名卡

簽名卡專屬於該調查員，**不進入 MOD-01 卡池**。

```sql
CREATE TABLE investigator_signature_cards (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigator_id      UUID NOT NULL REFERENCES investigator_templates(id) ON DELETE CASCADE,
  card_order           INTEGER NOT NULL CHECK (card_order BETWEEN 1 AND 3),

  -- 卡片基本資訊
  name_zh              VARCHAR(64) NOT NULL,
  name_en              VARCHAR(64),
  card_type            VARCHAR(16) NOT NULL,      -- 'asset', 'event', 'ally', 'skill'
  card_style           VARCHAR(8),                -- 'A+H', 'A+C', 'O+H', 'O+C'
  rarity               VARCHAR(16) DEFAULT 'signature', -- 簽名卡固定標記
  cost                 INTEGER CHECK (cost BETWEEN 0 AND 6),

  -- 三合一屬性
  commit_icons         JSONB,
    /* 例：[{"attr":"willpower","value":1},{"attr":"intellect","value":1}] */
  consume_effect       TEXT,

  -- 打出效果
  play_effect          TEXT,
  play_effect_code     JSONB,   -- 結構化效果代碼（預留，供未來效果語言引擎使用）

  -- 敘事欄位
  flavor_text          TEXT,    -- 傳敘（卡面引文）
  illustration_url     TEXT,

  -- 後設資料
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (investigator_id, card_order)
);

CREATE INDEX idx_sig_cards_investigator ON investigator_signature_cards(investigator_id);
```

**設計備註：**
- 每個調查員**最多 3 張**簽名卡（一般 2–3 張，由設計者自行決定）
- 簽名卡的 `rarity` 永遠是 `'signature'`，不走一般稀有度系統
- `card_order` 決定顯示順序，同一調查員不可重複
- `commit_icons` 與 MOD-01 一般卡片使用相同的 JSONB 格式

### 1.3 `investigator_weaknesses` — 調查員個人弱點

個人弱點同樣專屬於該調查員，**強制納入起始牌組**。

```sql
CREATE TABLE investigator_weaknesses (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigator_id      UUID NOT NULL UNIQUE REFERENCES investigator_templates(id) ON DELETE CASCADE,

  name_zh              VARCHAR(64) NOT NULL,
  name_en              VARCHAR(64),

  -- 弱點類型
  weakness_type        VARCHAR(32) NOT NULL,
    /* 'flaw'（性格缺陷）、'trauma'（舊傷）、'curse'（詛咒）、
       'obsession'（執念）、'debt'（債務）、'secret'（秘密）等 */

  -- 觸發機制
  trigger_condition    TEXT NOT NULL,   -- 何時/如何觸發
  negative_effect      TEXT NOT NULL,   -- 觸發後的負面效果
  removal_condition    TEXT,            -- 如何解除（留空表示無法解除）

  -- 敘事欄位
  backstory            TEXT,            -- 這個弱點的故事由來
  flavor_text          TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_weakness_investigator ON investigator_weaknesses(investigator_id);
```

**設計備註：**
- 每個調查員**僅 1 張**個人弱點（UNIQUE 約束）
- `weakness_type` 為開放文字欄位，管理員可依需要擴充種類
- `removal_condition` 為 NULL 表示此弱點無法在冒險中解除

### 1.4 `investigator_starting_deck` — 起始牌組構築

起始牌組由「一般卡（來自 MOD-01 卡池）」+「簽名卡」+「個人弱點」組成。

```sql
CREATE TABLE investigator_starting_deck (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigator_id      UUID NOT NULL REFERENCES investigator_templates(id) ON DELETE CASCADE,

  -- 卡片來源（三擇一，其餘必須為 NULL）
  card_definition_id   UUID REFERENCES card_definitions(id),        -- MOD-01 一般卡
  signature_card_id    UUID REFERENCES investigator_signature_cards(id),
  weakness_id          UUID REFERENCES investigator_weaknesses(id),

  quantity             INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  slot_order           INTEGER,  -- 顯示排序（非必要）

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 三擇一約束：必須剛好有一個 id 不為 NULL
  CONSTRAINT chk_exactly_one_source CHECK (
    (CASE WHEN card_definition_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN signature_card_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN weakness_id IS NOT NULL THEN 1 ELSE 0 END) = 1
  )
);

CREATE INDEX idx_starting_deck_investigator ON investigator_starting_deck(investigator_id);
```

**設計備註：**
- 一筆記錄 = 起始牌組中的一張「卡槽」（含張數）
- 起始牌組總張數需在 15–20 張之間（由應用層驗證，非 DB 約束）
- 簽名卡與個人弱點**強制納入**，不可刪除
- 一般卡由設計者從 MOD-01 卡池中挑選，受該模板的四字碼卡池限制

### 1.5 `faction_attribute_map` — 陣營主屬性對照表

> **重要：** 此表替代 `admin-shared.js` 中的硬編碼，作為可查詢的資料來源。內容依**支柱五 §1.2 修正案**。

```sql
CREATE TABLE faction_attribute_map (
  faction_code         VARCHAR(1) PRIMARY KEY,        -- E/I/S/N/T/F/J/P
  faction_name_zh      VARCHAR(16) NOT NULL,
  main_attribute       VARCHAR(16) NOT NULL,          -- strength/agility/... 其一
  is_shared            BOOLEAN NOT NULL DEFAULT FALSE, -- 是否與其他陣營共享屬性
  note                 TEXT
);
```

**Seed Data（支柱五 §1.2 修正案）：**

```sql
INSERT INTO faction_attribute_map (faction_code, faction_name_zh, main_attribute, is_shared, note) VALUES
  ('E', '號令', 'charisma',     FALSE, '領導者靠社交影響力'),
  ('I', '深淵', 'intellect',    TRUE,  '凝視深淵需要深邃思維；與 T 共享智力'),
  ('S', '鐵證', 'perception',   FALSE, '實證派靠觀察、搜索、敵人觀察'),
  ('N', '天啟', 'willpower',    FALSE, '法術施放、精神防禦、神秘學家核心'),
  ('T', '解析', 'intellect',    TRUE,  '純粹智力運用；與 I 共享智力'),
  ('F', '聖燼', 'strength',     FALSE, '燃燒肉身的魄力，替人擋傷害的身體本錢'),
  ('J', '鐵壁', 'constitution', FALSE, '成為防線、承受傷害的肉體堡壘'),
  ('P', '流影', 'agility',      FALSE, '在縫隙中穿梭、反應與閃避');
```

---

## 二、`admin-shared.js` 修正清單

實作本模組時，需要同步修正 `admin-shared.js` 的數個既知錯誤。**此修正為整個 Admin Module 的公共基礎**，不只影響 MOD-11。

### 2.1 修正 `GAME_RULES.CREATION_TOTAL_POINTS`

```javascript
// 修正前
CREATION_TOTAL_POINTS: 21,

// 修正後（依規則書 v1.0 + 支柱五 §1.1 最新版）
CREATION_TOTAL_POINTS: 18,
```

### 2.2 修正 `GAME_RULES.getModifier`

```javascript
// 修正前
getModifier: (attr) => Math.floor(attr / 2),

// 修正後（依規則書 v1.0 第六章 §2.2，1:1 對應）
getModifier: (attr) => attr,
```

### 2.3 修正 `ENEMY_TIERS` DC 值（全面 +4）

```javascript
// 修正後（依規則書 v1.0 第六章 §5.1）
const ENEMY_TIERS = {
  1: { name: '雜兵', en: 'Minion', dc: 12, hpRange: [3, 5],   dmgRange: [1, 2] },
  2: { name: '威脅', en: 'Threat', dc: 16, hpRange: [8, 14],  dmgRange: [2, 4] },
  3: { name: '精英', en: 'Elite',  dc: 20, hpRange: [18, 28], dmgRange: [3, 6] },
  4: { name: '頭目', en: 'Boss',   dc: 24, hpRange: [35, 50], dmgRange: [4, 8] },
  5: { name: '巨頭', en: 'Titan',  dc: 28, hpRange: [55, 70], dmgRange: [6, 10] },
};
```

### 2.4 新增 `MBTI_TYPES` 常數

```javascript
const MBTI_TYPES = {
  // 分析家（Analysts）
  INTJ: { code: 'INTJ', zh: '建築師',     en: 'Architect',   group: 'Analysts',  mainFaction: 'I' },
  INTP: { code: 'INTP', zh: '邏輯學家',   en: 'Logician',    group: 'Analysts',  mainFaction: 'I' },
  ENTJ: { code: 'ENTJ', zh: '指揮官',     en: 'Commander',   group: 'Analysts',  mainFaction: 'E' },
  ENTP: { code: 'ENTP', zh: '辯論家',     en: 'Debater',     group: 'Analysts',  mainFaction: 'E' },

  // 外交家（Diplomats）
  INFJ: { code: 'INFJ', zh: '提倡者',     en: 'Advocate',    group: 'Diplomats', mainFaction: 'I' },
  INFP: { code: 'INFP', zh: '調停者',     en: 'Mediator',    group: 'Diplomats', mainFaction: 'I' },
  ENFJ: { code: 'ENFJ', zh: '主人公',     en: 'Protagonist', group: 'Diplomats', mainFaction: 'E' },
  ENFP: { code: 'ENFP', zh: '競選者',     en: 'Campaigner',  group: 'Diplomats', mainFaction: 'E' },

  // 守護者（Sentinels）
  ISTJ: { code: 'ISTJ', zh: '物流師',     en: 'Logistician', group: 'Sentinels', mainFaction: 'I' },
  ISFJ: { code: 'ISFJ', zh: '守衛者',     en: 'Defender',    group: 'Sentinels', mainFaction: 'I' },
  ESTJ: { code: 'ESTJ', zh: '總經理',     en: 'Executive',   group: 'Sentinels', mainFaction: 'E' },
  ESFJ: { code: 'ESFJ', zh: '執政官',     en: 'Consul',      group: 'Sentinels', mainFaction: 'E' },

  // 探險家（Explorers）
  ISTP: { code: 'ISTP', zh: '鑑賞家',     en: 'Virtuoso',    group: 'Explorers', mainFaction: 'I' },
  ISFP: { code: 'ISFP', zh: '探險家',     en: 'Adventurer',  group: 'Explorers', mainFaction: 'I' },
  ESTP: { code: 'ESTP', zh: '企業家',     en: 'Entrepreneur', group: 'Explorers', mainFaction: 'E' },
  ESFP: { code: 'ESFP', zh: '表演者',     en: 'Entertainer', group: 'Explorers', mainFaction: 'E' },
};
```

### 2.5 新增 `FACTION_ATTRIBUTE_MAP` 常數

```javascript
// 依支柱五 §1.2 修正案
const FACTION_ATTRIBUTE_MAP = {
  E: { attribute: 'charisma',     isShared: false },
  I: { attribute: 'intellect',    isShared: true  },  // 與 T 共享
  S: { attribute: 'perception',   isShared: false },
  N: { attribute: 'willpower',    isShared: false },
  T: { attribute: 'intellect',    isShared: true  },  // 與 I 共享
  F: { attribute: 'strength',     isShared: false },
  J: { attribute: 'constitution', isShared: false },
  P: { attribute: 'agility',      isShared: false },
};
```

### 2.6 新增輔助函數 `calculateBaseAttributes`

此函數依四字碼自動計算屬性基礎配置（基礎 7 + 主陣營 +3 + 副陣營各 +1 = 13 點，剩餘 5 點由玩家/設計者自由分配）。

```javascript
/**
 * 依 MBTI 四字碼計算屬性基礎配置
 * @param {string} mbti - 四字碼，如 'ENTJ'
 * @returns {Object} 屬性配置物件
 */
function calculateBaseAttributes(mbti) {
  if (!mbti || mbti.length !== 4) return null;

  // 基礎 +1（七屬性）
  const attrs = {
    strength: 1, agility: 1, constitution: 1,
    intellect: 1, willpower: 1, perception: 1, charisma: 1
  };

  const mainLetter = mbti[0]; // 第一個字母為主陣營？否！主陣營依支柱一定義

  // 依支柱五 §1.1：E/I 其中一個為主陣營（MBTI 的第一個字母非 E/I 判斷基準）
  // 修正：主陣營是 MBTI 四字中的某一個字母，其他三個為副陣營
  // 預設以第一個字母（E 或 I）為主陣營，這是支柱一的預設
  const letters = mbti.split('');
  const mainFaction = letters[0]; // E 或 I

  // 主陣營主屬性 +3
  const mainAttr = FACTION_ATTRIBUTE_MAP[mainFaction]?.attribute;
  if (mainAttr) attrs[mainAttr] += 3;

  // 三個副陣營各 +1
  for (let i = 1; i < 4; i++) {
    const subFaction = letters[i];
    const subAttr = FACTION_ATTRIBUTE_MAP[subFaction]?.attribute;
    if (subAttr) attrs[subAttr] += 1;
  }

  // 計算已分配點數，回傳連同剩餘自由點數
  const totalAllocated = Object.values(attrs).reduce((a, b) => a + b, 0);
  const freePoints = 18 - totalAllocated;

  return { attrs, totalAllocated, freePoints };
}
```

> **設計備註：** 玩家端創角器會使用同一函數，讓「選完 MBTI → 自動產生基礎配置 → 玩家分配剩餘 5 點」這個流程在前後端一致。

---

## 三、64 個預設模板骨架 Seed Data

### 3.1 生成邏輯說明

64 個預設模板的建立遵循以下規則：

1. **每個四字碼生成 4 筆紀錄**（`career_index` = 1–4）
2. **`dominant_letter` 對應四字碼的字母位置**（職業 1 → 第 1 字母，以此類推）
3. **所有敘事欄位（`name_zh`、`title_zh`、`backstory`、`ability_text_zh` 等）留空（NULL 或空字串）**
4. **屬性配點依該模板的四字碼自動計算基礎 13 點**，剩餘 5 點預設為各 0（由設計者後續填入）
5. **`is_preset = TRUE`、`is_completed = FALSE`**

### 3.2 Seed Data 生成腳本

建議使用資料庫遷移腳本自動生成，避免手動填寫 64 筆 INSERT。

```sql
-- 先確保 faction_attribute_map 已填入
-- 使用 CTE 生成 64 筆骨架

WITH mbti_list AS (
  SELECT unnest(ARRAY[
    'INTJ','INTP','ENTJ','ENTP',
    'INFJ','INFP','ENFJ','ENFP',
    'ISTJ','ISFJ','ESTJ','ESFJ',
    'ISTP','ISFP','ESTP','ESFP'
  ]) AS mbti_code
),
career_numbers AS (
  SELECT generate_series(1, 4) AS career_index
),
template_skeleton AS (
  SELECT
    m.mbti_code,
    c.career_index,
    SUBSTRING(m.mbti_code, c.career_index, 1) AS dominant_letter
  FROM mbti_list m
  CROSS JOIN career_numbers c
)
INSERT INTO investigator_templates (
  code, name_zh, name_en, title_zh, title_en,
  faction_id,
  mbti_code, career_index, dominant_letter,
  attr_strength, attr_agility, attr_constitution,
  attr_intellect, attr_willpower, attr_perception, attr_charisma,
  proficiency_ids, signature_card_ids, weakness_card_id,
  backstory, ability_text_zh,
  era_tags, portrait_url,
  is_preset, is_completed
)
SELECT
  -- code: 例 'INTJ-1', 'ENTJ-3'
  t.mbti_code || '-' || t.career_index::text AS code,

  -- 所有敘事欄位留空
  NULL AS name_zh,
  NULL AS name_en,
  NULL AS title_zh,
  NULL AS title_en,

  -- faction_id: 依 MBTI 第一個字母（E 或 I）對應 factions 表
  (SELECT id FROM factions WHERE code = SUBSTRING(t.mbti_code, 1, 1) LIMIT 1) AS faction_id,

  t.mbti_code,
  t.career_index,
  t.dominant_letter,

  -- 屬性配點：依四字碼計算基礎 13 點
  -- 基礎 +1，若該屬性是主陣營主屬性則再 +3，若是副陣營主屬性則再 +1
  -- 注意：支柱五 §1.2 修正案的對照
  1 + CASE WHEN main_attr_is('strength',     t.mbti_code) THEN 3 ELSE 0 END
    + sub_attr_count('strength',             t.mbti_code) AS attr_strength,
  1 + CASE WHEN main_attr_is('agility',      t.mbti_code) THEN 3 ELSE 0 END
    + sub_attr_count('agility',              t.mbti_code) AS attr_agility,
  1 + CASE WHEN main_attr_is('constitution', t.mbti_code) THEN 3 ELSE 0 END
    + sub_attr_count('constitution',         t.mbti_code) AS attr_constitution,
  1 + CASE WHEN main_attr_is('intellect',    t.mbti_code) THEN 3 ELSE 0 END
    + sub_attr_count('intellect',            t.mbti_code) AS attr_intellect,
  1 + CASE WHEN main_attr_is('willpower',    t.mbti_code) THEN 3 ELSE 0 END
    + sub_attr_count('willpower',            t.mbti_code) AS attr_willpower,
  1 + CASE WHEN main_attr_is('perception',   t.mbti_code) THEN 3 ELSE 0 END
    + sub_attr_count('perception',           t.mbti_code) AS attr_perception,
  1 + CASE WHEN main_attr_is('charisma',     t.mbti_code) THEN 3 ELSE 0 END
    + sub_attr_count('charisma',             t.mbti_code) AS attr_charisma,

  ARRAY[]::UUID[] AS proficiency_ids,
  ARRAY[]::UUID[] AS signature_card_ids,
  NULL::UUID AS weakness_card_id,

  NULL AS backstory,
  NULL AS ability_text_zh,
  NULL AS era_tags,
  NULL AS portrait_url,

  TRUE  AS is_preset,
  FALSE AS is_completed
FROM template_skeleton t;
```

### 3.3 輔助函數（PostgreSQL Functions）

因為屬性配點計算複雜，建議建立 PL/pgSQL 輔助函數。**但上述 CHECK 約束要求總點數 = 18，而骨架只分配到 13 點**，所以必須先將約束改為 `<= 18`，等設計者填入剩餘 5 點後才達到 18。

**解決方案：** Schema 修正 CHECK 約束為兩階段驗證。

```sql
-- 移除舊約束
ALTER TABLE investigator_templates DROP CONSTRAINT IF EXISTS chk_total_points;

-- 新約束：is_completed = TRUE 時必須 = 18，否則允許 = 13（骨架狀態）或介於中間
ALTER TABLE investigator_templates
ADD CONSTRAINT chk_total_points CHECK (
  CASE
    WHEN is_completed = TRUE THEN
      (attr_strength + attr_agility + attr_constitution +
       attr_intellect + attr_willpower + attr_perception + attr_charisma) = 18
    ELSE
      (attr_strength + attr_agility + attr_constitution +
       attr_intellect + attr_willpower + attr_perception + attr_charisma) BETWEEN 13 AND 18
  END
);
```

### 3.4 輔助函數定義

```sql
-- 判斷某屬性是否為該 MBTI 的主陣營主屬性
CREATE OR REPLACE FUNCTION main_attr_is(target_attr TEXT, mbti TEXT) RETURNS BOOLEAN AS $$
DECLARE
  main_letter CHAR(1);
  main_attr TEXT;
BEGIN
  main_letter := SUBSTRING(mbti, 1, 1);
  SELECT main_attribute INTO main_attr FROM faction_attribute_map WHERE faction_code = main_letter;
  RETURN main_attr = target_attr;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 計算某屬性在該 MBTI 的副陣營中出現次數
-- （注意：I 與 T 共享 intellect，若同時出現於副陣營會累加）
CREATE OR REPLACE FUNCTION sub_attr_count(target_attr TEXT, mbti TEXT) RETURNS INTEGER AS $$
DECLARE
  count_result INTEGER := 0;
  sub_letter CHAR(1);
  sub_attr TEXT;
  i INTEGER;
BEGIN
  FOR i IN 2..4 LOOP
    sub_letter := SUBSTRING(mbti, i, 1);
    SELECT main_attribute INTO sub_attr FROM faction_attribute_map WHERE faction_code = sub_letter;
    IF sub_attr = target_attr THEN
      count_result := count_result + 1;
    END IF;
  END LOOP;
  RETURN count_result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### 3.5 預期生成結果驗證

執行完 Seed 腳本後，應該產生 **64 筆** `is_preset = TRUE` 紀錄，每筆都有：
- `mbti_code` 填入（如 'INTJ'）
- `career_index` 填入（1–4）
- `dominant_letter` 填入（四字碼對應位置的字母）
- 屬性總和 = 13（尚未分配的 5 點留給設計者）
- 所有敘事欄位為 NULL
- `is_completed = FALSE`

**驗證查詢：**

```sql
-- 確認總筆數 = 64
SELECT COUNT(*) FROM investigator_templates WHERE is_preset = TRUE;
-- 應回傳 64

-- 確認每個 MBTI 都有 4 筆
SELECT mbti_code, COUNT(*) FROM investigator_templates
  WHERE is_preset = TRUE GROUP BY mbti_code ORDER BY mbti_code;
-- 應回傳 16 行，每行 count = 4

-- 確認屬性總和為 13
SELECT mbti_code, career_index,
  (attr_strength + attr_agility + attr_constitution +
   attr_intellect + attr_willpower + attr_perception + attr_charisma) AS total
FROM investigator_templates
WHERE is_preset = TRUE
  AND (attr_strength + attr_agility + attr_constitution +
       attr_intellect + attr_willpower + attr_perception + attr_charisma) != 13;
-- 應回傳 0 行
```

### 3.6 預期屬性分佈範例

以 **ENTJ** 為例（主陣營 E 魅力 +3，副陣營 N 意志 +1、T 智力 +1、J 體質 +1）：

| 屬性 | 計算 | 值 |
|------|------|-----|
| 力量 | 基礎 1 | 1 |
| 敏捷 | 基礎 1 | 1 |
| 體質 | 基礎 1 + J 副 1 | 2 |
| 智力 | 基礎 1 + T 副 1 | 2 |
| 意志 | 基礎 1 + N 副 1 | 2 |
| 感知 | 基礎 1 | 1 |
| 魅力 | 基礎 1 + E 主 3 | 4 |
| **總計** | | **13** |

**註：** 設計者打開設計器後，還需要分配剩餘 5 點到任意屬性（受創角上限 5 限制）。

以 **INTJ** 為例（主陣營 I 智力 +3，副陣營 N 意志 +1、T 智力 +1、J 體質 +1）：

| 屬性 | 計算 | 值 |
|------|------|-----|
| 智力 | 基礎 1 + I 主 3 + T 副 1 | **5**（疊到上限） |
| 意志 | 基礎 1 + N 副 1 | 2 |
| 體質 | 基礎 1 + J 副 1 | 2 |
| 其他 4 個 | 基礎 1 各 | 各 1 |
| **總計** | | **13** |

> **重要觀察：** INTJ 的智力基礎值已達 5（創角上限），設計者不能再把剩餘 5 點分配到智力。這是支柱五 §1.2 刻意設計的「四字碼的數學後果」。

---

## 四、後端 API 設計

本模組需要約 25+ 個 API 端點，分為五組。

### 4.1 調查員模板 CRUD

```
GET    /api/admin/investigators
       Query: ?mbti=ENTJ&is_preset=true&is_completed=false&page=1&limit=20
       回傳: 分頁的模板清單

GET    /api/admin/investigators/:id
       回傳: 單一模板完整資料（含簽名卡、弱點、起始牌組）

POST   /api/admin/investigators
       Body: { mbti_code?, career_index?, ... 敘事欄位 }
       用途: 建立玩家自建模板（is_preset = FALSE）

PATCH  /api/admin/investigators/:id
       Body: 任何模板欄位
       副作用: 若所有必要欄位填滿，自動更新 is_completed = TRUE

DELETE /api/admin/investigators/:id
       限制: 預設模板（is_preset = TRUE）不可刪除，僅可 clear（清空敘事欄位）

POST   /api/admin/investigators/:id/clear
       用途: 將預設模板清回骨架狀態（清空敘事、重置屬性為基礎 13 點）
       限制: 僅限預設模板使用

POST   /api/admin/investigators/:id/clone
       用途: 複製一個模板（複製結果為自建模板 is_preset = FALSE）
```

### 4.2 簽名卡管理（內建於調查員）

```
GET    /api/admin/investigators/:id/signature-cards
       回傳: 該調查員的所有簽名卡（最多 3 張）

POST   /api/admin/investigators/:id/signature-cards
       Body: { card_order, name_zh, card_type, cost, commit_icons, ... }
       限制: card_order 必須 1–3 且不重複

PATCH  /api/admin/investigators/:id/signature-cards/:card_id
       Body: 任何簽名卡欄位

DELETE /api/admin/investigators/:id/signature-cards/:card_id
       副作用: 自動從 investigator_starting_deck 移除對應紀錄
```

### 4.3 個人弱點管理

```
GET    /api/admin/investigators/:id/weakness
       回傳: 該調查員的個人弱點（最多 1 張）

PUT    /api/admin/investigators/:id/weakness
       Body: { name_zh, weakness_type, trigger_condition, negative_effect, ... }
       用途: 建立或更新（upsert），因為每個調查員僅 1 張弱點

DELETE /api/admin/investigators/:id/weakness
       副作用: 自動從 investigator_starting_deck 移除
```

### 4.4 起始牌組構築

```
GET    /api/admin/investigators/:id/starting-deck
       回傳: 牌組完整內容（含每張卡的詳細資料）
       計算: 自動算出總張數、費用曲線、類型分佈、陣營分佈

POST   /api/admin/investigators/:id/starting-deck/cards
       Body: { card_definition_id | signature_card_id | weakness_id, quantity }
       限制: 一般卡必須屬於該調查員的四字碼卡池（依 MBTI 對應的四陣營 + 中立）

PATCH  /api/admin/investigators/:id/starting-deck/cards/:slot_id
       Body: { quantity }

DELETE /api/admin/investigators/:id/starting-deck/cards/:slot_id
       限制: 簽名卡和弱點不可從牌組中刪除

GET    /api/admin/investigators/:id/starting-deck/validate
       回傳: {
         totalCards: 17,
         isValid: true,
         warnings: ['建議增加低費卡比例'],
         errors: [],
         minCards: 15,
         maxCards: 20
       }

GET    /api/admin/investigators/:id/available-cards
       Query: ?card_type=asset&cost_min=1&cost_max=3
       回傳: 依該調查員四字碼可存取的一般卡池（MOD-01 卡片中符合條件者）
```

### 4.5 預設模板與統計

```
GET    /api/admin/investigators/preset-matrix
       回傳: 16×4 矩陣總覽，含每個模板的完成度指標
       {
         'ENTJ': {
           1: { id, is_completed, name_zh, dominant_letter: 'E' },
           2: { id, is_completed, name_zh, dominant_letter: 'N' },
           3: { id, is_completed, name_zh, dominant_letter: 'T' },
           4: { id, is_completed, name_zh, dominant_letter: 'J' }
         },
         ...
       }

GET    /api/admin/investigators/stats
       回傳: {
         totalPresets: 64,
         completedPresets: 12,
         completionRate: 0.1875,
         byMbti: { ... },
         byDominantLetter: { E: 8, I: 4, ... },
         byEraTag: { '1920s': 45, 'ancient': 3, ... }
       }

GET    /api/admin/investigators/:id/preview
       回傳: 完整玩家視角的調查員預覽（ID 卡 + 起始牌組整合視圖）
```

### 4.6 陣營與屬性對照查詢

```
GET    /api/admin/faction-attribute-map
       回傳: 八陣營主屬性對照（支柱五 §1.2 修正案）

GET    /api/admin/mbti-types
       回傳: 16 種 MBTI 的基本資訊
```

---

## 五、後端驗證邏輯

### 5.1 `is_completed` 的自動計算

當 PATCH 更新模板時，後端應自動判斷以下條件全部滿足才將 `is_completed` 設為 TRUE：

1. `name_zh` 非空
2. `title_zh` 非空
3. `backstory` 非空（至少 50 字元）
4. `ability_text_zh` 非空
5. 七屬性總和 = 18
6. `proficiency_ids` 至少有 1 個
7. 至少 2 張簽名卡（`investigator_signature_cards` 查詢）
8. 1 張個人弱點（`investigator_weaknesses` 查詢）
9. 起始牌組總張數介於 15–20

任一條件不滿足時，`is_completed` 自動設為 FALSE。

### 5.2 起始牌組陣營驗證

新增一般卡到起始牌組時，後端必須驗證：
- 該卡的歸屬陣營（`card_definitions.faction_code`）必須是該調查員 MBTI 四字碼的其中一個字母，或是中立卡（`faction_code IS NULL` 或 `'neutral'`）
- 若不符則回傳 400 錯誤

```javascript
// 驗證邏輯範例
function validateCardInDeck(card, investigator) {
  const allowedFactions = investigator.mbti_code.split('');
  const cardFaction = card.faction_code;

  if (!cardFaction || cardFaction === 'neutral') return true;
  if (allowedFactions.includes(cardFaction)) return true;

  throw new Error(
    `卡片「${card.name_zh}」屬於 ${cardFaction} 陣營，` +
    `但此調查員（${investigator.mbti_code}）無法存取該陣營卡池`
  );
}
```

### 5.3 簽名卡數量限制

新增簽名卡時，後端必須驗證：
- 該調查員現有簽名卡數量 < 3
- `card_order` 未被其他簽名卡佔用

### 5.4 屬性自由分配上限

更新屬性時，後端必須驗證：
- 每個屬性值介於 1–5（創角上限）
- 七屬性總和 ≤ 18

---

## 六、資料遷移腳本執行順序

執行時請按此順序，確保依賴關係正確：

1. `admin-shared.js` 修正（GAME_RULES、ENEMY_TIERS、MBTI_TYPES、FACTION_ATTRIBUTE_MAP、calculateBaseAttributes）
2. `faction_attribute_map` 表建立 + Seed Data
3. `investigator_templates` 表修正（CHECK 約束、欄位擴充）
4. `investigator_signature_cards` 表建立
5. `investigator_weaknesses` 表建立
6. `investigator_starting_deck` 表建立
7. PL/pgSQL 輔助函數建立（`main_attr_is`、`sub_attr_count`）
8. 64 個預設模板 Seed 腳本執行
9. Seed 結果驗證查詢執行

---

## 七、Part 1 交付確認清單

實作 Part 1 後應達成以下狀態：

- [ ] `admin-shared.js` 三項修正完成（創角點數、getModifier、ENEMY_TIERS）
- [ ] `admin-shared.js` 新增 MBTI_TYPES、FACTION_ATTRIBUTE_MAP、calculateBaseAttributes
- [ ] `faction_attribute_map` 表建立並填入 8 筆 Seed
- [ ] `investigator_templates` 擴充 7 個新欄位
- [ ] `investigator_templates` CHECK 約束改為支援骨架狀態（13–18 彈性）
- [ ] 3 張新表建立（signature_cards、weaknesses、starting_deck）
- [ ] 2 個 PL/pgSQL 輔助函數建立
- [ ] 64 筆 `is_preset = TRUE` 預設模板紀錄建立
- [ ] 驗證查詢通過：總筆數 64、每 MBTI 4 筆、屬性總和 13
- [ ] 25+ 個 API 端點實作完成（CRUD、簽名卡、弱點、牌組、統計）
- [ ] 後端驗證邏輯實作（自動 is_completed、陣營驗證、數量限制、屬性上限）

---

## 八、文件版本紀錄

| 版本 | 日期 | 變更內容 |
|------|------|---------|
| v1.0 | 2026/04/16 | 初版建立 — 5 張資料表、64 預設模板 Seed 生成邏輯、支柱五 §1.2 修正案 Seed、25+ 後端 API、admin-shared.js 修正清單 |

---

> **接續文件：** `Claude_Code_MOD11_Investigator_Designer_指令_Part2.md`（設計器 UI）
>
> **Part 2 內容預告：** 三欄佈局、預設模板矩陣（16×4 網格）、ID 卡編輯六區塊、內建簽名卡設計器、個人弱點編輯器、起始牌組構築介面（含三欄式拖拉設計）
