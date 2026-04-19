# Claude Code 指令：團隊精神管理 MOD-04
## Team Spirit Manager Instructions

> **給 Claude Code：** 請建立團隊精神管理器，包含前後端兩部分：
> 1. **後端 API**：在 `packages/server/src/routes/` 新增團隊精神 CRUD 端點
> 2. **前端頁面**：在 `packages/client/public/admin/admin-team-spirit.html` 建立介面
>
> 本模組管理 32 種團隊精神的完整設計：基本定義、採用/升滿效果、5 點深度能力、
> 團隊里程碑、以及 32 種之間的價值比較面板。
>
> 資料存入 PostgreSQL。所有裝置打開同一個網址就能存取同一份資料。
>
> **視覺原則：** 與 MOD-01 卡片設計器一致 — 功能優先，樸素清楚，
> 遵守 admin-shared.css 的暗黑哥德色彩系統（深色背景、金色強調色）。

---

# 第一部分：資料庫結構

## 1.1 擴充 spirit_definitions 表

既有的 `spirit_definitions` 表（見 Schema v0.1 §2.2）結構過於簡化，
需要大幅擴充以支撐完整的設計需求。

### 方案：擴充既有表 + 新增深度效果子表

```sql
-- 擴充 spirit_definitions（團隊精神定義 — 主表）
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS code VARCHAR(64) UNIQUE;
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS category VARCHAR(32) NOT NULL DEFAULT 'combat';
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS description_en TEXT;
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS design_notes TEXT;

-- 採用效果與升滿效果
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS adopt_effect_zh TEXT;
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS adopt_effect_en TEXT;
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS maxed_effect_zh TEXT;
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS maxed_effect_en TEXT;

-- 團隊里程碑
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS milestone_effect_zh TEXT;
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS milestone_effect_en TEXT;

-- 價值評估
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS total_value DECIMAL(5,1) DEFAULT 0;
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS value_per_cohesion DECIMAL(5,2) DEFAULT 0;
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS effect_tags JSONB NOT NULL DEFAULT '[]';

-- 設計狀態追蹤
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS design_status VARCHAR(16) NOT NULL DEFAULT 'pending'
  CHECK (design_status IN ('pending', 'partial', 'complete'));
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE spirit_definitions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
```

> **注意：** 如果 `spirit_definitions` 表尚未建立，則使用完整的 CREATE TABLE：

```sql
CREATE TABLE spirit_definitions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                VARCHAR(64) UNIQUE NOT NULL,
  name_zh             VARCHAR(64) NOT NULL,
  name_en             VARCHAR(64) NOT NULL,
  category            VARCHAR(32) NOT NULL DEFAULT 'combat'
                      CHECK (category IN (
                        'combat', 'investigation', 'resource', 'growth',
                        'knowledge', 'rhythm', 'status', 'bestiary'
                      )),
  description         TEXT,
  description_en      TEXT,
  design_notes        TEXT,

  -- 採用效果（花 1 凝聚力採用時立即生效）
  adopt_effect_zh     TEXT,
  adopt_effect_en     TEXT,

  -- 升滿效果（5 點全滿的最終形態描述）
  maxed_effect_zh     TEXT,
  maxed_effect_en     TEXT,

  -- 團隊里程碑（5 點全滿後解鎖的質變級能力）
  milestone_name_zh   VARCHAR(64),
  milestone_name_en   VARCHAR(64),
  milestone_desc      TEXT,
  milestone_effect_zh TEXT,
  milestone_effect_en TEXT,

  -- 價值評估
  total_value         DECIMAL(5,1) NOT NULL DEFAULT 0,
  value_per_cohesion  DECIMAL(5,2) NOT NULL DEFAULT 0,
  effect_tags         JSONB NOT NULL DEFAULT '[]',

  -- 狀態追蹤
  design_status       VARCHAR(16) NOT NULL DEFAULT 'pending'
                      CHECK (design_status IN ('pending', 'partial', 'complete')),
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### spirit_depth_effects — 深度效果子表（新增）

```sql
CREATE TABLE spirit_depth_effects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spirit_def_id     UUID NOT NULL REFERENCES spirit_definitions(id) ON DELETE CASCADE,
  depth             INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 5),
  effect_name_zh    VARCHAR(64),
  effect_name_en    VARCHAR(64),
  effect_desc_zh    TEXT NOT NULL,
  effect_desc_en    TEXT,
  effect_value      DECIMAL(5,1) NOT NULL DEFAULT 0,
  effect_formula    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (spirit_def_id, depth)
);

CREATE INDEX idx_spirit_depth_spirit ON spirit_depth_effects(spirit_def_id);
```

## 1.2 分類代碼對照

| 分類代碼 | 中文 | 英文 | 包含數量 |
|----------|------|------|---------|
| `combat` | 戰鬥類 | Combat | 6 種 |
| `investigation` | 調查與資訊類 | Investigation & Intel | 4 種 |
| `resource` | 資源與經濟類 | Resource & Economy | 3 種 |
| `growth` | 成長與系統解鎖類 | Growth & Unlock | 4 種 |
| `knowledge` | 知識與神話類 | Knowledge & Mythos | 2 種 |
| `rhythm` | 團隊節奏類 | Team Rhythm | 2 種 |
| `status` | 異常狀態專精類 | Status Specialization | 5 種 |
| `bestiary` | 怪物學類 | Bestiary | 7 種 |

> 含伊格共 33 種，但維持 32 種候選上限。伊格作為第 33 種預留，`sort_order` 設為 33。

## 1.3 效果標籤（effect_tags）定義

用於價值比較面板的篩選與分類：

| 標籤代碼 | 中文 | 說明 |
|----------|------|------|
| `damage_boost` | 增傷 | 提升傷害輸出 |
| `damage_reduction` | 減傷 | 降低受到的傷害 |
| `healing` | 恢復 | HP/SAN 回復 |
| `resource_gen` | 資源產出 | 增加資源、素材、經驗值等獲取 |
| `card_advantage` | 卡牌優勢 | 抽牌、搜牌、回收 |
| `information` | 資訊獲取 | 線索、隱藏調查點、敵人資訊 |
| `system_unlock` | 系統解鎖 | 鍛造、製作、書籍、遺跡等 |
| `status_offense` | 狀態攻擊 | 施加負面狀態 |
| `status_defense` | 狀態防禦 | 移除負面狀態 |
| `chaos_control` | 混沌操控 | 混沌袋相關 |
| `action_economy` | 行動經濟 | 額外行動、免費行動 |
| `team_synergy` | 團隊協作 | 需多人配合才有價值 |

## 1.4 預設資料（Seed Data）

建立資料表後，灌入以下 32+1 種團隊精神的預設資料。
**所有規則書中已有的文字敘述都必須作為預設值填入，管理員打開設計器即可看到。**

### 戰鬥類（6 種）

| # | code | name_zh | name_en | description（來自規則書第四章 §7.2） |
|---|------|---------|---------|------|
| 1 | `ts_focus_fire` | 集火協調 | Focus Fire | 多人攻擊同一目標時觸發聯動加成 |
| 2 | `ts_cover` | 掩護戰術 | Cover Tactics | 替隊友承受藉機攻擊或部分傷害 |
| 3 | `ts_morale` | 殲滅士氣 | Kill Morale | 擊殺敵人時全隊獲得增益 |
| 4 | `ts_last_stand` | 死線爆發 | Last Stand | 任一隊友進入瀕死時，其他隊友獲得戰鬥增幅 |
| 5 | `ts_overwatch` | 輪替守望 | Overwatch | 指定隊友進入守望，敵人進入其地點時觸發免費攻擊 |
| 6 | `ts_vendetta` | 復仇之誓 | Vendetta | 隊友被擊倒時，對擊倒者攻擊獲得額外傷害 |

### 調查與資訊類（4 種）

| # | code | name_zh | name_en | description |
|---|------|---------|---------|------|
| 7 | `ts_clue_chain` | 線索連鎖 | Clue Chain | 同一回合內於不同地點各自獲得線索時觸發額外獎勵 |
| 8 | `ts_intuition` | 隱秘感知 | Hidden Intuition | 降低隱藏調查點的感知門檻，強化發現機制 |
| 9 | `ts_relic_read` | 遺跡解讀 | Relic Reading | 解鎖研究神話遺跡的能力，5 點深度對應遺跡難度等級 |
| 10 | `ts_relic_research` | 遺跡研究 | Relic Research | 強化遺跡研究效率 |

### 資源與經濟類（3 種）

| # | code | name_zh | name_en | description |
|---|------|---------|---------|------|
| 11 | `ts_growth` | 成長加速 | Growth Accelerator | 增加經驗值、凝聚力、天賦點的獲取量 |
| 12 | `ts_harvest` | 素材豐收 | Material Harvest | 增加素材掉落與採集收益 |
| 13 | `ts_spoils` | 戰利強化 | Spoils of War | 增加關卡內即時收益（資源、抽牌等） |

### 成長與系統解鎖類（4 種）

| # | code | name_zh | name_en | description |
|---|------|---------|---------|------|
| 14 | `ts_forge_unlock` | 鍛造解鎖 | Forge Unlock | 開啟鍛造功能，深度點數強化鍛造能力 |
| 15 | `ts_craft_unlock` | 製作解鎖 | Craft Unlock | 開啟製作功能，深度點數強化製作能力 |
| 16 | `ts_short_rest` | 短休息強化 | Short Rest Enhancement | 短休息時保留部分行動力 |
| 17 | `ts_chaos_control` | 混沌袋控制 | Chaos Bag Control | 混沌袋操控能力（窺探、重抽、移除標記等） |

### 知識與神話類（2 種）

| # | code | name_zh | name_en | description |
|---|------|---------|---------|------|
| 18 | `ts_ancient_text` | 古文解讀 | Ancient Text | 解鎖閱讀神話典籍的能力，5 點深度對應書籍難度等級。1 點＝初階神話文獻（入門級翻譯文本、邪教筆記）。2 點＝中階（《波納佩教典》《格拉基啟示錄》）。3 點＝高階（《伊波恩之書》《無名祭祀書》）。4 點＝頂級（《屍食教典儀》《妖蛆之秘密》）。5 點＝終極禁忌典籍（《死靈之書》）。 |
| 19 | `ts_book_research` | 書籍研究 | Book Research | 強化書籍閱讀效率 |

### 團隊節奏類（2 種）

| # | code | name_zh | name_en | description |
|---|------|---------|---------|------|
| 20 | `ts_stratagem` | 戰術預謀 | Stratagem | 回合開始時宣告全隊戰術狀態，全隊獲得小幅加成 |
| 21 | `ts_war_cry` | 戰場呼喊 | War Cry | 關鍵時刻觸發的強力全隊 BUFF |

### 異常狀態專精類（5 種）

| # | code | name_zh | name_en | description |
|---|------|---------|---------|------|
| 22 | `ts_corrosion` | 腐蝕專精 | Corrosion Mastery | 涵蓋狀態：流血（bleed, 2V/層）、中毒（poison, 3V/層）、燃燒（burning, 3V/層）。強化施加這些狀態的效果與持續性。 |
| 23 | `ts_frost` | 寒霜專精 | Frost Mastery | 涵蓋狀態：冷凍（frozen, 3V/層）、潮濕（wet, 1V/層）。強化冰系與水系的控場能力，利用冷凍的移動限制和潮濕的雷屬性增傷聯動。 |
| 24 | `ts_suppress` | 壓制專精 | Suppression Mastery | 涵蓋狀態：無力（weakness_status, 2V/層）、弱化（weakened, 3V/層）、脆弱（vulnerable, 2V/層）、繳械（disarm, 4V/層）。弱化敵人輸出與防禦能力。 |
| 25 | `ts_disrupt` | 瓦解專精 | Disruption Mastery | 涵蓋狀態：發瘋（madness, 6V/層）、疲勞（fatigue, 4V/層）、沈默（silence, 4V/層）。瓦解敵人行動能力的精神系控場。 |
| 26 | `ts_purify` | 淨化專精 | Purification Mastery | 涵蓋：全部負面狀態（移除自身）。防禦面專精，強化隊伍的負面狀態清除與抵抗能力。 |

### 怪物學類（7 種）

| # | code | name_zh | name_en | description |
|---|------|---------|---------|------|
| 27 | `ts_bestiary_cthulhu` | 怪物學：克蘇魯 | Bestiary: Cthulhu | 克蘇魯眷族。揭露克蘇魯系怪物的弱點、行為模式與隱藏資訊。混沌袋偏好：骷髏＝血祭（流血）、邪教徒＝信徒回應（深潛者增援）、石版＝禁忌知識（恐懼傷害）、遠古邪物＝異界滲透（鬧鬼）。 |
| 28 | `ts_bestiary_hastur` | 怪物學：哈斯塔 | Bestiary: Hastur | 哈斯塔眷族。混沌袋偏好：骷髏＝生命流逝（無力）、邪教徒＝末日推進（毀滅標記）、石版＝瘋狂低語（發瘋）、遠古邪物＝時空扭曲（隨機傳送）。 |
| 29 | `ts_bestiary_shub` | 怪物學：莎布 | Bestiary: Shub-Niggurath | 莎布·尼古拉絲眷族。混沌袋偏好：骷髏＝死亡之觸（HP 傷害）、邪教徒＝儀式共鳴（怪物回血）、石版＝精神枯竭（疲勞）、遠古邪物＝裂隙擴張（次元門）。 |
| 30 | `ts_bestiary_nyar` | 怪物學：奈亞 | Bestiary: Nyarlathotep | 奈亞拉托提普眷族。混沌袋偏好：骷髏＝生命代價（失去盟友）、邪教徒＝暴露（失去隱蔽）、石版＝不應知曉之事（神啟卡）、遠古邪物＝空間斷裂（斷開連接）。 |
| 31 | `ts_bestiary_yog` | 怪物學：猶格 | Bestiary: Yog-Sothoth | 猶格·索托斯眷族。混沌袋偏好：骷髏＝血祭（流血）、邪教徒＝末日推進（毀滅標記）、石版＝記憶崩解（棄手牌）、遠古邪物＝時空扭曲（隨機傳送）。 |
| 32 | `ts_bestiary_cthugha` | 怪物學：克圖格亞 | Bestiary: Cthugha | 克圖格亞眷族。混沌袋偏好：骷髏＝死亡之觸（HP 傷害）、邪教徒＝暴露（失去隱蔽）、石版＝禁忌知識（恐懼傷害）、遠古邪物＝異界之火（失火）。 |
| 33 | `ts_bestiary_yig` | 怪物學：伊格 | Bestiary: Yig | 伊格眷族（預留擴展）。混沌袋偏好：骷髏＝血祭（流血）、邪教徒＝信徒回應（蛇人增援）、石版＝瘋狂低語（發瘋）、遠古邪物＝異界滲透（鬧鬼）。 |

> **Seed Data 規則：** 以上 description 欄位的文字必須完整填入，不可省略。
> 管理員打開設計器即可看到規則書中所有已定義的內容，無需另外翻閱文件。

### 特殊預設：古文解讀的 5 點深度

`ts_ancient_text` 的 5 點深度在規則書中已有明確定義，需預填入 `spirit_depth_effects`：

| depth | effect_name_zh | effect_desc_zh |
|-------|---------------|----------------|
| 1 | 初階解讀 | 可閱讀初階神話文獻（入門級翻譯文本、邪教筆記） |
| 2 | 中階解讀 | 可閱讀中階神話文獻（《波納佩教典》《格拉基啟示錄》） |
| 3 | 高階解讀 | 可閱讀高階神話文獻（《伊波恩之書》《無名祭祀書》） |
| 4 | 頂級解讀 | 可閱讀頂級神話文獻（《屍食教典儀》《妖蛆之秘密》） |
| 5 | 終極禁忌 | 可閱讀終極禁忌典籍（《死靈之書》） |

### 特殊預設：遺跡解讀的 5 點深度

`ts_relic_read` 與古文解讀平行，需預填：

| depth | effect_name_zh | effect_desc_zh |
|-------|---------------|----------------|
| 1 | 初階感應 | 可研究初階神話遺跡 |
| 2 | 中階感應 | 可研究中階神話遺跡 |
| 3 | 高階感應 | 可研究高階神話遺跡 |
| 4 | 頂級感應 | 可研究頂級神話遺跡 |
| 5 | 終極共鳴 | 可研究終極神話遺跡 |

---

# 第二部分：後端 API

## 2.1 端點定義

```
# 團隊精神定義
GET    /api/team-spirits                 — 取得所有（含深度效果數量、設計狀態）
GET    /api/team-spirits/:id             — 取得單一（含 5 點深度效果、里程碑）
POST   /api/team-spirits                 — 新增
PUT    /api/team-spirits/:id             — 更新
DELETE /api/team-spirits/:id             — 刪除（級聯刪除深度效果）

# 深度效果
GET    /api/team-spirits/:spiritId/depths     — 取得某團隊精神的全部深度效果
PUT    /api/team-spirits/:spiritId/depths      — 批次更新 5 點深度效果（整批覆寫）
PUT    /api/team-spirits/:spiritId/depths/:depth — 更新單一深度效果

# 價值比較
GET    /api/team-spirits/compare         — 取得 32 種的價值比較摘要資料

# AI 生成
POST   /api/team-spirits/:spiritId/generate-depths    — AI 生成 5 點深度效果
POST   /api/team-spirits/:spiritId/generate-milestone  — AI 生成里程碑

# 批次操作
GET    /api/team-spirits/export          — 匯出所有資料為 JSON
POST   /api/team-spirits/import          — 批次匯入（接受 JSON）
```

## 2.2 查詢參數（GET /api/team-spirits）

```
?category=combat            — 篩選分類
?design_status=pending      — 篩選設計狀態
?search=鍛造                — 搜尋名稱（中英文模糊搜尋）
?sort=total_value           — 排序（total_value / value_per_cohesion / sort_order）
```

## 2.3 回傳格式

與 MOD-01 一致：

```json
{
  "success": true,
  "data": { ... },
  "total": 32,
  "error": null
}
```

## 2.4 `GET /api/team-spirits/:id` 回傳範例

```json
{
  "success": true,
  "data": {
    "id": "uuid...",
    "code": "ts_focus_fire",
    "name_zh": "集火協調",
    "name_en": "Focus Fire",
    "category": "combat",
    "description": "多人攻擊同一目標時觸發聯動加成",
    "description_en": "...",
    "design_notes": "設計者備註...",
    "adopt_effect_zh": "採用後，當 2 名以上調查員在同一回合攻擊同一敵人時...",
    "adopt_effect_en": "...",
    "maxed_effect_zh": "5 點全滿：集火加成提升至...",
    "maxed_effect_en": "...",
    "milestone_name_zh": "殲滅協定",
    "milestone_name_en": "Annihilation Protocol",
    "milestone_desc": "...",
    "milestone_effect_zh": "集火目標被擊殺時，全隊恢復 1 行動點...",
    "milestone_effect_en": "...",
    "total_value": 18.5,
    "value_per_cohesion": 3.08,
    "effect_tags": ["damage_boost", "team_synergy"],
    "design_status": "complete",
    "depth_effects": [
      {
        "depth": 1,
        "effect_name_zh": "初階協調",
        "effect_name_en": "Basic Coordination",
        "effect_desc_zh": "第二位攻擊同一目標的調查員，該次攻擊傷害 +1",
        "effect_desc_en": "...",
        "effect_value": 2.5,
        "effect_formula": "單次攻擊傷害加成 +1 = 2.5V"
      },
      {
        "depth": 2,
        "effect_name_zh": "...",
        "effect_desc_zh": "...",
        "effect_value": 3.0,
        "effect_formula": "..."
      }
    ]
  }
}
```

## 2.5 `GET /api/team-spirits/compare` 回傳範例

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid...",
      "code": "ts_focus_fire",
      "name_zh": "集火協調",
      "category": "combat",
      "design_status": "complete",
      "total_value": 18.5,
      "value_per_cohesion": 3.08,
      "effect_tags": ["damage_boost", "team_synergy"],
      "depth_values": [2.5, 3.0, 4.0, 4.5, 4.5],
      "milestone_value": 6.0,
      "has_milestone": true
    }
  ],
  "total": 32
}
```

---

# 第三部分：頁面結構

## 3.1 整體佈局 — 雙標籤頁

頁面頂層分為兩個標籤頁：

```
[📋 設計編輯] [📊 價值比較]
```

### 標籤一：設計編輯（預設）

```
┌──────────────────────────────────────────────────────────────────┐
│  頂部導航列（返回首頁 + 頁面標題 MOD-04）                         │
├──────────────────────────────────────────────────────────────────┤
│  工具列：[匯出 JSON] [匯入 JSON] [設定 Gemini API Key]           │
│  標籤：  [📋 設計編輯] [📊 價值比較]                              │
├────────────────┬─────────────────────────────────────────────────┤
│                │                                                 │
│   精神列表     │              主編輯區                            │
│  （左側面板）   │                                                 │
│                │   ┌─────────────────────────────────────────┐   │
│  ▼ 戰鬥類(6)  │   │  ① 基本資訊                              │   │
│  · 集火協調 ✓  │   │  代碼 / 中英文名 / 分類 / 說明            │   │
│  · 掩護戰術 ◐  │   │  採用效果 / 升滿效果                      │   │
│  · 殲滅士氣 ○  │   ├─────────────────────────────────────────┤   │
│  · 死線爆發 ○  │   │  ② 五點深度效果                           │   │
│  · 輪替守望 ○  │   │  ┌────┬────────┬────────┬──────┐         │   │
│  · 復仇之誓 ○  │   │  │ Lv │ 名稱    │ 效果    │ 價值 │         │   │
│  ▶ 調查類(4)  │   │  ├────┼────────┼────────┼──────┤         │   │
│  ▶ 資源類(3)  │   │  │  1 │ 初階... │ .....  │ 2.5V │         │   │
│  ▶ 成長類(4)  │   │  │  2 │ .....  │ .....  │ 3.0V │         │   │
│  ▶ 知識類(2)  │   │  │  3 │ .....  │ .....  │ 4.0V │         │   │
│  ▶ 節奏類(2)  │   │  │  4 │ .....  │ .....  │ 4.5V │         │   │
│  ▶ 狀態類(5)  │   │  │  5 │ .....  │ .....  │ 4.5V │         │   │
│  ▶ 怪物學(7)  │   │  └────┴────────┴────────┴──────┘         │   │
│                │   │  [AI 生成深度效果]                         │   │
│  統計：         │   ├─────────────────────────────────────────┤   │
│  ✓ 完成 3      │   │  ③ 團隊里程碑                             │   │
│  ◐ 部分 5      │   │  名稱 / 效果描述 / 效果價值                │   │
│  ○ 待設計 24   │   │  [AI 生成里程碑]                           │   │
│                │   ├─────────────────────────────────────────┤   │
│                │   │  ④ 價值標籤與設計狀態                      │   │
│                │   │  效果標籤（多選）/ 總價值 / 效率            │   │
│                │   └─────────────────────────────────────────┘   │
│                │                                                 │
│                │  [儲存] [AI 全套生成] [標記為完成]               │
└────────────────┴─────────────────────────────────────────────────┘
```

### 標籤二：價值比較（見第七部分）

## 3.2 響應式調整

- 寬螢幕：兩欄佈局（左側列表 | 右側主編輯區）
- 中螢幕：左側面板可收合
- 窄螢幕：單欄，以標籤切換

---

# 第四部分：左側面板 — 精神列表

## 4.1 分組顯示

- 32 種按 8 個分類折疊分組
- 每個分類顯示分類名稱 + 包含數量
- 點擊分類標題展開/收合
- 預設全部展開

## 4.2 每項顯示

- 團隊精神名稱（中文）
- 設計狀態圖示：
  - ✓ 綠色勾勾 = `complete`（5 點深度 + 里程碑都已填寫）
  - ◐ 黃色半滿 = `partial`（部分填寫）
  - ○ 灰色空心 = `pending`（尚未設計）
- 選中項目高亮（金色左側邊框）

## 4.3 底部統計

```
設計進度：
✓ 完成 3 / 32
◐ 部分 5 / 32
○ 待設計 24 / 32
```

---

# 第五部分：主編輯區

## 5.1 區塊一：基本資訊

| 欄位 | 類型 | 說明 | 驗證 |
|------|------|------|------|
| 代碼 (code) | 文字（唯讀） | 如 `ts_focus_fire` | Seed Data 預設 |
| 中文名稱 (name_zh) | 文字輸入 | 如「集火協調」 | 必填 |
| 英文名稱 (name_en) | 文字輸入 + [生成英文] | | 必填 |
| 分類 (category) | 下拉選單 | 8 個分類之一 | 必填 |
| 中文說明 (description) | 文字區域 | 來自規則書的設計方向說明 | — |
| 英文說明 (description_en) | 文字區域 + [生成英文] | | — |
| 設計備註 (design_notes) | 文字區域 | 設計者的私人備註 | — |
| 採用效果 — 中文 (adopt_effect_zh) | 文字區域 | 花 1 凝聚力採用時立即生效的基礎能力 | — |
| 採用效果 — 英文 (adopt_effect_en) | 文字區域 + [生成英文] | | — |
| 升滿效果 — 中文 (maxed_effect_zh) | 文字區域 | 5 點全滿的最終形態描述 | — |
| 升滿效果 — 英文 (maxed_effect_en) | 文字區域 + [生成英文] | | — |

## 5.2 區塊二：五點深度效果

以 **5 行表格** 呈現，每行展開可編輯：

### 收合狀態（預設）

```
┌────┬──────────┬──────────────────────────────┬───────┐
│ Lv │ 名稱      │ 效果摘要（前 40 字）          │ 價值   │
├────┼──────────┼──────────────────────────────┼───────┤
│  1 │ 初階協調  │ 第二位攻擊同一目標的調查員... │  2.5V │
│  2 │ 進階協調  │ 集火傷害加成提升至 +2...     │  3.0V │
│  3 │ —        │ （待設計）                    │  —    │
│  4 │ —        │ （待設計）                    │  —    │
│  5 │ —        │ （待設計）                    │  —    │
└────┴──────────┴──────────────────────────────┴───────┘
```

### 展開狀態（點擊某行）

| 欄位 | 類型 | 說明 | 驗證 |
|------|------|------|------|
| 效果名稱 — 中文 (effect_name_zh) | 文字輸入 | 如「初階協調」 | — |
| 效果名稱 — 英文 (effect_name_en) | 文字輸入 + [生成英文] | | — |
| 效果描述 — 中文 (effect_desc_zh) | 文字區域（3 行） | 具體效果描述 | 必填（如要標記為完成） |
| 效果描述 — 英文 (effect_desc_en) | 文字區域（3 行） + [生成英文] | | — |
| 效果價值 (effect_value) | 數字輸入（小數一位） | 以 V 為單位 | ≥ 0 |
| 價值公式 (effect_formula) | 文字輸入 | 如「單次攻擊傷害加成 +1 = 2.5V」 | — |

### 效果價值輔助

在每一行的效果價值旁邊，提供一個 **[查詢價值表]** 按鈕，點擊後展開常用效果價值速查：

```
┌─ 效果價值速查 ────────────────────────────────┐
│ 傷害 / 恢復                                    │
│  · 1 傷害 = 1V    · 1 恐懼 = 3V               │
│  · 1 HP 恢復 = 1.5V  · 1 SAN 恢復 = 1.5V     │
│  · 攻擊 +1 = 2.5V  · +2 = 5V  · +3 = 7.5V   │
│                                                │
│ 卡牌 / 資源                                    │
│  · 抽 1 張 = 1V   · 1 資源 = 1V               │
│  · 搜牌 = 6V      · 回收棄牌 = 1.5V           │
│                                                │
│ 檢定修正                                       │
│  · 單屬性 +1 = 0.5V  · +2 = 1.5V  · +3 = 3V  │
│  · 萬能 +1 = 1V  · +2 = 3V  · +3 = 6V        │
│                                                │
│ 戰鬥控制                                       │
│  · 絆倒 = 2V  · 安全脫離 = 1V  · 斬殺 = 3V+  │
│                                                │
│ 環境                                           │
│  · 免費線索 = 2V   · 移除毀滅 = 4V            │
│                                                │
│ 狀態（每層）                                    │
│  · 中毒 3V · 流血 2V · 燃燒 3V · 冷凍 3V      │
│  · 發瘋 6V · 標記 6V · 護甲 3V · 護盾 6V      │
│  · 強化 3V · 隱蔽 6V · 再生 6V                │
│                                                │
│ 特殊                                           │
│  · 快速 = +1V  · 額外攻擊 = 1.5V              │
│  · 重擲 = 1V   · 自動成功 = 4V                │
└────────────────────────────────────────────────┘
```

> 此速查表的資料來源為《規則書 v1.0 第三章 §7》及《卡片價值計算規範 v1.1 §2》。

### 深度效果底部

- [AI 生成深度效果] 按鈕（見第六部分）
- 深度總計：顯示 5 點效果價值的加總
- 進度條：5 格，填寫幾格亮幾格

## 5.3 區塊三：團隊里程碑

| 欄位 | 類型 | 說明 | 驗證 |
|------|------|------|------|
| 里程碑名稱 — 中文 (milestone_name_zh) | 文字輸入 | 如「殲滅協定」 | — |
| 里程碑名稱 — 英文 (milestone_name_en) | 文字輸入 + [生成英文] | | — |
| 里程碑說明 (milestone_desc) | 文字區域 | 設計概念描述 | — |
| 里程碑效果 — 中文 (milestone_effect_zh) | 文字區域（4 行） | 質變級能力的具體效果 | — |
| 里程碑效果 — 英文 (milestone_effect_en) | 文字區域（4 行） + [生成英文] | | — |

- [AI 生成里程碑] 按鈕

## 5.4 區塊四：價值標籤與設計狀態

| 欄位 | 類型 | 說明 |
|------|------|------|
| 效果標籤 (effect_tags) | 多選勾選框 | 從 §1.3 定義的 12 種標籤中勾選 |
| 總價值 (total_value) | 自動計算（唯讀） | = 5 點深度效果價值加總 |
| 投資效率 (value_per_cohesion) | 自動計算（唯讀） | = 總價值 ÷ 6（採用 1 + 深度 5） |
| 設計狀態 (design_status) | 自動判定 + 手動覆寫 | 自動：全部填完 = complete，部分 = partial，空白 = pending |

自動判定邏輯：
- `complete`：5 點深度效果全部填寫 + 里程碑效果已填寫
- `partial`：至少 1 點深度效果已填寫
- `pending`：全空

底部按鈕：
- [儲存] — 儲存當前所有區塊
- [AI 全套生成] — 一次生成採用效果 + 5 點深度 + 里程碑（見第六部分）
- [標記為完成] — 手動覆寫狀態為 complete

---

# 第六部分：AI 生成（Gemini 2.5 Flash）

## 6.1 設定

與 MOD-01 共用 Gemini API Key（localStorage key: `gemini_api_key`）。

## 6.2 三種生成模式

### 模式 A：AI 生成深度效果

觸發：[AI 生成深度效果] 按鈕

```
┌─────────────────────────────────────────────────┐
│  AI 生成 5 點深度效果                             │
│                                                   │
│  當前精神：{name_zh}（{name_en}）                  │
│  分類：{category_zh}                              │
│  說明：{description}                              │
│                                                   │
│  設計方向補充（可選）：                             │
│  ┌───────────────────────────────────────┐       │
│  │  例如：偏重近戰協作、前三點實用...      │       │
│  └───────────────────────────────────────┘       │
│                                                   │
│  [生成] [取消]                                     │
└─────────────────────────────────────────────────┘
```

### 模式 B：AI 生成里程碑

觸發：[AI 生成里程碑] 按鈕

讀取已填寫的 5 點深度效果作為上下文，生成質變級的里程碑能力。

### 模式 C：AI 全套生成

觸發：[AI 全套生成] 按鈕

依序生成：採用效果 → 5 點深度效果 → 升滿效果 → 里程碑。
一次呼叫，回傳完整 JSON。

## 6.3 Prompt 設計

### 深度效果生成 Prompt

```
你是一個克蘇魯神話合作卡牌遊戲的系統設計師。請為一項「團隊精神」設計 5 點深度效果。

## 遊戲背景
- 1–4 人合作，克蘇魯神話世界觀
- 團隊精神是隊伍共用的能力，透過「凝聚力」資源投資
- 候選池 32 種，每支隊伍最多選 7 種，每種最多投 5 點
- 採用新項目花費 1 凝聚力，每點深度花費 1 凝聚力，點滿一項總花費 6 凝聚力
- 凝聚力來源：長休息每次 +1、支線通關
- 點滿 5 點後還可解鎖「團隊里程碑」（質變級進階能力）

## 遊戲數值體系
基本價值錨點：1V = 1 行動點 = 1 資源 = 抽 1 張牌 = 造成 1 點傷害
常用效果價值：
- 1 傷害 = 1V、1 恐懼傷害 = 3V
- 恢復 1 HP = 1.5V、恢復 1 SAN = 1.5V
- 攻擊傷害加成 +1/+2/+3 = 2.5V/5V/7.5V
- 抽 1 張 = 1V、1 資源 = 1V
- 單屬性檢定 +1/+2/+3 = 0.5V/1.5V/3V
- 萬能檢定 +1/+2/+3 = 1V/3V/6V
- 絆倒 = 2V、免費線索 = 2V、移除毀滅 = 4V
- 狀態每層：中毒 3V、流血 2V、燃燒 3V、護甲 3V、護盾 6V

## 行動經濟
- 調查員每回合 3 行動點
- 手牌上限 8 張、每回合抽 1 張、每回合 +1 資源
- 起始資源 5 點

## 設計對象
名稱：{name_zh}（{name_en}）
分類：{category_zh}
說明：{description}
設計方向補充：{user_input}

## 設計原則
1. **漸進式成長** — 第 1 點是基礎能力，每點遞增，第 5 點是強力但不破格的頂峰
2. **每點都有感** — 每一點投資都應該有可察覺的提升，不能有「廢點」
3. **凝聚力經濟** — 6 凝聚力是很大的投資（6 個長休息 = 6 個章節），效果要對得起這個投資
4. **不破壞紅線** — 不能產生無限循環、不能消滅挑戰、不能讓死亡失去重量
5. **合作導向** — 團隊精神是「隊伍」的能力，鼓勵合作而非單打獨鬥
6. **價值合理** — 每點深度的效果價值應在 1V–6V 之間，5 點總和在 10V–25V 之間

## 輸出格式
請回傳以下 JSON，不要回傳其他任何文字：
{
  "adopt_effect_zh": "採用時的基礎能力描述",
  "adopt_effect_en": "English...",
  "maxed_effect_zh": "5 點全滿的最終形態描述",
  "maxed_effect_en": "English...",
  "depths": [
    {
      "depth": 1,
      "effect_name_zh": "效果名稱（2–4 字）",
      "effect_name_en": "Effect Name",
      "effect_desc_zh": "具體效果描述，包含數值",
      "effect_desc_en": "English...",
      "effect_value": 2.5,
      "effect_formula": "效果價值計算公式說明"
    },
    { "depth": 2, ... },
    { "depth": 3, ... },
    { "depth": 4, ... },
    { "depth": 5, ... }
  ]
}
```

### 里程碑生成 Prompt

```
你是一個克蘇魯神話合作卡牌遊戲的系統設計師。請為一項已完成 5 點深度設計的「團隊精神」設計團隊里程碑。

## 團隊精神資訊
名稱：{name_zh}（{name_en}）
分類：{category_zh}
說明：{description}

5 點深度效果：
1. {depth_1_desc}（{depth_1_value}V）
2. {depth_2_desc}（{depth_2_value}V）
3. {depth_3_desc}（{depth_3_value}V）
4. {depth_4_desc}（{depth_4_value}V）
5. {depth_5_desc}（{depth_5_value}V）

## 里程碑設計原則
- 里程碑是點滿 5 點後解鎖的**質變級**能力
- 應該是 5 點深度效果的邏輯巔峰，而非單純的數值加強
- 可以改變遊戲規則、打開新的戰術可能性
- 但不能破壞六條設計紅線
- 里程碑是隊伍花費大量凝聚力（6 點）後的獎勵，要有「值得」的感覺
- 情感目標：「戰友的羈絆 — 我們一起走過地獄，這份默契是真實的」

## 輸出格式
請回傳以下 JSON，不要回傳其他任何文字：
{
  "milestone_name_zh": "里程碑名稱（2-4字）",
  "milestone_name_en": "Milestone Name",
  "milestone_desc": "設計概念說明",
  "milestone_effect_zh": "具體效果描述，包含數值和觸發條件",
  "milestone_effect_en": "English..."
}
```

### 全套生成 Prompt

合併深度效果 Prompt + 里程碑 Prompt，在同一次呼叫中要求回傳完整結構：

```
...（包含上述兩個 Prompt 的所有上下文）...

## 輸出格式
請回傳以下完整 JSON，不要回傳其他任何文字：
{
  "adopt_effect_zh": "...",
  "adopt_effect_en": "...",
  "maxed_effect_zh": "...",
  "maxed_effect_en": "...",
  "depths": [ ... ],
  "milestone_name_zh": "...",
  "milestone_name_en": "...",
  "milestone_desc": "...",
  "milestone_effect_zh": "...",
  "milestone_effect_en": "..."
}
```

## 6.4 後處理

API 回傳後：
1. 解析 JSON
2. 驗證 depths 陣列長度為 5，depth 值為 1–5
3. 驗證 effect_value 為合理數值（0–10V）
4. 填入表單所有欄位
5. 自動計算總價值和投資效率
6. 使用者可自由修改後再儲存

## 6.5 錯誤處理

與 MOD-01 一致。

---

# 第七部分：價值比較面板

## 7.1 切換方式

點擊頂部 [📊 價值比較] 標籤進入。

## 7.2 整體佈局

```
┌──────────────────────────────────────────────────────────────────┐
│  篩選列                                                          │
│  分類：[全部▾]  狀態：[全部▾]  標籤：[全部▾]                      │
│  排序：[總價值▾] [投資效率] [分類] [名稱]                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │集火協調   │ │掩護戰術   │ │殲滅士氣   │ │死線爆發   │            │
│  │━━━━━━━━━ │ │━━━━━━━━━ │ │━━━━━━━━━ │ │          │            │
│  │ 18.5V    │ │ 14.0V    │ │ 12.5V    │ │ 待設計    │            │
│  │ 3.08/凝  │ │ 2.33/凝  │ │ 2.08/凝  │ │          │            │
│  │ ▓▓▓▓▓    │ │ ▓▓▓▓░    │ │ ▓▓▓░░    │ │ ░░░░░    │            │
│  │增傷 協作  │ │減傷 協作  │ │增傷      │ │          │            │
│  │  ✓完成   │ │  ✓完成   │ │  ◐部分   │ │  ○待設計  │            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
│                                                                  │
│  ┌──────────┐ ┌──────────┐  ...                                  │
│  │輪替守望   │ │復仇之誓   │                                      │
│  │ ...      │ │ ...      │                                      │
│  └──────────┘ └──────────┘                                      │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  對比面板（勾選 2–4 種後顯示）                                     │
│  ┌────────────────────────────────────────────────────────┐      │
│  │  深度投資回報對比                                        │      │
│  │                                                        │      │
│  │  6V ┤                                          ●       │      │
│  │  5V ┤                              ●    ●              │      │
│  │  4V ┤                    ●    ●                        │      │
│  │  3V ┤          ●    ●                                  │      │
│  │  2V ┤    ●                                             │      │
│  │  1V ┤                                                  │      │
│  │     └────┬────┬────┬────┬────┬                        │      │
│  │         Lv1  Lv2  Lv3  Lv4  Lv5                       │      │
│  │                                                        │      │
│  │  —— 集火協調  —— 掩護戰術  —— 殲滅士氣                  │      │
│  └────────────────────────────────────────────────────────┘      │
│                                                                  │
│  ┌──────────────────────┐ ┌──────────────────────┐              │
│  │ 總價值排行             │ │ 投資效率排行           │              │
│  │ 1. 集火協調 18.5V     │ │ 1. 集火協調 3.08V/凝  │              │
│  │ 2. 掩護戰術 14.0V     │ │ 2. 掩護戰術 2.33V/凝  │              │
│  │ 3. 殲滅士氣 12.5V     │ │ 3. ...               │              │
│  │ ...                   │ │ ...                   │              │
│  └──────────────────────┘ └──────────────────────┘              │
└──────────────────────────────────────────────────────────────────┘
```

## 7.3 卡片概覽

32 種以卡片網格排列，每張卡片顯示：

| 內容 | 說明 |
|------|------|
| 名稱（中文） | 大字顯示 |
| 總價值 | 5 點加總，大數字顯示 |
| 投資效率 | 總價值 ÷ 6，小數兩位 |
| 深度填充條 | 5 格小方塊，已設計的亮金色，未設計的灰色 |
| 效果標籤 | 小標籤列 |
| 設計狀態 | ✓/◐/○ 圖示 |

- 待設計的卡片顯示為暗灰色，不顯示數值
- 可勾選 2–4 張卡片進入對比模式

## 7.4 對比面板

勾選 2–4 種後，底部展開對比面板：

### 深度投資回報折線圖

- X 軸：Lv1 到 Lv5
- Y 軸：每點的效果價值（V）
- 每種團隊精神一條折線，用不同顏色區分
- 顯示圖例

### 數值對比表

| 維度 | 集火協調 | 掩護戰術 | 殲滅士氣 |
|------|---------|---------|---------|
| 總價值 | 18.5V | 14.0V | 12.5V |
| 投資效率 | 3.08 | 2.33 | 2.08 |
| 最強單點 | Lv5 (4.5V) | Lv3 (4.0V) | Lv4 (3.5V) |
| 里程碑 | ✓ 已設計 | ✓ 已設計 | ○ 待設計 |
| 效果類型 | 增傷/協作 | 減傷/協作 | 增傷 |

### 排行榜

兩個並排排行榜：
- 左邊：總價值排行（高到低）
- 右邊：投資效率排行（高到低）
- 只顯示已完成設計的項目
- 待設計的列在底部灰色顯示

## 7.5 篩選與排序

| 篩選 | 選項 |
|------|------|
| 分類 | 全部 / 戰鬥 / 調查 / 資源 / 成長 / 知識 / 節奏 / 狀態 / 怪物學 |
| 設計狀態 | 全部 / 完成 / 部分 / 待設計 |
| 效果標籤 | 全部 / 12 種標籤多選 |

| 排序 | 說明 |
|------|------|
| 總價值 | 由高到低 |
| 投資效率 | 由高到低 |
| 分類 | 按分類分組 |
| 名稱 | 中文筆畫排序 |

---

# 第八部分：表單互動邏輯

## 8.1 精神切換

- 點擊左側列表 → API 請求 `GET /api/team-spirits/:id`
- 載入回傳資料到所有區塊
- 深度效果表格刷新

## 8.2 自動計算

- 修改任一深度效果的 `effect_value` → 自動重算 `total_value` 和 `value_per_cohesion`
- 結果即時顯示在區塊四

## 8.3 設計狀態自動判定

- 每次儲存後重新判定 `design_status`
- 判定邏輯：
  - 5 點深度的 `effect_desc_zh` 全部非空 + `milestone_effect_zh` 非空 → `complete`
  - 至少 1 點深度的 `effect_desc_zh` 非空 → `partial`
  - 全空 → `pending`
- [標記為完成] 按鈕可手動覆寫為 `complete`

## 8.4 未儲存提示

- 修改任一欄位後，該區塊標題旁顯示金色小點（未儲存標記）
- 切換精神時若有未儲存變更，彈出確認對話框

## 8.5 快捷鍵

| 快捷鍵 | 功能 |
|--------|------|
| `Ctrl + S` | 儲存全部 |
| `Ctrl + G` | AI 全套生成 |
| `Esc` | 取消編輯 |

---

# 第九部分：參考常數

需要在 `admin-shared.js` 中新增（如果不存在）：

```javascript
// 團隊精神分類
const SPIRIT_CATEGORIES = {
  combat:        { code: 'combat',        zh: '戰鬥類',         en: 'Combat',               count: 6 },
  investigation: { code: 'investigation', zh: '調查與資訊類',    en: 'Investigation & Intel', count: 4 },
  resource:      { code: 'resource',      zh: '資源與經濟類',    en: 'Resource & Economy',    count: 3 },
  growth:        { code: 'growth',        zh: '成長與系統解鎖類', en: 'Growth & Unlock',       count: 4 },
  knowledge:     { code: 'knowledge',     zh: '知識與神話類',    en: 'Knowledge & Mythos',    count: 2 },
  rhythm:        { code: 'rhythm',        zh: '團隊節奏類',     en: 'Team Rhythm',           count: 2 },
  status:        { code: 'status',        zh: '異常狀態專精類',  en: 'Status Specialization', count: 5 },
  bestiary:      { code: 'bestiary',      zh: '怪物學類',       en: 'Bestiary',              count: 7 },
};

// 效果標籤
const EFFECT_TAGS = {
  damage_boost:     { zh: '增傷',     en: 'Damage Boost' },
  damage_reduction: { zh: '減傷',     en: 'Damage Reduction' },
  healing:          { zh: '恢復',     en: 'Healing' },
  resource_gen:     { zh: '資源產出', en: 'Resource Generation' },
  card_advantage:   { zh: '卡牌優勢', en: 'Card Advantage' },
  information:      { zh: '資訊獲取', en: 'Information' },
  system_unlock:    { zh: '系統解鎖', en: 'System Unlock' },
  status_offense:   { zh: '狀態攻擊', en: 'Status Offense' },
  status_defense:   { zh: '狀態防禦', en: 'Status Defense' },
  chaos_control:    { zh: '混沌操控', en: 'Chaos Control' },
  action_economy:   { zh: '行動經濟', en: 'Action Economy' },
  team_synergy:     { zh: '團隊協作', en: 'Team Synergy' },
};

// 團隊精神基礎規則
const TEAM_SPIRIT_RULES = {
  MAX_SELECTED: 7,           // 隊伍最多選擇 7 種
  MAX_DEPTH: 5,              // 每種最多 5 點
  ADOPT_COST: 1,             // 採用花費 1 凝聚力
  DEPTH_COST: 1,             // 每點深度花費 1 凝聚力
  TOTAL_COST_PER_SPIRIT: 6,  // 點滿一項總花費 = 1 + 5
  CANDIDATE_POOL: 32,        // 候選池 32 種
};
```

---

# 第十部分：完成後

1. 執行 Seed Data 腳本，灌入 32+1 種團隊精神預設資料（含規則書所有文字）
2. 灌入古文解讀（`ts_ancient_text`）和遺跡解讀（`ts_relic_read`）的 5 點深度預設資料
3. 測試所有 CRUD 操作
4. 測試 Gemini AI 生成（深度效果、里程碑、全套）
5. 測試價值比較面板（篩選、排序、對比）
6. 確認自動計算（總價值、投資效率、設計狀態判定）
7. 確認響應式佈局
8. Git commit：`feat: implement team spirit manager (MOD-04) — full CRUD, 5-depth design, milestone, value comparison panel, Gemini AI generation`
9. 更新 index.html 中 MOD-04 的狀態標籤從 `PLANNED` 改為 `READY`
10. Push 到 GitHub

---

# 附錄：相關文件

- 《規則書 v1.0 第四章》§6 — 凝聚力系統（獲取規則、隊長制、玩家變動規則）
- 《規則書 v1.0 第四章》§7 — 團隊精神系統（基礎規則、32 種完整清單含代碼）
- 《規則書 v1.0 第四章》§8 — 書籍子系統（古文解讀深度對應）
- 《規則書 v1.0 第四章》§9 — 遺跡子系統（遺跡解讀深度對應）
- 《規則書 v1.0 第三章》§7 — 效果價值表（1V 基準、所有效果的 V 值對照）
- 《卡片價值計算規範 v1.1》§2 — 效果價值表（含萬能加值延伸、狀態價值）
- 《規則書 v1.0 第六章》§13 — 怪物家族與混沌袋場景效果對應表
- 《規則書 v1.0 第一章》§4 — 核心情感設計（團隊精神解鎖里程碑的情感目標）
- 《規則書 v1.0 第一章》§3 — 設計紅線（里程碑設計不可違反的禁區）
