# Claude Code 指令文件：MOD-11 調查員設計器（Part 4 / 4）
## Admin Module — Investigator Designer Build Instructions (Part 4 of 4)

> **模組代號：** MOD-11
> **本檔內容：** V 值計算系統、V 值平衡面板、AI 估算模式擴充、平衡 API
> **前置：** Part 1 資料庫與 API、Part 2 UI、Part 3 Gemini 整合與總覽面板
> **撰寫日期：** 2026/04/16

---

## 零、本檔定位

Part 4 是 MOD-11 的**平衡性子系統**。目的：

1. **量化 64 個調查員的強度**（用 V 值為單位）
2. **提供跨調查員的平衡性比較**（箱型圖、散佈圖、雷達圖）
3. **自動偵測離群值**（強度異常的調查員）
4. **AI 輔助估算能力文字與簽名卡的 V 值**

### 0.1 本檔的比較範圍

**比較對象（限定）：**
- ✅ 素質（屬性、HP/SAN 上限）
- ✅ 能力（能力文字、戰鬥熟練）
- ✅ 簽名卡（2–3 張專屬卡）
- ✅ 個人弱點（扣減值）

**不比較的對象：**
- ❌ 起始牌組（一般卡部分）— 玩家可自由修改，非調查員固有強度
- ❌ MOD-01 既有卡池的 V 值 — 由 MOD-01 獨立維護

### 0.2 V 值定義的本質

> **1V = 玩家花一個行動可以做到的事情**
>
> 一張卡片的 V 值 = 「花一個行動打出這張卡，等於賺取了多少行動的效益」
>
> 1V = 1 行動點 = 1 資源 = 抽 1 張牌 = 造成 1 點傷害

這是「V 值的行動收益本質」。傳奇卡的高 V 值（22V+）不是抽象數字，而是**一個行動換回極多行動收益的效率**。

---

## 一、資料庫擴充

### 1.1 `investigator_templates` 新增 V 值欄位

```sql
ALTER TABLE investigator_templates
ADD COLUMN IF NOT EXISTS attribute_value       DECIMAL(6,1) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS hp_value              DECIMAL(6,1) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS san_value             DECIMAL(6,1) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS baseline_value        DECIMAL(6,1) NOT NULL DEFAULT 0,

ADD COLUMN IF NOT EXISTS proficiency_value     DECIMAL(6,1) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS ability_text_value    DECIMAL(6,1) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS ability_value         DECIMAL(6,1) NOT NULL DEFAULT 0,

ADD COLUMN IF NOT EXISTS signature_total_value DECIMAL(6,1) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS weakness_value        DECIMAL(6,1) NOT NULL DEFAULT 0,

ADD COLUMN IF NOT EXISTS total_value           DECIMAL(6,1) NOT NULL DEFAULT 0,

ADD COLUMN IF NOT EXISTS value_grade           VARCHAR(16)
  CHECK (value_grade IN ('underpowered', 'below_average', 'balanced',
                          'above_average', 'overpowered', 'incomplete')),
ADD COLUMN IF NOT EXISTS value_last_calculated TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ability_value_source  VARCHAR(16) DEFAULT 'manual'
  CHECK (ability_value_source IN ('manual', 'ai_estimated', 'ai_confirmed'));

CREATE INDEX IF NOT EXISTS idx_inv_total_value ON investigator_templates(total_value);
CREATE INDEX IF NOT EXISTS idx_inv_value_grade ON investigator_templates(value_grade);
```

**欄位語意：**

| 欄位 | 說明 |
|------|------|
| `attribute_value` | A-1 七屬性總 V 值（自動計算，每點 × 2.0V） |
| `hp_value` | A-2 HP 上限 V 值（自動計算，超過基礎 7 的部分 × 1.5V） |
| `san_value` | A-3 SAN 上限 V 值（自動計算，超過基礎 7 的部分 × 1.5V） |
| `baseline_value` | **維度 A 小計** = attribute + hp + san（自動加總） |
| `proficiency_value` | B-1 戰鬥熟練 V 值（自動計算，熟練數 × 7.5V） |
| `ability_text_value` | B-2 能力文字 V 值（手動或 AI 填入） |
| `ability_value` | **維度 B 小計** = proficiency + ability_text（自動加總） |
| `signature_total_value` | **維度 C** = 所有簽名卡的 `effect_value` 加總 |
| `weakness_value` | 弱點 V 值（負值，自動從 weaknesses 表同步） |
| `total_value` | **綜合 V 值 = A + B + C + weakness（負）** |
| `value_grade` | 分級（依 z-score 或基於實際平均的偏離度） |
| `ability_value_source` | manual 手填、ai_estimated AI 建議但未審核、ai_confirmed AI 建議已審核 |

### 1.2 `investigator_signature_cards` 新增 V 值欄位

```sql
ALTER TABLE investigator_signature_cards
ADD COLUMN IF NOT EXISTS effect_value      DECIMAL(5,1) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS value_breakdown   JSONB NOT NULL DEFAULT '[]',
ADD COLUMN IF NOT EXISTS value_source      VARCHAR(16) DEFAULT 'manual'
  CHECK (value_source IN ('manual', 'ai_estimated', 'ai_confirmed')),
ADD COLUMN IF NOT EXISTS value_last_updated TIMESTAMPTZ;
```

**`value_breakdown` 結構範例：**

```json
[
  { "effect": "造成 3 神秘傷害", "value": 3.0, "reason": "3 點傷害 × 1V/點" },
  { "effect": "抽 1 張牌", "value": 1.0, "reason": "1 張牌 × 1V" },
  { "effect": "免費行動", "value": 1.0, "reason": "不花行動點 +1V" },
  { "effect": "預期使用次數 × 3", "value": 0, "reason": "次數倍率" },
  { "effect": "扣行動點（打出）", "value": -1.0, "reason": "資產卡通用" },
  { "effect": "扣留場（資產卡）", "value": -1.0, "reason": "資產卡通用" }
]
```

### 1.3 `investigator_weaknesses` 新增 V 值欄位

```sql
ALTER TABLE investigator_weaknesses
ADD COLUMN IF NOT EXISTS effect_value        DECIMAL(5,1) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS trigger_probability DECIMAL(4,3) NOT NULL DEFAULT 0.067,
ADD COLUMN IF NOT EXISTS expected_rounds     INTEGER NOT NULL DEFAULT 5,
ADD COLUMN IF NOT EXISTS final_value         DECIMAL(5,1) NOT NULL DEFAULT 0;
```

**欄位語意：**

| 欄位 | 說明 |
|------|------|
| `effect_value` | 單次觸發時的負面效果價值（負值） |
| `trigger_probability` | 抽到機率（預設 0.067 ≈ 1/15 牌組） |
| `expected_rounds` | 預期觸發回合數（預設 5 = 每場遊戲 5 回合） |
| `final_value` | **最終扣減 V 值 = effect_value × trigger_probability × expected_rounds** |

### 1.4 `investigator_value_config` — V 值計算參數表

將 V 值換算係數存成可配置的系統參數表，方便未來調整不必改 code。

```sql
CREATE TABLE investigator_value_config (
  key                 VARCHAR(64) PRIMARY KEY,
  value_numeric       DECIMAL(8,3),
  value_text          TEXT,
  description         TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO investigator_value_config (key, value_numeric, description) VALUES
  ('attribute_per_point_v',     2.0, '每點屬性值換算 V 值（0.5V × 每屬性 4 次檢定）'),
  ('hp_per_point_v',            1.5, 'HP 上限每點 V 值（heal_hp 基準）'),
  ('san_per_point_v',           1.5, 'SAN 上限每點 V 值（heal_san 基準）'),
  ('proficiency_per_slot_v',    7.5, '每個戰鬥熟練 V 值（+1 × 15 次戰鬥檢定 × 0.5V）'),
  ('hp_base',                   7.0, 'HP 基礎值（不計入 V 值）'),
  ('san_base',                  7.0, 'SAN 基礎值（不計入 V 值）'),
  ('weakness_default_prob',     0.067, '弱點預設抽到機率（1/15 牌組）'),
  ('weakness_default_rounds',   5.0, '弱點預設預期觸發回合數'),
  ('zscore_threshold_warn',     1.5, '過強/過弱的 z-score 閾值（黃色警告）'),
  ('zscore_threshold_alert',    2.0, '嚴重過強/過弱的 z-score 閾值（紅色警告）'),
  ('faction_imbalance_threshold', 0.10, '偏重字母分組平均偏離整體的閾值（10%）');
```

---

## 二、V 值計算函數（PostgreSQL Functions）

### 2.1 屬性 V 值計算

```sql
CREATE OR REPLACE FUNCTION calc_attribute_value(
  p_str INT, p_agi INT, p_con INT, p_int INT,
  p_wil INT, p_per INT, p_cha INT
) RETURNS DECIMAL(6,1) AS $$
DECLARE
  coeff DECIMAL;
BEGIN
  SELECT value_numeric INTO coeff FROM investigator_value_config
    WHERE key = 'attribute_per_point_v';
  RETURN (p_str + p_agi + p_con + p_int + p_wil + p_per + p_cha) * coeff;
END;
$$ LANGUAGE plpgsql STABLE;
```

### 2.2 HP / SAN 上限 V 值計算

```sql
CREATE OR REPLACE FUNCTION calc_hp_value(p_constitution INT) RETURNS DECIMAL(6,1) AS $$
DECLARE
  coeff DECIMAL;
BEGIN
  SELECT value_numeric INTO coeff FROM investigator_value_config
    WHERE key = 'hp_per_point_v';
  -- 只計算超過基礎 7 HP 的部分（即體質 × 2 的部分）
  RETURN (p_constitution * 2) * coeff;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION calc_san_value(p_willpower INT) RETURNS DECIMAL(6,1) AS $$
DECLARE
  coeff DECIMAL;
BEGIN
  SELECT value_numeric INTO coeff FROM investigator_value_config
    WHERE key = 'san_per_point_v';
  RETURN (p_willpower * 2) * coeff;
END;
$$ LANGUAGE plpgsql STABLE;
```

**重要：** HP 公式是 `體質 × 2 + 5`，這裡 V 值只計算 `體質 × 2` 的部分（可成長的部分）。基礎 5 被視為「所有調查員都有的底線」，不構成強度差異。

### 2.3 戰鬥熟練 V 值計算

```sql
CREATE OR REPLACE FUNCTION calc_proficiency_value(p_inv_id UUID) RETURNS DECIMAL(6,1) AS $$
DECLARE
  prof_count INT;
  coeff DECIMAL;
BEGIN
  -- 從 proficiency_ids 陣列取長度
  SELECT COALESCE(array_length(proficiency_ids, 1), 0) INTO prof_count
    FROM investigator_templates WHERE id = p_inv_id;

  SELECT value_numeric INTO coeff FROM investigator_value_config
    WHERE key = 'proficiency_per_slot_v';

  RETURN prof_count * coeff;
END;
$$ LANGUAGE plpgsql STABLE;
```

### 2.4 簽名卡 V 值彙總

```sql
CREATE OR REPLACE FUNCTION calc_signature_total_value(p_inv_id UUID) RETURNS DECIMAL(6,1) AS $$
DECLARE
  total DECIMAL(6,1);
BEGIN
  SELECT COALESCE(SUM(effect_value), 0) INTO total
    FROM investigator_signature_cards
    WHERE investigator_id = p_inv_id;
  RETURN total;
END;
$$ LANGUAGE plpgsql STABLE;
```

### 2.5 弱點最終 V 值計算

```sql
CREATE OR REPLACE FUNCTION calc_weakness_final_value(p_inv_id UUID) RETURNS DECIMAL(6,1) AS $$
DECLARE
  ev DECIMAL(5,1);
  prob DECIMAL(4,3);
  rnds INT;
BEGIN
  SELECT effect_value, trigger_probability, expected_rounds
    INTO ev, prob, rnds
    FROM investigator_weaknesses
    WHERE investigator_id = p_inv_id;

  IF ev IS NULL THEN RETURN 0; END IF;

  -- final = effect × prob × rounds（effect 為負值，結果為負）
  RETURN ev * prob * rnds;
END;
$$ LANGUAGE plpgsql STABLE;
```

### 2.6 綜合 V 值計算（主函數）

```sql
CREATE OR REPLACE FUNCTION calc_total_investigator_value(p_inv_id UUID)
RETURNS VOID AS $$
DECLARE
  t RECORD;
  v_attr DECIMAL(6,1);
  v_hp DECIMAL(6,1);
  v_san DECIMAL(6,1);
  v_baseline DECIMAL(6,1);
  v_prof DECIMAL(6,1);
  v_ability_text DECIMAL(6,1);
  v_ability DECIMAL(6,1);
  v_signature DECIMAL(6,1);
  v_weakness DECIMAL(6,1);
  v_total DECIMAL(6,1);
BEGIN
  SELECT * INTO t FROM investigator_templates WHERE id = p_inv_id;

  -- 計算各維度
  v_attr := calc_attribute_value(
    t.attr_strength, t.attr_agility, t.attr_constitution,
    t.attr_intellect, t.attr_willpower, t.attr_perception, t.attr_charisma
  );
  v_hp := calc_hp_value(t.attr_constitution);
  v_san := calc_san_value(t.attr_willpower);
  v_baseline := v_attr + v_hp + v_san;

  v_prof := calc_proficiency_value(p_inv_id);
  v_ability_text := COALESCE(t.ability_text_value, 0);
  v_ability := v_prof + v_ability_text;

  v_signature := calc_signature_total_value(p_inv_id);
  v_weakness := calc_weakness_final_value(p_inv_id);  -- 負值

  v_total := v_baseline + v_ability + v_signature + v_weakness;

  -- 寫入結果
  UPDATE investigator_templates SET
    attribute_value = v_attr,
    hp_value = v_hp,
    san_value = v_san,
    baseline_value = v_baseline,
    proficiency_value = v_prof,
    ability_value = v_ability,
    signature_total_value = v_signature,
    weakness_value = v_weakness,
    total_value = v_total,
    value_last_calculated = NOW()
  WHERE id = p_inv_id;

  -- 觸發分級計算（需要全庫平均，獨立函數處理）
  PERFORM recalculate_value_grade(p_inv_id);
END;
$$ LANGUAGE plpgsql;
```

### 2.7 分級計算（基於 z-score）

由於我們選擇「不設固定目標均值」，分級基於**當前所有已設計模板的實際分佈**：

```sql
CREATE OR REPLACE FUNCTION recalculate_value_grade(p_inv_id UUID) RETURNS VOID AS $$
DECLARE
  t_value DECIMAL(6,1);
  mean_v DECIMAL(6,1);
  stddev_v DECIMAL(6,1);
  warn_threshold DECIMAL(3,2);
  alert_threshold DECIMAL(3,2);
  z_score DECIMAL(6,2);
  grade_val VARCHAR(16);
  is_complete BOOLEAN;
BEGIN
  SELECT total_value, is_completed INTO t_value, is_complete
    FROM investigator_templates WHERE id = p_inv_id;

  -- 若模板未完成（缺少能力文字或簽名卡等），標記為 incomplete
  IF NOT is_complete THEN
    UPDATE investigator_templates SET value_grade = 'incomplete' WHERE id = p_inv_id;
    RETURN;
  END IF;

  -- 取全庫已完成的模板平均與標準差
  SELECT AVG(total_value), STDDEV(total_value)
    INTO mean_v, stddev_v
    FROM investigator_templates
    WHERE is_completed = TRUE;

  -- 少於 5 筆完成樣本時，分級不可靠
  IF (SELECT COUNT(*) FROM investigator_templates WHERE is_completed = TRUE) < 5 THEN
    UPDATE investigator_templates SET value_grade = 'balanced' WHERE id = p_inv_id;
    RETURN;
  END IF;

  -- z-score
  IF stddev_v > 0 THEN
    z_score := (t_value - mean_v) / stddev_v;
  ELSE
    z_score := 0;
  END IF;

  SELECT value_numeric INTO warn_threshold FROM investigator_value_config
    WHERE key = 'zscore_threshold_warn';
  SELECT value_numeric INTO alert_threshold FROM investigator_value_config
    WHERE key = 'zscore_threshold_alert';

  -- 分級
  IF z_score >= alert_threshold THEN
    grade_val := 'overpowered';
  ELSIF z_score >= warn_threshold THEN
    grade_val := 'above_average';
  ELSIF z_score <= -alert_threshold THEN
    grade_val := 'underpowered';
  ELSIF z_score <= -warn_threshold THEN
    grade_val := 'below_average';
  ELSE
    grade_val := 'balanced';
  END IF;

  UPDATE investigator_templates SET value_grade = grade_val WHERE id = p_inv_id;
END;
$$ LANGUAGE plpgsql;
```

### 2.8 全庫重算函數

當 `investigator_value_config` 參數變更，或需要刷新全庫分級時：

```sql
CREATE OR REPLACE FUNCTION recalculate_all_investigator_values() RETURNS INTEGER AS $$
DECLARE
  inv_id UUID;
  count_processed INT := 0;
BEGIN
  FOR inv_id IN SELECT id FROM investigator_templates LOOP
    PERFORM calc_total_investigator_value(inv_id);
    count_processed := count_processed + 1;
  END LOOP;
  RETURN count_processed;
END;
$$ LANGUAGE plpgsql;
```

---

## 三、自動觸發器

當調查員的相關資料變動時，自動重算 V 值。

### 3.1 屬性/熟練變動觸發器

```sql
CREATE OR REPLACE FUNCTION trigger_recalc_investigator_value()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM calc_total_investigator_value(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inv_recalc_on_update
  AFTER UPDATE OF
    attr_strength, attr_agility, attr_constitution, attr_intellect,
    attr_willpower, attr_perception, attr_charisma,
    proficiency_ids, ability_text_value, is_completed
  ON investigator_templates
  FOR EACH ROW
  EXECUTE FUNCTION trigger_recalc_investigator_value();
```

### 3.2 簽名卡變動觸發器

```sql
CREATE OR REPLACE FUNCTION trigger_recalc_from_signature_card()
RETURNS TRIGGER AS $$
DECLARE
  inv_id UUID;
BEGIN
  inv_id := COALESCE(NEW.investigator_id, OLD.investigator_id);
  PERFORM calc_total_investigator_value(inv_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sig_card_recalc
  AFTER INSERT OR UPDATE OR DELETE ON investigator_signature_cards
  FOR EACH ROW
  EXECUTE FUNCTION trigger_recalc_from_signature_card();
```

### 3.3 弱點變動觸發器

```sql
CREATE OR REPLACE FUNCTION trigger_recalc_from_weakness()
RETURNS TRIGGER AS $$
DECLARE
  inv_id UUID;
  ev DECIMAL(5,1);
  prob DECIMAL(4,3);
  rnds INT;
  final_v DECIMAL(5,1);
BEGIN
  -- 先更新 final_value
  IF TG_OP != 'DELETE' THEN
    final_v := NEW.effect_value * NEW.trigger_probability * NEW.expected_rounds;
    NEW.final_value := final_v;
  END IF;

  inv_id := COALESCE(NEW.investigator_id, OLD.investigator_id);
  PERFORM calc_total_investigator_value(inv_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_weakness_recalc
  BEFORE INSERT OR UPDATE ON investigator_weaknesses
  FOR EACH ROW
  EXECUTE FUNCTION trigger_recalc_from_weakness();

CREATE TRIGGER trg_weakness_recalc_delete
  AFTER DELETE ON investigator_weaknesses
  FOR EACH ROW
  EXECUTE FUNCTION trigger_recalc_from_weakness();
```

---

## 四、前端 UI 擴充

### 4.1 屬性配點頁面（擴充自 Part 2 分頁 ②）

加入 V 值即時顯示：

```
┌── 屬性配點 ──────────────────────────────────────────┐
│                                                      │
│  剩餘可分配：  [█████░░░░░] 5 / 5 點                 │
│                                                      │
│  ┌──────────┬──────┬──────┬──────┬──────┬────────┐  │
│  │  屬性     │ 基礎 │ 陣營 │ 自由 │ 總計 │ V 值   │  │
│  ├──────────┼──────┼──────┼──────┼──────┼────────┤  │
│  │  力量 STR│  +1  │  +0  │ [+0] │  1   │ 2.0V   │  │
│  │  敏捷 AGI│  +1  │  +0  │ [+0] │  1   │ 2.0V   │  │
│  │  體質 CON│  +1  │  +1  │ [+0] │  2   │ 4.0V   │  │
│  │  智力 INT│  +1  │  +1  │ [+0] │  2   │ 4.0V   │  │
│  │  意志 WIL│  +1  │  +1  │ [+0] │  2   │ 4.0V   │  │
│  │  感知 PER│  +1  │  +0  │ [+0] │  1   │ 2.0V   │  │
│  │  魅力 CHA│  +1  │  +3  │ [+0] │  4   │ 8.0V   │  │
│  └──────────┴──────┴──────┴──────┴──────┴────────┘  │
│                                                      │
│  ── V 值計算 ──────────────────────                  │
│  屬性 V 值合計：      26.0V                          │
│  HP 上限 V 值：       6.0V  (體質 2 × 2 × 1.5V)      │
│  SAN 上限 V 值：      6.0V  (意志 2 × 2 × 1.5V)      │
│  ─────────────────                                   │
│  【維度 A 素質 V 值】 38.0V                           │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 4.2 戰鬥熟練頁面（擴充自 Part 2 分頁 ③）

```
┌── 戰鬥熟練 ──────────────────────────────────────┐
│                                                  │
│  已選熟練（目前 1 個）：                           │
│  ┌──────────────────────────────────────────┐    │
│  │ ✓ 施法（Arcane）        +7.5V       [移除] │    │
│  └──────────────────────────────────────────┘    │
│  ── B-1 熟練 V 值：7.5V ──                         │
│                                                  │
│  能力文字 V 值：                                   │
│  ┌──────────────────────────────────────────┐    │
│  │ 當前值：[__10.5__] V                       │    │
│  │ 來源：  🤖 AI 估算（已審核）                │    │
│  │ [🔄 重新估算]  [✏️ 手動修改]                 │    │
│  └──────────────────────────────────────────┘    │
│  ── B-2 能力文字 V 值：10.5V ──                    │
│                                                  │
│  ── 維度 B 能力 V 值合計：18.0V ──                  │
│                                                  │
└─────────────────────────────────────────────────┘
```

### 4.3 簽名卡設計器 V 值區塊（擴充自 Part 2 第三章）

簽名卡設計器底部新增 V 值計算區塊：

```
┌── V 值計算 ───────────────────────────────────┐
│                                               │
│  效果拆解（自動或手動）：                       │
│  ┌─────────────────────────────────────┐      │
│  │ · 造成 3 神秘傷害      3.0V  [移除] │      │
│  │ · 抽 1 張牌            1.0V  [移除] │      │
│  │ · 免費行動（+1V）      1.0V  [移除] │      │
│  │ [+ 新增效果項目]                    │      │
│  └─────────────────────────────────────┘      │
│  單次效果價值：         5.0V                   │
│  預期使用次數：         [3] 次                 │
│  原始效果價值：         15.0V                  │
│                                               │
│  公式扣減（資產卡）：                          │
│  - 行動點成本         -1.0V                   │
│  - 留場修正           -1.0V                   │
│  ※ 簽名卡不扣稀有度（signature 固定）          │
│                                               │
│  ─────────────────                            │
│  【這張簽名卡 V 值】   13.0V                   │
│                                               │
│  [🤖 AI 輔助拆解]  [✏️ 手動編輯]                │
│                                               │
└──────────────────────────────────────────────┘
```

**操作邏輯：**
- 設計者可**手動**新增/刪除效果項目
- 每個項目可自由填寫 V 值（參考 v1.1 效果價值表）
- 「🤖 AI 輔助拆解」呼叫 Gemini 自動拆解效果文字並填入項目
- 最終 V 值自動計算，寫回 `effect_value` 欄位

### 4.4 個人弱點編輯器 V 值區塊

```
┌── V 值計算（弱點為負值） ──────────────────────┐
│                                               │
│  負面效果拆解：                                 │
│  ┌─────────────────────────────────────┐      │
│  │ · 本回合損失 2 HP     -3.0V  [移除] │      │
│  │ · 力量檢定 -2         -3.0V  [移除] │      │
│  │ [+ 新增效果項目]                    │      │
│  └─────────────────────────────────────┘      │
│  單次觸發價值：        -6.0V                   │
│                                               │
│  觸發條件機率：                                 │
│  抽到機率：    [0.067] (= 1/15 牌組)           │
│  預期回合數：  [5] 回合                        │
│                                               │
│  ─────────────────                            │
│  【弱點最終 V 值】    -2.0V                    │
│  公式：-6.0 × 0.067 × 5 = -2.0                │
│                                               │
└──────────────────────────────────────────────┘
```

### 4.5 ID 卡頂部 V 值總覽條

在所有分頁頂部都顯示一條 V 值總覽條：

```
╔════════════════════════════════════════════════════════════════╗
║ ENTJ-2  V 值總覽  [🟢 balanced]                                ║
║ A 素質 38.0 + B 能力 18.0 + C 簽名卡 30.0 - 弱點 2.0 = 84.0V   ║
╚════════════════════════════════════════════════════════════════╝
```

- 未完成模板顯示 `[⚪ incomplete]`
- `balanced` 綠色、`above_average` / `below_average` 黃色、`overpowered` / `underpowered` 紅色

---

## 五、V 值平衡面板

### 5.1 進入方式

在 MOD-11 主頁面頂部導航加入 `[⚖️ V 值平衡面板]` 按鈕，與 Part 3 的 `[📊 總覽面板]` 並排。

### 5.2 四宮格佈局

```
╔═══════════════════════════════════════════════════════════╗
║  ⚖️ 64 調查員 V 值平衡面板                                ║
║                                                           ║
║  全庫狀態：                                                ║
║  · 完成度：18 / 64（28%）                                  ║
║  · 平均 V 值：82.3V（標準差 9.2）                          ║
║  · 警告：🔴 2 紅色  🟡 4 黃色                              ║
╠═══════════════════════════════════════════════════════════╣
║  ┌─────────────────┬─────────────────┐                    ║
║  │ A: V 值散佈圖    │ B: 字母分組箱型圖 │                    ║
║  │                 │                 │                    ║
║  │ 64 點的分佈      │ 8 個字母組      │                    ║
║  └─────────────────┴─────────────────┘                    ║
║  ┌─────────────────┬─────────────────┐                    ║
║  │ C: V 值組成拆解  │ D: 警告清單      │                    ║
║  │ 堆疊柱狀圖       │ 紅/黃/藍分級    │                    ║
║  └─────────────────┴─────────────────┘                    ║
║                                                           ║
║  ──────────────────                                       ║
║  [勾選比較模式] → 雷達圖對比                               ║
╚═══════════════════════════════════════════════════════════╝
```

### 5.3 面板 A：V 值散佈圖

**X 軸：** 64 個調查員依 MBTI 16 型 + 職業序號排列（INTJ-1, INTJ-2, ... ESFP-4）
**Y 軸：** `total_value`
**每個點：**
- 顏色：依偏重字母（E 琥珀、I 深藍、S 鏽銅、N 紫、T 冷鋼、F 紅、J 灰、P 綠）
- 大小：依完成度（已完成較大，骨架較小）
- 懸停：顯示調查員名稱 + V 值組成拆解

**平均線：** 水平虛線 = 全庫平均 V
**標準差帶：** 平均 ±1 SD、±2 SD 的陰影區域

**互動：** 點擊任一點跳到該調查員的編輯頁面

### 5.4 面板 B：字母分組箱型圖

**X 軸：** 8 個偏重字母（E, I, S, N, T, F, J, P）
**Y 軸：** V 值
**每組一個箱型圖：**
- 中位數（中央線）
- 四分位距（箱體）
- 全距（上下鬚線）
- 離群點（單獨的點）

**失衡警告：**
- 若某字母的中位數偏離整體中位數超過閾值（預設 10%），該箱型圖邊框標紅
- 旁邊以文字提示：「⚠ F 偏重組中位數 92.0，高於整體中位數 82.3，偏離 +12%」

### 5.5 面板 C：V 值組成拆解（堆疊柱狀圖）

**X 軸：** 64 個調查員（或可切換成 16 MBTI / 8 字母分組）
**Y 軸：** V 值
**堆疊層（由下至上）：**
1. 屬性 V（淺綠）
2. HP+SAN V（藍）
3. 熟練 V（黃）
4. 能力文字 V（紫）
5. 簽名卡 V（金）
6. 弱點 V（負紅，從 0 往下延伸）

**設計用途：** 看出「這個調查員 V 值偏高是因為屬性、能力還是簽名卡」。

### 5.6 面板 D：警告清單

**🔴 紅色（z-score > ±2.0）：**
```
· ENTJ-1（V = 101.5，z = +2.1）
  主因：簽名卡 V = 45.0 偏高
  建議：下調簽名卡 1 的使用次數或效果
  [跳轉編輯]

· ISTP-3（V = 62.8，z = -2.1）
  主因：能力文字 V = 4.0 偏低
  建議：能力文字設計偏弱，考慮增強
  [跳轉編輯]
```

**🟡 黃色（z-score > ±1.5）：**
```
· INFJ-2（V = 94.0，z = +1.7）輕微過強
· ESFP-1（V = 71.2，z = -1.6）輕微過弱
```

**🟠 字母失衡警告：**
```
· F 偏重組平均 91.5V（整體 82.3V，+11%）
  建議：檢視 INFP-3, INFJ-3, ENFJ-3, ENFP-3,
       ISFJ-3, ISFP-3, ESFJ-3, ESFP-3 是否整體偏強
```

**🔵 藍色提示：**
```
· 46 個調查員尚未完成設計
· 28 個調查員缺少能力文字 V 值估算
```

### 5.7 勾選比較模式（雷達圖）

面板下方「勾選比較模式」：

**勾選 2–4 個調查員**，底部展開雷達圖：

```
        屬性
         ▲
    簽名卡 ╱ ╲ HP+SAN
       ╱    ╲
     ╱        ╲
    能力文字  熟練
         ▼
        弱點（絕對值）
```

六軸各自標準化（用該維度的全庫最大值為 100）。

**下方附文字比較表：**

| 維度 | ENTJ-1 | INFJ-3 | ESFP-2 |
|------|--------|--------|--------|
| 屬性 V | 30.0 | 28.0 | 26.0 |
| HP+SAN V | 12.0 | 10.0 | 8.0 |
| 熟練 V | 7.5 | 7.5 | 7.5 |
| 能力文字 V | 10.0 | 12.0 | 8.0 |
| 簽名卡 V | 30.0 | 35.0 | 20.0 |
| 弱點 V | -2.0 | -3.0 | -1.5 |
| **總 V** | **87.5** | **89.5** | **68.0** |

### 5.8 頂部操作列

```
[🔄 全庫重算]  [⚙️ 調整 V 值係數]  [📤 匯出 CSV 報告]
```

- **全庫重算**：呼叫 `recalculate_all_investigator_values()`
- **調整 V 值係數**：彈出 `investigator_value_config` 編輯介面（危險操作，會全庫重算）
- **匯出 CSV 報告**：匯出 64 個調查員的 V 值明細

---

## 六、Gemini AI 模式 E：V 值估算

Part 3 定義了 4 種 AI 生成模式（A/B/C/D，全部是敘事生成）。Part 4 新增**模式 E：V 值估算**，是**數值估算**而非敘事生成。

### 6.1 模式 E-1：能力文字 V 值估算

**觸發：** 戰鬥熟練頁面的「🤖 AI 估算能力文字 V 值」按鈕

**輸入：**
```json
{
  "investigator_id": "uuid",
  "ability_text_zh": "艾琳娜的夢境與現實交疊。她能在混沌中辨識出將臨的模式，但每一次準確的預感都會削弱她對現實的掌握。"
}
```

**系統 Prompt：**

```
你是克蘇魯神話卡牌遊戲的平衡設計師，熟悉「卡片價值計算規範 v1.1」。

請估算以下調查員能力文字的 V 值。

【V 值定義】
1V = 玩家花一個行動可以做到的事情的收益量。
1V = 1 行動點 = 1 資源 = 抽 1 張牌 = 造成 1 點傷害。

【調查員背景】
- 四字碼：{mbti_code}
- 偏重字母：{dominant_letter}（{faction_zh_name}）
- 能力文字：{ability_text_zh}

【效果價值參考】
- 被動屬性加成：每 +1 屬性 ≈ 2.0V（一場遊戲檢定 4 次 × 0.5V）
- 被動傷害加成：每單次 +1 傷害 = 2.5V（多次乘以次數）
- 抽牌：每回合 +1 抽牌 ≈ 5V（10 回合 × 1V）
- 條件觸發（如「獨處時」）：基礎價值 × 觸發機率（通常 0.3–0.5）
- 每回合可觸發能力：單次價值 × 預期回合數（5–10）
- 規則改寫級能力（如「免費行動 +1」）：15V+

【估算步驟】
1. 分解能力文字為具體可量化的效果
2. 每個效果查上述參考表估算 V 值
3. 若有不確定性，給出區間並標註信心度

【重要提醒】
- 純敘事的能力文字（如「艾琳娜能在混沌中辨識模式」）應標為低信心
- 有具體規則描述的才能精確估算
- 若能力文字完全是敘事而無機制，回傳 estimated_value: 0 並提示「此能力文字無量化機制，請補充具體規則」

【輸出格式（JSON）】
{
  "estimated_value": 10.5,
  "breakdown": [
    {
      "effect_description": "能辨識模式（推測為混沌袋預覽）",
      "value": 5.0,
      "reason": "類比『窺探混沌袋 0.5V × 10 回合』"
    },
    {
      "effect_description": "削弱現實掌握（推測為 SAN 損失）",
      "value": -2.0,
      "reason": "負面副作用，估每場觸發 1-2 次"
    }
  ],
  "confidence": "low",
  "caveats": "能力文字偏敘事，缺少明確機制。建議設計者補充具體規則以提高估算精度。"
}
```

**前端呈現：**

```
┌── AI 估算結果 ───────────────────────────────┐
│                                             │
│  估算 V 值：10.5V（信心度：低）               │
│                                             │
│  拆解：                                       │
│  · 能辨識模式（推測為混沌袋預覽） +5.0V      │
│    理由：類比「窺探混沌袋 0.5V × 10 回合」    │
│  · 削弱現實掌握（推測為 SAN 損失） -2.0V     │
│    理由：負面副作用，估每場 1-2 次            │
│                                             │
│  ⚠ 警告：                                    │
│  能力文字偏敘事，缺少明確機制。建議設計者補充  │
│  具體規則以提高估算精度。                     │
│                                             │
│  [採用 10.5V]  [修改後採用]  [重估]  [取消]   │
│                                             │
└────────────────────────────────────────────┘
```

**資料寫入邏輯：**
- 點「採用」→ `ability_text_value = 10.5`, `ability_value_source = 'ai_confirmed'`
- 點「修改後採用」→ 讓設計者改數字後寫入，`ability_value_source = 'manual'`
- 點「重估」→ 再呼叫一次 API
- 點「取消」→ 不寫入

### 6.2 模式 E-2：簽名卡 V 值拆解

**觸發：** 簽名卡設計器的「🤖 AI 輔助拆解」按鈕

**輸入：**
```json
{
  "signature_card_id": "uuid",
  "card_context": {
    "name_zh": "最後一發",
    "card_type": "event",
    "cost": 2,
    "play_effect": "擲 d20 攻擊一次，必定命中。本場戰鬥中不能再使用任何槍枝類卡片。"
  }
}
```

**系統 Prompt：**

```
你是克蘇魯神話卡牌遊戲的卡片平衡設計師。

請為這張簽名卡拆解出效果項目清單與各自的 V 值。

【卡片資訊】
- 名稱：{name_zh}
- 類型：{card_type}
- 費用：{cost}
- 打出效果：{play_effect}

【V 值參考表（卡片價值計算規範 v1.1）】
- 造成 1 點傷害：1V
- 造成 1 點恐懼傷害：3V
- 單次攻擊傷害加成 +1/+2/+3：2.5V / 5V / 7.5V
- 抽 1 張牌：1V
- 自動成功：4V
- 額外攻擊：1.5V
- 免費行動（不花行動點）：+1V
- 各類單屬性加值：+1 = 0.5V、+2 = 1.5V、+3 = 3V
- 萬能加值：+1 = 1V、+2 = 3V、+3 = 6V

【拆解步驟】
1. 把效果文字拆成獨立效果項目
2. 每個項目查表給 V 值
3. 找出限制條件（如「本場戰鬥中不能...」），作為負 V 或預期使用次數調整
4. 考慮預期使用次數（資產卡通常 3–5 次，事件卡通常 1 次）

【輸出格式（JSON）】
{
  "breakdown": [
    { "effect": "自動命中（自動成功）", "value": 4.0, "reason": "..." },
    { "effect": "單次攻擊傷害（基礎）", "value": 2.5, "reason": "..." },
    { "effect": "本場後禁用槍枝（負限制）", "value": -3.0, "reason": "..." }
  ],
  "expected_uses": 1,
  "estimated_single_use_value": 3.5,
  "estimated_raw_value": 3.5,
  "suggested_deductions": [
    { "item": "行動點成本（事件卡不扣）", "value": 0 }
  ],
  "final_estimated_value": 3.5,
  "confidence": "high"
}
```

**前端呈現：** 類似模式 E-1，但直接將 breakdown 填入簽名卡設計器的效果拆解清單，設計者可逐項審核修改。

### 6.3 批次 V 值估算（模式 E-3）

**觸發：** 平衡面板頂部的「🤖 批次 AI 估算」按鈕

**用途：** 一次對所有「尚未填寫能力文字 V 值」的調查員進行估算。

**前端介面：**

```
┌── 批次 V 值估算 ──────────────────────────────┐
│                                              │
│  待估算的模板：                                │
│  ☑ 18 個調查員的能力文字尚未估算 V 值          │
│  ☐ 12 張簽名卡尚未估算 V 值                    │
│                                              │
│  估算模式：                                   │
│  ⚫ 僅生成建議（不自動寫入）                   │
│  ○ 自動寫入（高信心度）、手動審核（低信心度）  │
│                                              │
│  [取消]  [開始估算（預估 45 秒）]              │
│                                              │
└─────────────────────────────────────────────┘
```

估算完成後提供匯總報告，設計者可逐一審核決定採用。

---

## 七、API 擴充

### 7.1 V 值計算與查詢

```
GET  /api/admin/investigators/:id/value-breakdown
     回傳：完整 V 值拆解
     {
       "total_value": 84.0,
       "value_grade": "balanced",
       "z_score": 0.18,
       "baseline": { "attribute": 26.0, "hp": 6.0, "san": 6.0, "total": 38.0 },
       "ability": { "proficiency": 7.5, "ability_text": 10.5, "total": 18.0 },
       "signature": { "total": 30.0, "cards": [ ... ] },
       "weakness": { "effect_value": -6.0, "prob": 0.067, "rounds": 5, "final": -2.0 }
     }

POST /api/admin/investigators/:id/recalculate-value
     用途：強制重算該調查員的 V 值
     回傳：新的 total_value 與 value_grade
```

### 7.2 全庫統計

```
GET  /api/admin/investigators/value-matrix
     回傳：64 個調查員的 V 值矩陣（給平衡面板散佈圖用）
     [
       { "mbti": "INTJ", "career": 1, "total_value": 78.5, "grade": "balanced", ... },
       ...
     ]

GET  /api/admin/investigators/value-stats
     回傳：整體統計
     {
       "total_completed": 18,
       "total_templates": 64,
       "mean_value": 82.3,
       "median_value": 81.5,
       "stddev_value": 9.2,
       "by_dominant_letter": {
         "E": { "count": 6, "mean": 80.1, "median": 79.5 },
         "F": { "count": 4, "mean": 91.5, "median": 92.0 },
         ...
       },
       "warnings": {
         "overpowered": [ "ENTJ-1", "INFJ-2" ],
         "underpowered": [ "ISTP-3", "ESFP-4" ],
         "imbalanced_letters": [ "F" ]
       }
     }

POST /api/admin/investigators/recalculate-all
     用途：全庫重算（呼叫 recalculate_all_investigator_values）
     限制：需管理員權限，耗時操作
```

### 7.3 V 值計算參數配置

```
GET  /api/admin/value-config
     回傳：investigator_value_config 表所有條目

PATCH /api/admin/value-config
     Body: { "attribute_per_point_v": 2.5 }
     副作用：自動觸發全庫重算
```

### 7.4 AI 估算 API

```
POST /api/admin/gemini/estimate-ability-value
     Body: { investigator_id, ability_text_zh }
     回傳：{ estimated_value, breakdown, confidence, caveats }

POST /api/admin/gemini/estimate-signature-value
     Body: { signature_card_id }
     回傳：{ breakdown, expected_uses, final_estimated_value, confidence }

POST /api/admin/gemini/batch-estimate-values
     Body: { target_ids: [...], mode: 'ability' | 'signature' | 'both' }
     回傳：每個 id 的估算結果陣列
```

---

## 八、規則書回寫清單（Part 4 補充）

Part 3 §4 已列出 MOD-11 相關的規則書回寫項目。Part 4 再新增以下：

### 8.1 新增規則：調查員強度量化公式

**位置建議：** 規則書第六章（數值規格）新增第 17 節「調查員平衡性規範」

**內容摘要：**
- 每點屬性值換算 V 值的公式（2.0V）
- HP/SAN 上限每點換算 V 值的公式（1.5V）
- 戰鬥熟練每個換算 V 值的公式（7.5V）
- 能力文字 V 值估算原則
- 簽名卡 V 值計算引用卡片價值計算規範 v1.1
- 個人弱點 V 值計算公式（effect × prob × rounds）
- 綜合 V 值 = A 素質 + B 能力 + C 簽名卡 - 弱點

### 8.2 新增規則：跨調查員平衡檢查原則

**位置建議：** 規則書第六章新增子章節

**內容摘要：**
- 以全庫已完成模板的實際平均與標準差為基準
- z-score > ±2.0 標紅，±1.5 標黃
- 偏重字母分組的平均偏離整體平均 10% 為失衡警告
- 64 個調查員應維持 8 個偏重字母各 8 個的均勻分佈

### 8.3 更新「規則書缺漏待回寫」清單

工作紀錄 26041602 §6.4 需新增條目：

| 項目 | 來源 | 建議整合位置 |
|------|------|-------------|
| 調查員強度量化 V 值系統 | MOD-11 Part 4 | 規則書第六章新增 §17 |
| V 值計算參數表（係數可配置） | MOD-11 Part 4 | 同上 |
| 跨調查員平衡檢查原則（z-score） | MOD-11 Part 4 | 同上 |

---

## 九、實作注意事項

### 9.1 計算性能

- 64 個調查員的全庫重算預期在 5 秒內完成
- 單一調查員觸發器計算應在 100ms 內完成
- 平衡面板資料查詢走 `value-stats` 聚合 API，不要在前端逐筆計算

### 9.2 資料一致性

- **Value 計算參數修改要警告：** `PATCH /api/admin/value-config` 會觸發全庫重算，前端必須有「您確定要修改計算參數嗎？將重算全部 64 個調查員」的確認對話框
- **觸發器的遞迴保護：** 避免「修改 ability_text_value → 觸發 recalc → 寫回 total_value → 再次觸發」的無限迴圈，需要在觸發器中判斷「僅特定欄位變動才重算」

### 9.3 AI 估算的可靠性

- AI 估算永遠只是建議，**絕不自動覆寫已有的 V 值**
- 信心度 low 的估算結果必須強制設計者審核
- 每次 AI 估算請求都記錄在日誌（供日後品質檢討）

### 9.4 離群值的合理化

- **過強不一定是 bug：** 某些傳奇調查員本來就應該偏強（設計意圖）
- **過弱也不一定是 bug：** 某些特殊挑戰向調查員本來就偏弱
- 系統只做「提示」，不自動阻擋儲存
- 設計者可以在模板上標註「允許離群」欄位（未列入本檔，未來可擴充）

### 9.5 未完成模板的處理

- 未完成模板的 V 值仍計算，但 `value_grade` 標為 `incomplete`
- 不納入「全庫平均」的計算（避免未完成模板拉低/拉高平均）
- 平衡面板上以灰色顯示

---

## 十、Part 4 交付確認清單

- [ ] `investigator_templates` 擴充 12 個 V 值欄位
- [ ] `investigator_signature_cards` 擴充 4 個 V 值欄位
- [ ] `investigator_weaknesses` 擴充 4 個 V 值欄位
- [ ] `investigator_value_config` 表建立並填入 11 筆 Seed
- [ ] 7 個 PL/pgSQL V 值計算函數建立
- [ ] 3 個自動觸發器建立（屬性/簽名卡/弱點變動）
- [ ] 屬性配點頁面 V 值即時顯示
- [ ] 戰鬥熟練頁面 V 值 + AI 估算按鈕
- [ ] 簽名卡設計器的 V 值拆解區塊
- [ ] 個人弱點編輯器的 V 值計算區塊
- [ ] ID 卡頂部 V 值總覽條
- [ ] V 值平衡面板（四宮格佈局）
- [ ] 面板 A 散佈圖（64 點、平均線、標準差帶）
- [ ] 面板 B 字母分組箱型圖（失衡警告）
- [ ] 面板 C V 值組成堆疊柱狀圖
- [ ] 面板 D 警告清單（紅/黃/橘/藍分級）
- [ ] 勾選比較模式雷達圖
- [ ] Gemini AI 模式 E-1（能力文字 V 值估算）
- [ ] Gemini AI 模式 E-2（簽名卡 V 值拆解）
- [ ] Gemini AI 模式 E-3（批次估算）
- [ ] 10+ API 端點實作（value-breakdown、value-stats、value-config、AI 估算）
- [ ] 規則書回寫清單更新到工作紀錄

---

## 十一、MOD-11 總交付完成後狀態（含 Part 4）

**資料層：**
- 5 張資料表（1 擴改 + 3 新建 + 1 配置表）
- V 值計算函數 + 觸發器
- 64 筆預設模板 + V 值係數配置

**介面層：**
- 三欄主佈局 + 16×4 預設矩陣
- 5 個編輯分頁（含即時 V 值顯示）
- 簽名卡 / 弱點內建設計器（含 V 值拆解）
- 起始牌組構築介面
- 總覽面板（四宮格敘事統計）
- **V 值平衡面板（四宮格量化平衡）**

**設計層：**
- 支柱五 §1.2 陣營主屬性修正
- 規則書第六章 §2.2 創角 18 點修正
- **新增：調查員強度 V 值量化規範**
- **新增：跨調查員平衡檢查原則**
- 陣營等級機制預留

**AI 整合：**
- 模式 A/B/C/D：敘事生成（背景、簽名卡傳敘、弱點、批次）
- **模式 E-1/E-2/E-3：V 值估算（能力文字、簽名卡、批次）**

---

## 十二、文件版本紀錄

| 版本 | 日期 | 變更內容 |
|------|------|---------|
| v1.0 | 2026/04/16 | 初版建立 — V 值計算系統（屬性 2.0V、HP/SAN 1.5V、熟練 7.5V、弱點公式）、自動重算觸發器、V 值平衡面板四宮格（散佈圖、箱型圖、堆疊柱、警告清單）、雷達圖比較、Gemini AI 模式 E 三種估算、10+ API 端點、規則書回寫清單補充 |

---

> **MOD-11 調查員設計器全系列指令文件交付完成**
>
> 四份檔案總計約 2,570 行，涵蓋：
> - 資料庫 + 5 張表 + 64 模板 Seed + V 值計算層
> - 設計器 UI + 預設矩陣 + 構築介面 + V 值即時顯示
> - Gemini AI 4 種敘事模式 + 3 種 V 值估算模式
> - 總覽面板（敘事統計）+ 平衡面板（量化強度）
>
> **給 Claude Code 的實作建議順序：**
> 1. Part 1（DB + 基礎 API）
> 2. Part 4 資料庫部分（V 值欄位、計算函數、觸發器）— 先建立量化基礎
> 3. Part 2（設計器 UI，含 Part 4 的 V 值顯示區塊）
> 4. Part 3（AI 敘事生成 + 總覽面板）
> 5. Part 4 剩餘部分（V 值平衡面板 + AI 估算 E 模式）
>
> Part 4 的資料層建議與 Part 1 同時實作，避免後續 UI 實作時資料不完整。
