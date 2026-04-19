# Claude Code 指令文件：MOD-09 鍛造與製作管理（Part 1 / 2）
## Admin Module — Forge & Craft Manager Build Instructions (Part 1 of 2)

> **模組代號：** MOD-09
> **模組名稱：** 鍛造與製作管理（Forge & Craft Manager）
> **本檔內容：** 資料庫結構、素材與詞條 Seed Data、後端 API、鍛造費用計算邏輯
> **配套檔案：** Part 2（設計器 UI + Gemini AI 輔助 + 總覽面板）
> **撰寫日期：** 2026/04/16

---

## 零、前置說明

### 0.1 模組定位

MOD-09 是 Admin Module v0.2.1 的鍛造與製作設計工具。其核心定位為：

1. **設計對象：** 鍛造詞條（Forging Affixes）+ 製作配方（Crafting Recipes）
2. **設計者：** 系統管理員／遊戲設計師
3. **不管轄的範圍：** 玩家遊玩時的實際鍛造紀錄、配方解鎖狀態等**運行時資料**

### 0.2 與其他模組的關係

| 上游依賴 | 內容 |
|---------|------|
| MOD-01 卡片設計器 | 配方的產出卡片、鍛造詞條的適用卡片類型 |
| MOD-03 敵人設計器 | 怪物素材的類別對應 `monster_families` |
| MOD-04 團隊精神 | 鍛造 / 製作的解鎖由 `ts_forge_unlock`、`ts_craft_unlock` 控制（本模組不處理解鎖邏輯，僅標記需求） |

| 下游使用 | 內容 |
|---------|------|
| 玩家端鍛造介面 | 讀取詞條定義、素材定義、鍛造費用計算規則 |
| 玩家端製作介面 | 讀取配方定義 |

### 0.3 本模組的設計範圍與非範圍

**範圍內：**
- 素材定義（5 類 × 10 等級 + 怪物素材家族對應）
- 鍛造詞條定義（名稱、效果、適用卡片子類型、+1/+2/+3 階級 V 值）
- 製作配方定義（產出卡片、所需素材、資源花費、解鎖條件敘事）
- 鍛造費用計算邏輯（詞條 V ÷ 素材 SV，向上進位）
- 詞條 Seed Data（23 個規則書第四章第四節所列詞條）

**範圍外：**
- 玩家的鍛造紀錄表（運行時資料，屬於遊戲主引擎）
- 配方解鎖邏輯的實作（解鎖條件是敘事性描述，實際觸發在場景系統）
- 鍛造手續費與製作手續費的具體資源數值（規則書標為「待定」，暫不處理）
- 團隊精神深度 × 鍛造/製作能力的具體對應公式（暫不處理）
- 鍛造上限突破的陣營能力（暫不處理）

---

## 一、資料庫結構

本模組新增 6 張資料表。

### 1.1 `material_categories` — 素材類別

5 類素材的基礎定義。

```sql
CREATE TABLE material_categories (
  code              VARCHAR(16) PRIMARY KEY,
    /* 'mineral', 'wood', 'insect', 'fish', 'monster' */
  name_zh           VARCHAR(16) NOT NULL,
  name_en           VARCHAR(32) NOT NULL,
  theme_description TEXT,
    /* 主題描述，如「堅硬、鋒利、防護」 */
  source_type       VARCHAR(16) NOT NULL,
    /* 'exploration'（場景採集）、'monster_drop'（怪物掉落） */
  display_color     VARCHAR(8),
    /* 十六進位色碼，供 UI 顯示 */
  icon_code         VARCHAR(32),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Seed Data：**

```sql
INSERT INTO material_categories (code, name_zh, name_en, theme_description, source_type, display_color, sort_order) VALUES
  ('mineral', '礦物', 'Mineral',  '堅硬、鋒利、防護',      'exploration',  '#8B7355', 1),
  ('wood',    '木材', 'Wood',     '結構、支撐、效率',      'exploration',  '#6B4423', 2),
  ('insect',  '蟲類', 'Insect',   '毒素、寄生、腐蝕',      'exploration',  '#556B2F', 3),
  ('fish',    '魚類', 'Fish',     '滑溜、適應、恢復',      'exploration',  '#4A7C9B', 4),
  ('monster', '怪物素材', 'Monster Part', '超自然、力量、恐懼', 'monster_drop', '#7B4EA3', 5);
```

### 1.2 `material_definitions` — 具體素材定義

每類素材 10 個等級，共 50 筆基礎紀錄。怪物素材進一步細分至家族層級。

```sql
CREATE TABLE material_definitions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code     VARCHAR(16) NOT NULL REFERENCES material_categories(code),
  material_level    INTEGER NOT NULL CHECK (material_level BETWEEN 1 AND 10),

  -- 具體素材名稱（每個等級可以有多個具體素材，但至少一個）
  name_zh           VARCHAR(32) NOT NULL,
  name_en           VARCHAR(64),

  -- 素材價值（SV），由等級決定，此欄位冗餘儲存供查詢
  material_value    INTEGER NOT NULL,

  -- 家族對應（僅怪物素材使用）
  monster_family_id UUID,
    /* 若 category_code = 'monster' 必填，對應 monster_families.id
       目前暫不建立外鍵（避免強耦合 MOD-03），後端應用層驗證 */

  -- 敘事
  description       TEXT,
  flavor_text       TEXT,
  icon_url          TEXT,

  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_materials_category ON material_definitions(category_code);
CREATE INDEX idx_materials_level ON material_definitions(material_level);
CREATE INDEX idx_materials_family ON material_definitions(monster_family_id)
  WHERE monster_family_id IS NOT NULL;

-- 觸發器：插入時依等級自動填入 material_value
CREATE OR REPLACE FUNCTION auto_fill_material_value() RETURNS TRIGGER AS $$
BEGIN
  NEW.material_value := CASE
    WHEN NEW.material_level BETWEEN 1 AND 2 THEN 1
    WHEN NEW.material_level BETWEEN 3 AND 4 THEN 2
    WHEN NEW.material_level BETWEEN 5 AND 6 THEN 3
    WHEN NEW.material_level BETWEEN 7 AND 8 THEN 5
    WHEN NEW.material_level BETWEEN 9 AND 10 THEN 8
    ELSE 1
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_fill_material_value
  BEFORE INSERT OR UPDATE OF material_level ON material_definitions
  FOR EACH ROW EXECUTE FUNCTION auto_fill_material_value();
```

**Seed Data 原則：**

- 礦物、木材、蟲類、魚類：每個等級預建 1 個「預設」素材（名稱可留空由設計者填寫）
- 怪物素材：預先為 10 組怪物家族（MOD-03）各預建 10 個等級的骨架（100 筆）

```sql
-- 非怪物類素材骨架（4 類 × 10 等級 = 40 筆）
INSERT INTO material_definitions (category_code, material_level, name_zh, name_en)
SELECT c.code, lv.level, '', ''
FROM (SELECT code FROM material_categories WHERE source_type = 'exploration') c
CROSS JOIN (SELECT generate_series(1, 10) AS level) lv;

-- 怪物類素材：暫以 monster_family_id = NULL 建立 10 個等級骨架
-- 待 MOD-03 的 monster_families 表資料穩定後，由設計者在 MOD-09 介面中新增具體素材
```

### 1.3 `forging_affixes` — 鍛造詞條定義

```sql
CREATE TABLE forging_affixes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              VARCHAR(48) UNIQUE NOT NULL,
    /* 如 'blade', 'sturdy', 'armor_forge' */

  -- 基本資訊
  name_zh           VARCHAR(32) NOT NULL,
  name_en           VARCHAR(64),
  category_code     VARCHAR(16) NOT NULL REFERENCES material_categories(code),
    /* 詞條屬於哪個素材類別 */

  -- 效果敘事
  effect_description_zh TEXT NOT NULL,
  effect_description_en TEXT,

  -- 適用卡片子類型（JSONB 陣列）
  applicable_subtypes JSONB NOT NULL DEFAULT '[]',
    /* 例：["weapon_melee", "weapon_ranged"]
       可能值：weapon_melee, weapon_ranged, weapon_arcane,
               arcane_item, item, consumable, light_source,
               'all_asset'（= 全資產都可） */

  -- 階級設計
  tier_mode         VARCHAR(16) NOT NULL DEFAULT 'scaling',
    /* 'scaling': +1/+2/+3 三階級
       'fixed':   固定效果，無 +X 階級（如「快速」「元素附魔」）
       'choice':  選一個選項（如蟲類 I/II/III 階級選具體狀態） */

  -- 設計狀態
  design_status     VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (design_status IN ('pending', 'partial', 'complete')),

  -- 補充備註
  notes             TEXT,
    /* 設計備註，如「僅適用於有使用次數的卡片」 */

  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_affixes_category ON forging_affixes(category_code);
CREATE INDEX idx_affixes_status ON forging_affixes(design_status);
```

**三種 `tier_mode` 的設計背景：**

| 模式 | 說明 | 範例 |
|------|------|------|
| `scaling` | 有 +1/+2/+3 三階，V 值遞增 | 利刃（傷害 +X）、補給（次數 +X） |
| `fixed` | 固定效果，無階級 | 快速（不用行動點）、元素附魔 |
| `choice` | 玩家從清單選一個選項 | 蟲類的蟲淬 I/II/III 選具體狀態 |

### 1.4 `forging_affix_tiers` — 詞條階級與 V 值

一對多子表。每個詞條可以有 1 到多個「階級」紀錄：
- `scaling` 模式的詞條有 3 筆（+1, +2, +3）
- `fixed` 模式的詞條有 1 筆
- `choice` 模式的詞條有 N 筆（每個選項一筆）

```sql
CREATE TABLE forging_affix_tiers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affix_id          UUID NOT NULL REFERENCES forging_affixes(id) ON DELETE CASCADE,
  tier_label        VARCHAR(32) NOT NULL,
    /* scaling 模式：'+1', '+2', '+3'
       fixed 模式：'fixed' 或具體名稱（如 'arcane' 作為元素附魔的「神秘」版本）
       choice 模式：選項名稱（如 'bleed', 'poison', 'burn'） */

  tier_order        INTEGER NOT NULL DEFAULT 0,
    /* 顯示順序 */

  -- V 值
  affix_value       DECIMAL(5,1) NOT NULL DEFAULT 0,
    /* 詞條的面值，不乘使用次數（規則書第四章 §2.4 明確規定） */

  -- 具體效果描述（可細化每階級的敘事差異）
  effect_detail_zh  TEXT,
  effect_detail_en  TEXT,

  -- 額外選項（choice 模式專用）
  choice_payload    JSONB,
    /* 例：{"status": "bleed", "stacks": 1}
       用於紀錄「此選項會施加什麼狀態」的結構化資料 */

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (affix_id, tier_label)
);

CREATE INDEX idx_affix_tiers_affix ON forging_affix_tiers(affix_id);
```

### 1.5 `crafting_recipes` — 製作配方

```sql
CREATE TABLE crafting_recipes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              VARCHAR(64) UNIQUE NOT NULL,

  -- 配方基本資訊
  name_zh           VARCHAR(64) NOT NULL,
  name_en           VARCHAR(128),
  description       TEXT,

  -- 產出
  output_card_id    UUID REFERENCES card_definitions(id),
    /* 指向 MOD-01 的卡片定義。可為 NULL 表示「設計中尚未指向具體卡片」 */
  output_is_temporary BOOLEAN NOT NULL DEFAULT FALSE,
    /* 規則書第四章 §5.4：臨時卡片（不可鍛造） */
  output_quantity   INTEGER NOT NULL DEFAULT 1 CHECK (output_quantity >= 1),

  -- 解鎖敘事（不是執行邏輯，只是設計者標註如何取得此配方）
  unlock_narrative  TEXT,
    /* 例：「在阿卡姆地下墓穴探索時，從牆壁刻文獲得」 */
  unlock_type       VARCHAR(32),
    /* 'default'（初始已知）、'exploration'（場景探索）、
       'faction_talent'（陣營天賦）、'story_event'（劇情事件）、
       'quest_reward'（任務獎勵）、'hidden' */

  -- 設計狀態
  design_status     VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (design_status IN ('pending', 'partial', 'complete')),

  -- 備註
  notes             TEXT,

  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recipes_output ON crafting_recipes(output_card_id);
CREATE INDEX idx_recipes_unlock ON crafting_recipes(unlock_type);
CREATE INDEX idx_recipes_status ON crafting_recipes(design_status);
```

### 1.6 `crafting_recipe_materials` — 配方素材需求

一對多子表。每個配方可以指定多種素材需求。

```sql
CREATE TABLE crafting_recipe_materials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id         UUID NOT NULL REFERENCES crafting_recipes(id) ON DELETE CASCADE,

  -- 素材指定方式（兩種模式擇一）
  category_code     VARCHAR(16) REFERENCES material_categories(code),
    /* 「任一此類別的素材」模式 */
  specific_material_id UUID REFERENCES material_definitions(id),
    /* 「指定具體素材」模式 */

  min_material_level INTEGER CHECK (min_material_level BETWEEN 1 AND 10),
    /* 若使用 category_code 模式，可再加等級下限限制 */

  quantity          INTEGER NOT NULL CHECK (quantity >= 1),

  sort_order        INTEGER NOT NULL DEFAULT 0,

  -- 兩種指定方式擇一：必須剛好有一個非 NULL
  CONSTRAINT chk_material_specification CHECK (
    (category_code IS NOT NULL AND specific_material_id IS NULL) OR
    (category_code IS NULL AND specific_material_id IS NOT NULL)
  )
);

CREATE INDEX idx_recipe_materials_recipe ON crafting_recipe_materials(recipe_id);
```

**兩種素材指定模式的差別：**

| 模式 | 說明 | 範例 |
|------|------|------|
| 類別模式 | 「任何此類別的素材 N 個」 | 「2 個木材（任一種類，LV3+）」 |
| 指定模式 | 「某個具體素材 N 個」 | 「3 個深潛者鱗片（LV5）」 |

---

## 二、鍛造費用計算函數

鍛造費用的核心公式：

> **所需素材數量 = 詞條價值（V）÷ 素材價值（SV），向上進位**

### 2.1 PL/pgSQL 計算函數

```sql
CREATE OR REPLACE FUNCTION calc_forging_material_quantity(
  p_affix_value DECIMAL,
  p_material_level INTEGER
) RETURNS INTEGER AS $$
DECLARE
  sv INTEGER;
BEGIN
  -- 素材價值對照
  sv := CASE
    WHEN p_material_level BETWEEN 1 AND 2 THEN 1
    WHEN p_material_level BETWEEN 3 AND 4 THEN 2
    WHEN p_material_level BETWEEN 5 AND 6 THEN 3
    WHEN p_material_level BETWEEN 7 AND 8 THEN 5
    WHEN p_material_level BETWEEN 9 AND 10 THEN 8
    ELSE 1
  END;

  -- 向上進位
  RETURN CEIL(p_affix_value / sv);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### 2.2 試算工具：輸入詞條與素材等級，回傳所需數量

```sql
CREATE OR REPLACE FUNCTION preview_forging_cost(
  p_affix_tier_id UUID,
  p_material_level INTEGER
) RETURNS TABLE (
  affix_name VARCHAR,
  tier_label VARCHAR,
  affix_value DECIMAL,
  material_sv INTEGER,
  required_quantity INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    fa.name_zh,
    fat.tier_label,
    fat.affix_value,
    CASE
      WHEN p_material_level BETWEEN 1 AND 2 THEN 1
      WHEN p_material_level BETWEEN 3 AND 4 THEN 2
      WHEN p_material_level BETWEEN 5 AND 6 THEN 3
      WHEN p_material_level BETWEEN 7 AND 8 THEN 5
      WHEN p_material_level BETWEEN 9 AND 10 THEN 8
      ELSE 1
    END::INTEGER,
    calc_forging_material_quantity(fat.affix_value, p_material_level)
  FROM forging_affix_tiers fat
  JOIN forging_affixes fa ON fa.id = fat.affix_id
  WHERE fat.id = p_affix_tier_id;
END;
$$ LANGUAGE plpgsql STABLE;
```

---

## 三、23 種鍛造詞條 Seed Data

依規則書第四章第四節預建完整 Seed Data。

### 3.1 礦物類詞條（5 種）

```sql
INSERT INTO forging_affixes (code, name_zh, name_en, category_code, effect_description_zh, applicable_subtypes, tier_mode, design_status) VALUES
  ('blade',          '利刃',     'Blade',         'mineral', '傷害 +X', '["weapon_melee", "weapon_ranged"]',    'scaling', 'complete'),
  ('sturdy',         '堅固',     'Sturdy',        'mineral', '資產 HP +X', '["all_asset"]',                     'scaling', 'complete'),
  ('armor_forge',    '護甲鍛造', 'Armor Forging', 'mineral', '使用時獲得護甲 X 層', '["all_asset"]',             'scaling', 'complete'),
  ('counter_strike', '反擊',     'Counter Strike','mineral', '被攻擊時攻擊者受 X 點傷害', '["weapon_melee", "weapon_ranged"]', 'scaling', 'complete'),
  ('multi_attack',   '多重攻擊', 'Multi Attack',  'mineral', '額外攻擊 X 次', '["weapon_melee", "weapon_ranged"]', 'scaling', 'complete');

-- 礦物類詞條的 tier 資料
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1, 1.0, '傷害 +1'     FROM forging_affixes a WHERE a.code = 'blade';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 2.0, '傷害 +2'     FROM forging_affixes a WHERE a.code = 'blade';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 3.0, '傷害 +3'     FROM forging_affixes a WHERE a.code = 'blade';

-- sturdy: +1(0.5V), +2(1V), +3(1.5V)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1, 0.5, '資產 HP +1' FROM forging_affixes a WHERE a.code = 'sturdy';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 1.0, '資產 HP +2' FROM forging_affixes a WHERE a.code = 'sturdy';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 1.5, '資產 HP +3' FROM forging_affixes a WHERE a.code = 'sturdy';

-- armor_forge: +1(3V), +2(6V), +3(9V)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1, 3.0, '使用時獲得護甲 1 層' FROM forging_affixes a WHERE a.code = 'armor_forge';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 6.0, '使用時獲得護甲 2 層' FROM forging_affixes a WHERE a.code = 'armor_forge';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 9.0, '使用時獲得護甲 3 層' FROM forging_affixes a WHERE a.code = 'armor_forge';

-- counter_strike: +1(1V), +2(2V), +3(3V)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1, 1.0, '被攻擊時攻擊者受 1 點傷害' FROM forging_affixes a WHERE a.code = 'counter_strike';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 2.0, '被攻擊時攻擊者受 2 點傷害' FROM forging_affixes a WHERE a.code = 'counter_strike';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 3.0, '被攻擊時攻擊者受 3 點傷害' FROM forging_affixes a WHERE a.code = 'counter_strike';

-- multi_attack: +1(1.5V), +2(3V), +3(4.5V)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1, 1.5, '額外攻擊 1 次' FROM forging_affixes a WHERE a.code = 'multi_attack';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 3.0, '額外攻擊 2 次' FROM forging_affixes a WHERE a.code = 'multi_attack';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 4.5, '額外攻擊 3 次' FROM forging_affixes a WHERE a.code = 'multi_attack';
```

### 3.2 木材類詞條（5 種）

```sql
INSERT INTO forging_affixes (code, name_zh, name_en, category_code, effect_description_zh, applicable_subtypes, tier_mode, design_status) VALUES
  ('supply',         '補給',     'Supply',       'wood', '使用次數 +X',
    '["weapon_ranged", "weapon_arcane", "item", "arcane_item"]', 'scaling', 'complete'),
  ('lightweight',    '輕量化',   'Lightweight',  'wood', '費用 -X',               '["all_asset"]', 'scaling', 'complete'),
  ('swift',          '快速',     'Swift',        'wood', '打出時不用行動點',        '["all_asset"]', 'fixed',   'complete'),
  ('extra_draw',     '附加：抽牌', 'Added: Draw',  'wood', '使用時抽 X 張卡',        '["all_asset"]', 'scaling', 'complete'),
  ('extra_recycle',  '附加：回收', 'Added: Recycle','wood', '進入棄牌堆時回收 X 張棄牌堆的卡', '["all_asset"]', 'scaling', 'complete');

-- supply: +1(0.5V), +2(1V), +3(1.5V)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1, 0.5, '使用次數 +1' FROM forging_affixes a WHERE a.code = 'supply';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 1.0, '使用次數 +2' FROM forging_affixes a WHERE a.code = 'supply';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 1.5, '使用次數 +3' FROM forging_affixes a WHERE a.code = 'supply';

-- lightweight: +1(1V), +2(2V), +3(3V)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1, 1.0, '費用 -1' FROM forging_affixes a WHERE a.code = 'lightweight';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 2.0, '費用 -2' FROM forging_affixes a WHERE a.code = 'lightweight';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 3.0, '費用 -3' FROM forging_affixes a WHERE a.code = 'lightweight';

-- swift: fixed 1V
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, 'fixed', 1, 1.0, '打出時不用行動點' FROM forging_affixes a WHERE a.code = 'swift';

-- extra_draw: +1(1V), +2(2V), +3(3V)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1, 1.0, '使用時抽 1 張卡' FROM forging_affixes a WHERE a.code = 'extra_draw';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 2.0, '使用時抽 2 張卡' FROM forging_affixes a WHERE a.code = 'extra_draw';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 3.0, '使用時抽 3 張卡' FROM forging_affixes a WHERE a.code = 'extra_draw';

-- extra_recycle: +1(1.5V), +2(3V), +3(4.5V)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1, 1.5, '進入棄牌堆時回收 1 張棄牌堆的卡' FROM forging_affixes a WHERE a.code = 'extra_recycle';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 3.0, '進入棄牌堆時回收 2 張棄牌堆的卡' FROM forging_affixes a WHERE a.code = 'extra_recycle';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 4.5, '進入棄牌堆時回收 3 張棄牌堆的卡' FROM forging_affixes a WHERE a.code = 'extra_recycle';
```

### 3.3 蟲類詞條（3 種，choice 模式）

蟲類的結構比較特別：每個詞條代表一個「階級」（I/II/III），每個階級內有多個具體狀態選項。

```sql
INSERT INTO forging_affixes (code, name_zh, name_en, category_code, effect_description_zh, applicable_subtypes, tier_mode, design_status, notes) VALUES
  ('insect_venom_1', '蟲淬 I',   'Insect Venom I',   'insect',
    '攻擊時施加指定的 1 層負面狀態', '["weapon_melee", "weapon_ranged", "weapon_arcane"]',
    'choice', 'complete', '選項：流血、脆弱、潮濕'),
  ('insect_venom_2', '蟲淬 II',  'Insect Venom II',  'insect',
    '攻擊時施加指定的 1 層負面狀態', '["weapon_melee", "weapon_ranged", "weapon_arcane"]',
    'choice', 'complete', '選項：中毒、燃燒、冷凍、弱化'),
  ('insect_venom_3', '蟲淬 III', 'Insect Venom III', 'insect',
    '攻擊時施加指定的 1 層負面狀態', '["weapon_melee", "weapon_ranged", "weapon_arcane"]',
    'choice', 'complete', '選項：繳械、疲勞、沈默');

-- insect_venom_1 的選項（每個選項是一個 tier）
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload)
SELECT a.id, 'bleed',   1, 2.0, '命中施加流血 1 層', '{"status": "bleed",   "stacks": 1}'
  FROM forging_affixes a WHERE a.code = 'insect_venom_1';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload)
SELECT a.id, 'fragile', 2, 2.0, '命中施加脆弱 1 層', '{"status": "fragile", "stacks": 1}'
  FROM forging_affixes a WHERE a.code = 'insect_venom_1';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload)
SELECT a.id, 'wet',     3, 1.0, '命中施加潮濕 1 層', '{"status": "wet",     "stacks": 1}'
  FROM forging_affixes a WHERE a.code = 'insect_venom_1';

-- insect_venom_2 的選項
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload)
SELECT a.id, 'poison',   1, 3.0, '命中施加中毒 1 層', '{"status": "poison",   "stacks": 1}'
  FROM forging_affixes a WHERE a.code = 'insect_venom_2';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload)
SELECT a.id, 'burn',     2, 3.0, '命中施加燃燒 1 層', '{"status": "burn",     "stacks": 1}'
  FROM forging_affixes a WHERE a.code = 'insect_venom_2';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload)
SELECT a.id, 'freeze',   3, 3.0, '命中施加冷凍 1 層', '{"status": "freeze",   "stacks": 1}'
  FROM forging_affixes a WHERE a.code = 'insect_venom_2';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload)
SELECT a.id, 'weaken',   4, 3.0, '命中施加弱化 1 層', '{"status": "weaken",   "stacks": 1}'
  FROM forging_affixes a WHERE a.code = 'insect_venom_2';

-- insect_venom_3 的選項
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload)
SELECT a.id, 'disarm',   1, 4.0, '命中施加繳械 1 層', '{"status": "disarm",   "stacks": 1}'
  FROM forging_affixes a WHERE a.code = 'insect_venom_3';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload)
SELECT a.id, 'fatigue',  2, 4.0, '命中施加疲勞 1 層', '{"status": "fatigue",  "stacks": 1}'
  FROM forging_affixes a WHERE a.code = 'insect_venom_3';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload)
SELECT a.id, 'silence',  3, 4.0, '命中施加沈默 1 層', '{"status": "silence",  "stacks": 1}'
  FROM forging_affixes a WHERE a.code = 'insect_venom_3';
```

### 3.4 魚類詞條（5 種）

```sql
INSERT INTO forging_affixes (code, name_zh, name_en, category_code, effect_description_zh, applicable_subtypes, tier_mode, design_status) VALUES
  ('mend',        '修補',     'Mend',        'fish', '使用時回復 X HP',     '["all_asset"]', 'scaling', 'complete'),
  ('soothe',      '安撫',     'Soothe',      'fish', '使用時回復 X SAN',    '["all_asset"]', 'scaling', 'complete'),
  ('resilience',  '韌性',     'Resilience',  'fish', '使用時取消 X 點傷害', '["all_asset"]', 'scaling', 'complete'),
  ('extra_shield','附加：護盾', 'Added: Shield','fish', '使用時獲得護盾 X 層', '["all_asset"]', 'scaling', 'complete'),
  ('extra_regen', '附加：再生', 'Added: Regen','fish', '使用時獲得再生 X 層',  '["all_asset"]', 'scaling', 'complete');

-- mend, soothe: +1(1.5V), +2(3V), +3(4.5V)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1, 1.5, '使用時回復 1 HP' FROM forging_affixes a WHERE a.code = 'mend';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 3.0, '使用時回復 2 HP' FROM forging_affixes a WHERE a.code = 'mend';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 4.5, '使用時回復 3 HP' FROM forging_affixes a WHERE a.code = 'mend';

INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1, 1.5, '使用時回復 1 SAN' FROM forging_affixes a WHERE a.code = 'soothe';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 3.0, '使用時回復 2 SAN' FROM forging_affixes a WHERE a.code = 'soothe';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 4.5, '使用時回復 3 SAN' FROM forging_affixes a WHERE a.code = 'soothe';

-- resilience: +1(0.5V), +2(1V), +3(1.5V)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1, 0.5, '使用時取消 1 點傷害' FROM forging_affixes a WHERE a.code = 'resilience';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 1.0, '使用時取消 2 點傷害' FROM forging_affixes a WHERE a.code = 'resilience';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 1.5, '使用時取消 3 點傷害' FROM forging_affixes a WHERE a.code = 'resilience';

-- extra_shield, extra_regen: +1(6V), +2(12V), +3(18V)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1,  6.0, '使用時獲得護盾 1 層' FROM forging_affixes a WHERE a.code = 'extra_shield';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 12.0, '使用時獲得護盾 2 層' FROM forging_affixes a WHERE a.code = 'extra_shield';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 18.0, '使用時獲得護盾 3 層' FROM forging_affixes a WHERE a.code = 'extra_shield';

INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1,  6.0, '使用時獲得再生 1 層' FROM forging_affixes a WHERE a.code = 'extra_regen';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 12.0, '使用時獲得再生 2 層' FROM forging_affixes a WHERE a.code = 'extra_regen';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 18.0, '使用時獲得再生 3 層' FROM forging_affixes a WHERE a.code = 'extra_regen';
```

### 3.5 怪物素材類詞條（5 種）

```sql
INSERT INTO forging_affixes (code, name_zh, name_en, category_code, effect_description_zh, applicable_subtypes, tier_mode, design_status) VALUES
  ('sharpen',         '銳化',       'Sharpen',         'monster',
    '單屬性檢定 +X', '["weapon_melee", "weapon_ranged", "weapon_arcane"]', 'scaling', 'complete'),
  ('intimidate',      '恐嚇',       'Intimidate',      'monster',
    '命中時造成 X 點恐懼傷害', '["weapon_melee", "weapon_ranged", "weapon_arcane"]', 'scaling', 'complete'),
  ('element_enchant', '元素附魔',   'Element Enchant', 'monster',
    '攻擊額外附加指定元素傷害', '["weapon_melee", "weapon_ranged", "weapon_arcane"]', 'choice', 'complete'),
  ('extra_stealth',   '附加：隱蔽', 'Added: Stealth',  'monster',
    '使用時獲得隱蔽 1 層', '["all_asset"]', 'fixed', 'complete'),
  ('extra_empower',   '附加：強化', 'Added: Empower',  'monster',
    '使用時獲得強化 X 層', '["all_asset"]', 'scaling', 'complete');

-- sharpen: +1(0.5V), +2(1.5V), +3(3V)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1, 0.5, '單屬性檢定 +1' FROM forging_affixes a WHERE a.code = 'sharpen';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 1.5, '單屬性檢定 +2' FROM forging_affixes a WHERE a.code = 'sharpen';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 3.0, '單屬性檢定 +3' FROM forging_affixes a WHERE a.code = 'sharpen';

-- intimidate: +1(3V), +2(6V), +3(9V)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1, 3.0, '命中時造成 1 點恐懼傷害' FROM forging_affixes a WHERE a.code = 'intimidate';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 6.0, '命中時造成 2 點恐懼傷害' FROM forging_affixes a WHERE a.code = 'intimidate';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 9.0, '命中時造成 3 點恐懼傷害' FROM forging_affixes a WHERE a.code = 'intimidate';

-- element_enchant: choice 模式，5 種元素（物理以外）
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload)
SELECT a.id, 'fire',     1, 2.0, '攻擊額外附加火元素傷害',     '{"element": "fire"}'
  FROM forging_affixes a WHERE a.code = 'element_enchant';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload)
SELECT a.id, 'ice',      2, 2.0, '攻擊額外附加冰元素傷害',     '{"element": "ice"}'
  FROM forging_affixes a WHERE a.code = 'element_enchant';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload)
SELECT a.id, 'electric', 3, 2.0, '攻擊額外附加雷元素傷害',     '{"element": "electric"}'
  FROM forging_affixes a WHERE a.code = 'element_enchant';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload)
SELECT a.id, 'arcane',   4, 3.0, '攻擊額外附加神秘元素傷害',   '{"element": "arcane"}'
  FROM forging_affixes a WHERE a.code = 'element_enchant';

-- extra_stealth: fixed 6V
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, 'fixed', 1, 6.0, '使用時獲得隱蔽 1 層' FROM forging_affixes a WHERE a.code = 'extra_stealth';

-- extra_empower: +1(3V), +2(6V), +3(9V)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+1', 1, 3.0, '使用時獲得強化 1 層' FROM forging_affixes a WHERE a.code = 'extra_empower';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+2', 2, 6.0, '使用時獲得強化 2 層' FROM forging_affixes a WHERE a.code = 'extra_empower';
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT a.id, '+3', 3, 9.0, '使用時獲得強化 3 層' FROM forging_affixes a WHERE a.code = 'extra_empower';
```

### 3.6 Seed Data 統計

| 類別 | 詞條數 | Tier 總數 |
|------|-------|----------|
| 礦物 | 5 | 15（5 × scaling 3 階） |
| 木材 | 5 | 13（4 × scaling 3 + 1 × fixed） |
| 蟲類 | 3 | 10（3 + 4 + 3 choice 選項） |
| 魚類 | 5 | 15 |
| 怪物 | 5 | 12（2 × scaling 3 + 1 × choice 4 + 1 × fixed + 1 × scaling 3 = 3+3+4+1+3） |
| **總計** | **23 詞條** | **約 65 筆 tier 紀錄** |

---

## 四、`admin-shared.js` 擴充

### 4.1 新增 `MATERIAL_CATEGORIES`

```javascript
const MATERIAL_CATEGORIES = {
  mineral: { code: 'mineral', zh: '礦物',     en: 'Mineral',      color: '#8B7355' },
  wood:    { code: 'wood',    zh: '木材',     en: 'Wood',         color: '#6B4423' },
  insect:  { code: 'insect',  zh: '蟲類',     en: 'Insect',       color: '#556B2F' },
  fish:    { code: 'fish',    zh: '魚類',     en: 'Fish',         color: '#4A7C9B' },
  monster: { code: 'monster', zh: '怪物素材', en: 'Monster Part', color: '#7B4EA3' },
};
```

### 4.2 新增 `MATERIAL_VALUE_TABLE`

```javascript
const MATERIAL_VALUE_TABLE = [
  { levelMin: 1,  levelMax: 2,  sv: 1 },
  { levelMin: 3,  levelMax: 4,  sv: 2 },
  { levelMin: 5,  levelMax: 6,  sv: 3 },
  { levelMin: 7,  levelMax: 8,  sv: 5 },
  { levelMin: 9,  levelMax: 10, sv: 8 },
];

function getMaterialSV(level) {
  const entry = MATERIAL_VALUE_TABLE.find(e => level >= e.levelMin && level <= e.levelMax);
  return entry?.sv ?? 1;
}

function calcForgingQuantity(affixValue, materialLevel) {
  const sv = getMaterialSV(materialLevel);
  return Math.ceil(affixValue / sv);
}
```

### 4.3 新增 `APPLICABLE_SUBTYPES`

與 MOD-01 卡片子類型一致，供詞條設計器下拉選單使用。

```javascript
const APPLICABLE_SUBTYPES = {
  weapon_melee:    { zh: '近戰武器',     en: 'Melee Weapon' },
  weapon_ranged:   { zh: '遠程物理武器', en: 'Ranged Weapon' },
  weapon_arcane:   { zh: '戰鬥法術',     en: 'Arcane Weapon' },
  arcane_item:     { zh: '魔法道具',     en: 'Arcane Item' },
  item:            { zh: '一般道具',     en: 'Item' },
  consumable:      { zh: '消耗品',       en: 'Consumable' },
  light_source:    { zh: '光源',         en: 'Light Source' },
  all_asset:       { zh: '全資產（通用）', en: 'All Asset' },
};
```

### 4.4 新增 `RECIPE_UNLOCK_TYPES`

```javascript
const RECIPE_UNLOCK_TYPES = {
  default:        { zh: '初始已知',     en: 'Default' },
  exploration:    { zh: '場景探索',     en: 'Exploration' },
  faction_talent: { zh: '陣營天賦',     en: 'Faction Talent' },
  story_event:    { zh: '劇情事件',     en: 'Story Event' },
  quest_reward:   { zh: '任務獎勵',     en: 'Quest Reward' },
  hidden:         { zh: '隱藏（待解鎖）', en: 'Hidden' },
};
```

---

## 五、後端 API 設計

### 5.1 素材管理

```
GET    /api/admin/materials/categories
       回傳：5 類素材類別定義

GET    /api/admin/materials
       Query: ?category=mineral&level=5&page=1&limit=50
       回傳：素材清單

GET    /api/admin/materials/:id
       回傳：單一素材詳細

POST   /api/admin/materials
       Body: { category_code, material_level, name_zh, name_en, ... }
       副作用: material_value 由觸發器自動填入

PATCH  /api/admin/materials/:id
       Body: 任何素材欄位

DELETE /api/admin/materials/:id
       限制：若有配方引用此素材則拒絕刪除

GET    /api/admin/materials/by-family/:monster_family_id
       用途：查某個怪物家族的怪物素材清單
```

### 5.2 鍛造詞條管理

```
GET    /api/admin/affixes
       Query: ?category=mineral&status=complete&tier_mode=scaling
       回傳：詞條清單（含 tier 摘要）

GET    /api/admin/affixes/:id
       回傳：單一詞條（含完整 tiers 子資料）

POST   /api/admin/affixes
       Body: { code, name_zh, category_code, tier_mode, applicable_subtypes, ... }
       回傳：新建的詞條

PATCH  /api/admin/affixes/:id
       Body: 任何詞條欄位
       限制：若修改 tier_mode，會警告現有 tiers 將失效

DELETE /api/admin/affixes/:id
       副作用：CASCADE 刪除所有 tiers

POST   /api/admin/affixes/:id/tiers
       Body: { tier_label, tier_order, affix_value, effect_detail_zh, choice_payload }
       用途：為詞條新增一個 tier

PATCH  /api/admin/affixes/:id/tiers/:tier_id
       Body: 任何 tier 欄位

DELETE /api/admin/affixes/:id/tiers/:tier_id
```

### 5.3 鍛造費用試算

```
GET    /api/admin/forging/preview
       Query: ?tier_id=xxx&material_level=5
       回傳：{ affix_name, tier_label, affix_value, material_sv, required_quantity }

POST   /api/admin/forging/batch-preview
       Body: { tier_ids: [...], material_levels: [1, 3, 5, 7, 9] }
       回傳：每個 tier × 每個材料等級的試算矩陣
       用途：總覽面板展示費用對照表
```

### 5.4 製作配方管理

```
GET    /api/admin/recipes
       Query: ?unlock_type=exploration&status=complete&page=1
       回傳：配方清單

GET    /api/admin/recipes/:id
       回傳：單一配方（含素材需求子資料）

POST   /api/admin/recipes
       Body: { code, name_zh, output_card_id, output_is_temporary, ... }

PATCH  /api/admin/recipes/:id
       Body: 任何配方欄位
       副作用：自動判斷 design_status
         - output_card_id 存在 + 至少 1 個素材需求 = complete
         - 部分填寫 = partial
         - 都未填 = pending

DELETE /api/admin/recipes/:id
       副作用：CASCADE 刪除素材需求

POST   /api/admin/recipes/:id/materials
       Body: { category_code | specific_material_id, min_material_level, quantity }
       限制：category_code 與 specific_material_id 擇一

PATCH  /api/admin/recipes/:id/materials/:material_req_id

DELETE /api/admin/recipes/:id/materials/:material_req_id
```

### 5.5 統計與總覽

```
GET    /api/admin/forging/stats
       回傳：
       {
         totalAffixes: 23,
         byCategory: { mineral: 5, wood: 5, insect: 3, fish: 5, monster: 5 },
         byStatus: { complete: 23, partial: 0, pending: 0 },
         totalTiers: 65,
         applicabilityCoverage: { weapon_melee: 15, weapon_ranged: 15, ... }
       }

GET    /api/admin/crafting/stats
       回傳：
       {
         totalRecipes: 0,
         byUnlockType: { default: 0, exploration: 0, ... },
         byStatus: { complete: 0, partial: 0, pending: 0 },
         temporaryCount: 0,
         regularCount: 0
       }
```

### 5.6 驗證端點

```
GET    /api/admin/affixes/:id/validate
       用途：檢查詞條是否符合完整性規則
       回傳：{ isValid, errors: [...], warnings: [...] }
       檢查項目：
       - tier_mode 與 tier 數量是否一致
       - scaling 必須有 3 個 tier（+1/+2/+3）
       - fixed 必須有 1 個 tier
       - choice 必須有 ≥ 2 個 tier
       - affix_value 必須 > 0
       - applicable_subtypes 非空

GET    /api/admin/recipes/:id/validate
       回傳：{ isValid, errors, warnings }
       檢查：
       - output_card_id 存在
       - 至少 1 個素材需求
       - 素材的 category_code 或 specific_material_id 有效
```

---

## 六、後端驗證邏輯

### 6.1 詞條 `tier_mode` 與 tier 數量的一致性

```javascript
function validateAffixTiers(affix, tiers) {
  const errors = [];
  const warnings = [];

  switch (affix.tier_mode) {
    case 'scaling':
      if (tiers.length !== 3) {
        errors.push(`scaling 模式需要 3 個 tier，目前 ${tiers.length}`);
      }
      const expected = ['+1', '+2', '+3'];
      const labels = tiers.map(t => t.tier_label).sort();
      if (JSON.stringify(labels) !== JSON.stringify(expected)) {
        errors.push(`scaling 模式的 tier_label 必須為 +1/+2/+3`);
      }
      break;

    case 'fixed':
      if (tiers.length !== 1) {
        errors.push(`fixed 模式必須恰好 1 個 tier，目前 ${tiers.length}`);
      }
      break;

    case 'choice':
      if (tiers.length < 2) {
        errors.push(`choice 模式至少需要 2 個選項，目前 ${tiers.length}`);
      }
      // choice 模式的 tier 需要 choice_payload 非空
      tiers.forEach(t => {
        if (!t.choice_payload || Object.keys(t.choice_payload).length === 0) {
          warnings.push(`choice tier "${t.tier_label}" 缺少 choice_payload`);
        }
      });
      break;
  }

  // 所有模式通用：affix_value > 0
  tiers.forEach(t => {
    if (t.affix_value <= 0) {
      errors.push(`tier "${t.tier_label}" 的 V 值必須 > 0（目前 ${t.affix_value}）`);
    }
  });

  return { isValid: errors.length === 0, errors, warnings };
}
```

### 6.2 配方的 `design_status` 自動計算

```javascript
function computeRecipeStatus(recipe, materialReqs) {
  const hasOutput    = recipe.output_card_id !== null;
  const hasMaterials = materialReqs.length > 0;
  const hasName      = recipe.name_zh && recipe.name_zh.trim().length > 0;

  if (hasOutput && hasMaterials && hasName) return 'complete';
  if (hasOutput || hasMaterials || hasName) return 'partial';
  return 'pending';
}
```

### 6.3 素材指定方式的互斥驗證

資料庫已有 CHECK 約束，後端 API 進一步在送出前就驗證並回傳更清楚的錯誤訊息：

```javascript
function validateMaterialRequirement(req) {
  const hasCategory = req.category_code !== null && req.category_code !== undefined;
  const hasSpecific = req.specific_material_id !== null && req.specific_material_id !== undefined;

  if (hasCategory && hasSpecific) {
    return { error: '素材指定方式必須擇一：類別模式 或 具體素材模式，不可同時填' };
  }
  if (!hasCategory && !hasSpecific) {
    return { error: '素材指定方式必須擇一：至少填入類別模式或具體素材模式' };
  }
  if (hasCategory && !req.min_material_level) {
    return { warning: '使用類別模式時，建議同時指定最低素材等級' };
  }
  return { ok: true };
}
```

### 6.4 詞條適用性查詢

當設計者在配方或試算介面中選擇了「一張卡片」，系統應能回傳「哪些詞條可以鍛造此卡」。

```javascript
// 偽碼
async function getApplicableAffixes(cardId) {
  const card = await db.cards.findById(cardId);
  if (!card || card.card_type !== 'asset') return [];

  // 不可鍛造的情況
  if (card.is_temporary) return [];

  const cardSubtypes = card.subtypes || [];

  const allAffixes = await db.affixes.findAll();
  return allAffixes.filter(affix => {
    const applicable = affix.applicable_subtypes;
    if (applicable.includes('all_asset')) return true;
    return cardSubtypes.some(st => applicable.includes(st));
  });
}
```

---

## 七、資料遷移腳本執行順序

1. `material_categories` 建表 + 5 筆 Seed
2. `material_definitions` 建表 + `auto_fill_material_value` 觸發器 + 40 筆非怪物素材骨架
3. `forging_affixes` 建表
4. `forging_affix_tiers` 建表
5. 23 個詞條 + 約 65 筆 tier Seed Data 匯入
6. `crafting_recipes` 建表（不預填配方）
7. `crafting_recipe_materials` 建表
8. `calc_forging_material_quantity`、`preview_forging_cost` 函數建立
9. `admin-shared.js` 擴充（MATERIAL_CATEGORIES、MATERIAL_VALUE_TABLE、APPLICABLE_SUBTYPES、RECIPE_UNLOCK_TYPES、輔助函數）

---

## 八、Part 1 交付確認清單

- [ ] 6 張資料表建立完成
- [ ] 1 個觸發器建立（auto_fill_material_value）
- [ ] 2 個 PL/pgSQL 函數建立（calc_forging_material_quantity、preview_forging_cost）
- [ ] 5 筆 material_categories Seed
- [ ] 40 筆非怪物素材骨架 Seed
- [ ] 23 筆 forging_affixes Seed（礦物 5、木材 5、蟲類 3、魚類 5、怪物 5）
- [ ] 約 65 筆 forging_affix_tiers Seed（各類別 V 值吻合規則書第四章 §4）
- [ ] `admin-shared.js` 擴充 4 組常數 + 2 個輔助函數
- [ ] 35+ 個 API 端點實作（素材、詞條、配方 CRUD + 試算 + 統計 + 驗證）
- [ ] 後端驗證邏輯實作（tier 一致性、配方狀態、素材指定互斥、詞條適用性）

---

## 九、文件版本紀錄

| 版本 | 日期 | 變更內容 |
|------|------|---------|
| v1.0 | 2026/04/16 | 初版建立 — 6 張資料表、5 素材類別 + 40 素材骨架 + 23 詞條完整 Seed、規則書第四章 §4 的 V 值完整對齊、鍛造費用計算函數、35+ API、詞條適用性查詢邏輯 |

---

> **接續文件：** `Claude_Code_MOD09_Forge_Craft_指令_Part2.md`（設計器 UI + AI 輔助 + 總覽面板）
>
> **Part 2 內容預告：** 三欄佈局、詞條設計器（分類導航 + tier 編輯）、配方設計器（輸出卡片選擇 + 素材需求編輯）、鍛造費用試算面板、Gemini AI 生成詞條敘事、總覽面板（詞條矩陣、素材使用分析、配方列表）
