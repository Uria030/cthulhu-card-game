# Claude Code 指令：戰鬥風格與專精管理 MOD-05
## Combat Style & Specialization Manager Instructions

> **給 Claude Code：** 請建立戰鬥風格與專精管理器，包含前後端兩部分：
> 1. **後端 API**：在 `packages/server/src/routes/` 新增戰鬥風格、專精、風格卡的 CRUD 端點
> 2. **前端頁面**：在 `packages/client/public/admin/admin-proficiency.html` 建立介面
>
> 本模組管理三層資料：8 種戰鬥風格 → 30 種專精 → 調查員風格卡池。
> 資料存入 PostgreSQL。所有裝置打開同一個網址就能存取同一份資料。
>
> **視覺原則：** 與 MOD-01 卡片設計器一致 — 功能優先，樸素清楚，
> 遵守 admin-shared.css 的暗黑哥德色彩系統（深色背景、金色強調色）。

---

# 第一部分：資料庫結構

## 1.1 新增資料表

既有的 `proficiency_definitions` 表（見 Schema v0.1 §3.5）只涵蓋熟練定義，
本模組需要擴充為三張表，形成完整的三層結構。

### combat_styles — 戰鬥風格（第一層）

```sql
CREATE TABLE combat_styles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(32) UNIQUE NOT NULL,
  name_zh       VARCHAR(64) NOT NULL,
  name_en       VARCHAR(64) NOT NULL,
  description_zh TEXT,
  description_en TEXT,
  spec_count    INTEGER NOT NULL DEFAULT 0,   -- 下轄專精數量（自動計算）
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### combat_specializations — 戰鬥專精（第二層）

```sql
CREATE TABLE combat_specializations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  style_id      UUID NOT NULL REFERENCES combat_styles(id) ON DELETE CASCADE,
  code          VARCHAR(64) UNIQUE NOT NULL,
  name_zh       VARCHAR(64) NOT NULL,
  name_en       VARCHAR(64) NOT NULL,
  description_zh TEXT,
  description_en TEXT,
  attribute     VARCHAR(16) NOT NULL,          -- 對應的主要屬性（七大屬性之一）
  prof_bonus    INTEGER NOT NULL DEFAULT 1,    -- 熟練加成
  spec_bonus    INTEGER NOT NULL DEFAULT 2,    -- 專精加成
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_specs_style ON combat_specializations(style_id);
```

### combat_style_cards — 調查員風格卡（第三層）

```sql
CREATE TABLE combat_style_cards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  style_id      UUID NOT NULL REFERENCES combat_styles(id) ON DELETE CASCADE,
  code          VARCHAR(64) UNIQUE NOT NULL,
  name_zh       VARCHAR(64) NOT NULL,
  name_en       VARCHAR(64) NOT NULL,
  check_attribute VARCHAR(16) NOT NULL,        -- 本次檢定使用的屬性（七大屬性之一）
  narrative_attack_zh  TEXT NOT NULL,           -- 攻擊敘事（中文）
  narrative_attack_en  TEXT,                    -- 攻擊敘事（英文）
  narrative_success_zh TEXT NOT NULL,           -- 成功敘事（中文）
  narrative_success_en TEXT,                    -- 成功敘事（英文）
  narrative_fail_zh    TEXT NOT NULL,           -- 失敗敘事（中文）
  narrative_fail_en    TEXT,                    -- 失敗敘事（英文）
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_style_cards_style ON combat_style_cards(style_id);
```

## 1.2 關鍵設計備註

- **風格卡上不存 DC 和傷害** — DC 來自目標怪物，傷害來自武器卡。風格卡只決定「用什麼屬性檢定」和「敘事怎麼說」。
- **風格卡池是公用的** — 有無熟練都從同一卡池抽卡，差別在修正值。
- **怪物風格卡是完全獨立的資料結構** — 不在本模組管理，屬於 MOD-03 敵人設計器。
- **施法 `arcane` 的風格卡不觸發擲骰** — 改走混沌袋流程。此規則不影響風格卡本身的資料結構，但 UI 中需顯示提示。

## 1.3 預設資料（Seed Data）

建立資料表後，自動灌入以下 8 種戰鬥風格和 30 種專精的預設資料：

**戰鬥風格：**

| sort_order | code | name_zh | name_en |
|------------|------|---------|---------|
| 1 | `shooting` | 槍枝射擊 | Shooting |
| 2 | `archery` | 弓術 | Archery |
| 3 | `sidearm` | 隨身武器 | Sidearm |
| 4 | `military` | 軍用武器 | Military Weapons |
| 5 | `brawl` | 搏擊 | Brawl |
| 6 | `arcane` | 施法 | Arcane |
| 7 | `engineer` | 工兵 | Engineer |
| 8 | `assassin` | 暗殺 | Assassination |

**專精（30 種）：**

| 歸屬風格 | code | name_zh | name_en |
|----------|------|---------|---------|
| shooting | `shooting_rifle` | 步槍 | Rifle |
| shooting | `shooting_smg` | 衝鋒槍 | Submachine Gun |
| shooting | `shooting_dual` | 雙槍 | Dual Pistols |
| shooting | `shooting_pistol` | 手槍 | Pistol |
| archery | `archery_hunter` | 獵手 | Hunter |
| archery | `archery_rapid` | 連射 | Rapid Fire |
| archery | `archery_poison` | 毒箭 | Poison Arrow |
| archery | `archery_silent` | 無聲射手 | Silent Marksman |
| sidearm | `sidearm_dagger` | 匕首術 | Dagger Arts |
| sidearm | `sidearm_parry` | 護身格擋 | Parry Guard |
| sidearm | `sidearm_blunt` | 鈍擊 | Blunt Strike |
| sidearm | `sidearm_street` | 街頭格鬥 | Street Fighting |
| military | `military_twohanded` | 雙手武器 | Two-Handed |
| military | `military_defense` | 防禦架式 | Defensive Stance |
| military | `military_dual` | 雙持 | Dual Wield |
| military | `military_polearm` | 長柄武器 | Polearm |
| brawl | `brawl_tavern` | 酒館鬥毆者 | Tavern Brawler |
| brawl | `brawl_wrestler` | 摔角大師 | Wrestler |
| brawl | `brawl_karate` | 空手道 | Karate |
| arcane | `arcane_ritual` | 儀式 | Ritual |
| arcane | `arcane_incantation` | 咒語 | Incantation |
| arcane | `arcane_channeling` | 引導 | Channeling |
| arcane | `arcane_meditation` | 冥想 | Meditation |
| arcane | `arcane_alchemy` | 煉金 | Alchemy |
| engineer | `engineer_demolition` | 爆破 | Demolition |
| engineer | `engineer_trap` | 陷阱 | Trap |
| engineer | `engineer_mechanic` | 機械 | Mechanic |
| assassin | `assassin_execute` | 無聲處決 | Silent Execution |
| assassin | `assassin_ambush` | 伏擊戰術 | Ambush Tactics |
| assassin | `assassin_hidden` | 暗器 | Hidden Weapons |

> 專精的 `attribute`（對應主要屬性）和 `description` 欄位留空，由管理員在設計器中填入。
> `prof_bonus` 預設 1，`spec_bonus` 預設 2。

---

# 第二部分：後端 API

## 2.1 端點定義

```
# 戰鬥風格
GET    /api/combat-styles                — 取得所有風格（含下轄專精數量）
GET    /api/combat-styles/:id            — 取得單一風格（含專精列表 + 風格卡列表）
POST   /api/combat-styles                — 新增風格
PUT    /api/combat-styles/:id            — 更新風格
DELETE /api/combat-styles/:id            — 刪除風格（級聯刪除下轄專精與風格卡）

# 戰鬥專精
GET    /api/combat-styles/:styleId/specs — 取得某風格下所有專精
POST   /api/combat-styles/:styleId/specs — 新增專精
PUT    /api/specs/:id                    — 更新專精
DELETE /api/specs/:id                    — 刪除專精

# 調查員風格卡
GET    /api/combat-styles/:styleId/cards — 取得某風格下所有風格卡
POST   /api/combat-styles/:styleId/cards — 新增風格卡
PUT    /api/style-cards/:id              — 更新風格卡
DELETE /api/style-cards/:id              — 刪除風格卡

# 批次操作
POST   /api/combat-styles/:styleId/cards/generate — AI 批次生成風格卡（見第六部分）
GET    /api/combat-styles/export         — 匯出所有資料為 JSON
POST   /api/combat-styles/import         — 批次匯入（接受 JSON）

# 統計
GET    /api/combat-styles/stats          — 取得總覽統計（各風格的專精數、風格卡數）
```

## 2.2 回傳格式

與 MOD-01 一致：

```json
{
  "success": true,
  "data": { ... },
  "total": 8,
  "error": null
}
```

## 2.3 `GET /api/combat-styles/:id` 回傳範例

```json
{
  "success": true,
  "data": {
    "id": "uuid...",
    "code": "shooting",
    "name_zh": "槍枝射擊",
    "name_en": "Shooting",
    "description_zh": "以各類火器進行遠程攻擊...",
    "description_en": "Ranged attacks with firearms...",
    "spec_count": 4,
    "specializations": [
      {
        "id": "uuid...",
        "code": "shooting_rifle",
        "name_zh": "步槍",
        "name_en": "Rifle",
        "attribute": "agility",
        "prof_bonus": 1,
        "spec_bonus": 2,
        "description_zh": "...",
        "description_en": "..."
      }
    ],
    "style_cards": [
      {
        "id": "uuid...",
        "code": "shooting_card_01",
        "name_zh": "穩定瞄準",
        "name_en": "Steady Aim",
        "check_attribute": "agility",
        "narrative_attack_zh": "你舉起槍，沿著準星慢慢對準目標的頭部...",
        "narrative_success_zh": "子彈精準地命中目標，鮮血飛濺。",
        "narrative_fail_zh": "槍響了，但子彈擦過目標的肩膀，嵌入了身後的牆壁。"
      }
    ]
  }
}
```

---

# 第三部分：頁面結構

## 3.1 整體佈局

```
┌──────────────────────────────────────────────────────────────────┐
│  頂部導航列（返回首頁 + 頁面標題 MOD-05）                         │
├──────────────────────────────────────────────────────────────────┤
│  工具列：[匯出 JSON] [匯入 JSON] [設定 Gemini API Key]           │
├────────────────┬─────────────────────────────────────────────────┤
│                │                                                 │
│   風格列表     │              主內容區                            │
│  （左側面板）   │                                                 │
│                │   ┌─────────────────────────────────────────┐   │
│  ┌──────────┐  │   │  風格基本資訊（可編輯）                  │   │
│  │ 🔫 槍枝  │  │   │  code / 中英文名 / 說明                 │   │
│  │  射擊    │  │   ├─────────────────────────────────────────┤   │
│  │  4 專精  │  │   │                                         │   │
│  │  12 風格卡│  │   │  專精管理（表格）                       │   │
│  ├──────────┤  │   │  代碼 | 中文 | 英文 | 屬性 | 熟練 | 專精 │   │
│  │ 🏹 弓術  │  │   │  [+ 新增專精]                           │   │
│  │  4 專精  │  │   │                                         │   │
│  │  8 風格卡 │  │   ├─────────────────────────────────────────┤   │
│  ├──────────┤  │   │                                         │   │
│  │ 🗡 隨身  │  │   │  風格卡管理                              │   │
│  │  武器    │  │   │  ┌──────────┬───────────────────────┐   │   │
│  │  4 專精  │  │   │  │ 風格卡列表│  風格卡編輯+預覽       │   │   │
│  │  6 風格卡 │  │   │  │（小列表） │  （三段敘事+檢定屬性） │   │   │
│  ├──────────┤  │   │  └──────────┴───────────────────────┘   │   │
│  │ ...      │  │   │  [+ 新增風格卡] [AI 批次生成]           │   │
│  └──────────┘  │   └─────────────────────────────────────────┘   │
│                │                                                 │
│  [+ 新增風格]  │                                                 │
│  統計：8 風格   │                                                 │
│  30 專精       │                                                 │
│  72 風格卡     │                                                 │
└────────────────┴─────────────────────────────────────────────────┘
```

## 3.2 響應式調整

- 寬螢幕：兩欄佈局（左側風格列表 | 右側主內容區）
- 中螢幕：左側面板可收合，點擊展開
- 窄螢幕：單欄，風格列表和主內容區以標籤切換

---

# 第四部分：左側面板 — 風格列表

## 4.1 顯示內容

- 列出所有 8 種戰鬥風格
- 每個風格卡片顯示：
  - 風格名稱（中文）
  - 下轄專精數量
  - 下轄風格卡數量
- 選中的風格高亮（金色左側邊框）
- 底部統計：總風格數、總專精數、總風格卡數

## 4.2 交互

- 點擊風格 → 右側主內容區載入該風格的完整資料
- [+ 新增風格] 按鈕 → 右側清空表單進入新增模式
- 頁面載入時預設選中第一個風格（槍枝射擊）

---

# 第五部分：右側主內容區

主內容區分為三個垂直區塊，由上到下排列。

## 5.1 區塊一：風格基本資訊

可編輯的風格定義欄位：

| 欄位 | 類型 | 說明 | 驗證 |
|------|------|------|------|
| 代碼 (code) | 文字輸入（唯讀，Seed Data 預設） | 如 `shooting` | 必填，唯一 |
| 中文名稱 (name_zh) | 文字輸入 | 如「槍枝射擊」 | 必填 |
| 英文名稱 (name_en) | 文字輸入 | 如「Shooting」 | 必填 |
| 中文說明 (description_zh) | 文字區域 | 風格的設計說明與定位描述 | — |
| 英文說明 (description_en) | 文字區域 | | — |

- 在英文名稱和英文說明旁邊各放一個 **[生成英文]** 按鈕（呼叫 Gemini 翻譯，與 MOD-01 一致）
- 底部 [儲存風格] 按鈕
- 施法 `arcane` 風格旁顯示特殊提示：⚠️「施法類攻擊不擲骰，改走混沌袋流程」

## 5.2 區塊二：專精管理

以表格形式管理該風格下的所有專精。

### 表格欄位

| 欄位 | 類型 | 說明 | 驗證 |
|------|------|------|------|
| 代碼 (code) | 文字（唯讀，Seed Data 預設） | 如 `shooting_rifle` | 必填，唯一 |
| 中文名稱 (name_zh) | 行內編輯 | 如「步槍」 | 必填 |
| 英文名稱 (name_en) | 行內編輯 | 如「Rifle」 | 必填 |
| 對應屬性 (attribute) | 下拉選單 | 七大屬性之一 | 必填 |
| 熟練加成 (prof_bonus) | 數字（1–3） | 預設 1 | 1–3 |
| 專精加成 (spec_bonus) | 數字（2–5） | 預設 2 | 2–5 |
| 中文說明 (description_zh) | 展開編輯 | 點擊展開文字區域 | — |
| 英文說明 (description_en) | 展開編輯 | | — |
| 操作 | 按鈕 | [儲存] [刪除] | — |

### 表格功能

- 行內即時編輯（點擊欄位直接修改，類似 Excel）
- [+ 新增專精] 按鈕在表格底部
- 每行有 [儲存] 和 [刪除] 按鈕
- 刪除時彈出確認對話框

## 5.3 區塊三：風格卡管理

這是本模組的核心，也是文本量最大的部分。

### 5.3.1 風格卡列表（左側小列表）

- 列出當前風格下所有風格卡
- 每張顯示：名稱（中文）、檢定屬性標籤
- 點擊載入到右側編輯區
- 底部統計：此風格下的風格卡總數

### 5.3.2 風格卡編輯區（右側）

| 欄位 | 類型 | 說明 | 驗證 |
|------|------|------|------|
| 代碼 (code) | 自動生成 | 格式：`{style_code}_card_{流水號}`，如 `shooting_card_01` | 自動，唯一 |
| 中文名稱 (name_zh) | 文字輸入 | 風格卡的招式名稱，如「穩定瞄準」 | 必填 |
| 英文名稱 (name_en) | 文字輸入 + [生成英文] | | 必填 |
| 檢定屬性 (check_attribute) | 下拉選單 | 七大屬性之一 | 必填 |
| 攻擊敘事 — 中文 (narrative_attack_zh) | 文字區域（4 行） | 攻擊發動前的描述 | 必填 |
| 攻擊敘事 — 英文 (narrative_attack_en) | 文字區域（4 行） + [生成英文] | | — |
| 成功敘事 — 中文 (narrative_success_zh) | 文字區域（4 行） | 命中時的描述 | 必填 |
| 成功敘事 — 英文 (narrative_success_en) | 文字區域（4 行） + [生成英文] | | — |
| 失敗敘事 — 中文 (narrative_fail_zh) | 文字區域（4 行） | 未命中時的描述 | 必填 |
| 失敗敘事 — 英文 (narrative_fail_en) | 文字區域（4 行） + [生成英文] | | — |

- 底部按鈕：[儲存風格卡] [另存新卡] [刪除] [清空表單]
- 快捷鍵：`Ctrl + S` 儲存、`Ctrl + N` 新增、`Esc` 清空

### 5.3.3 風格卡即時預覽

在編輯區右側或下方，顯示風格卡的預覽排版：

```
┌─────────────────────────────────────┐
│  [檢定屬性標籤]     [歸屬風格標籤]   │
│                                     │
│         穩定瞄準                     │
│         Steady Aim                  │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  🎯 攻擊                            │
│  你舉起槍，沿著準星慢慢對準目標      │
│  的頭部...                          │
│                                     │
│  ✓ 成功                             │
│  子彈精準地命中目標，鮮血飛濺。      │
│                                     │
│  ✗ 失敗                             │
│  槍響了，但子彈擦過目標的肩膀，      │
│  嵌入了身後的牆壁。                  │
│                                     │
│  ─────────────────────────────────  │
│  ⚠ DC 來自目標怪物                  │
│  ⚠ 傷害來自武器卡                   │
└─────────────────────────────────────┘
```

預覽中的檢定屬性標籤使用對應顏色（與 admin-shared 中屬性色彩一致）。

---

# 第六部分：AI 風格卡生成（Gemini 2.5 Flash）

## 6.1 設定

與 MOD-01 一致 — Gemini API Key 存在 localStorage（key: `gemini_api_key`）。
本模組共用同一個 Key，不需要重複設定。
頁面載入時檢查是否已有 Key，有則工具列顯示綠色狀態。

## 6.2 兩種生成模式

### 模式 A：單張生成

在風格卡編輯區新增 AI 輔助：

```
┌─────────────────────────────────────────────────┐
│  AI 生成風格卡敘事                                │
│  ┌───────────────────────────────────────┐ [生成] │
│  │  輸入描述...                           │       │
│  │  例如：用步槍精準射擊的動作             │       │
│  └───────────────────────────────────────┘       │
│  快速風格：[寫實硬派] [黑色電影] [宇宙恐怖] [動作片]│
└─────────────────────────────────────────────────┘
```

- 使用者輸入描述或選擇風格快速模板
- 生成結果自動填入六個敘事文字欄位（中文三段 + 英文三段）
- 檢定屬性由 AI 根據描述建議，使用者可修改

### 模式 B：批次生成

在風格卡區塊頂部的 [AI 批次生成] 按鈕：

```
┌─────────────────────────────────────────────────┐
│  批次生成風格卡                                    │
│                                                   │
│  目標風格：[當前選中的風格]                         │
│  生成數量：[__] 張（建議 5–10）                     │
│  敘事風格：[寫實硬派 ▾]                             │
│  屬性分佈偏好：                                    │
│    ☐ 平均分佈七大屬性                              │
│    ☑ 偏重該風格的主要屬性（建議）                   │
│    ☐ 自訂（勾選要包含的屬性）                       │
│                                                   │
│  [生成] [取消]                                     │
└─────────────────────────────────────────────────┘
```

- 一次生成多張風格卡
- 生成後以列表展示，每張有 [採用] [棄用] [編輯後採用] 按鈕
- [採用] 直接存入資料庫，[編輯後採用] 進入編輯模式

## 6.3 Prompt 設計

### 單張生成 Prompt

```
你是一個克蘇魯神話卡牌遊戲的敘事設計師。請為戰鬥風格卡撰寫三段敘事文字。

## 遊戲背景
這是一款 1920–30 年代偵探黑色電影 × 宇宙恐怖風格的合作卡牌遊戲。
調查員使用各種武器與怪物戰鬥。每次攻擊時，系統抽出一張風格卡，
呈現一段敘事，並決定本次檢定使用的屬性。

## 戰鬥風格
當前風格：{style_name_zh}（{style_name_en}）
風格說明：{style_description_zh}

## 七大屬性
力量（Strength）、敏捷（Agility）、體質（Constitution）、
智力（Intellect）、意志（Willpower）、感知（Perception）、魅力（Charisma）

## 使用者描述
{user_input}

## 敘事風格
{narrative_style}

## 重要規則
- 風格卡不包含傷害數值和 DC — 這些來自武器和怪物
- 敘事應該是**通用的**，不指定具體武器名稱（調查員可能用不同武器）
- 攻擊敘事：描述攻擊動作的發動（懸念感，尚未知道結果）
- 成功敘事：描述命中的爽快感（要有畫面感）
- 失敗敘事：描述未命中的挫敗感（但不要太慘，保持尊嚴）
- 敘事長度：每段 2-4 句，不超過 80 字
- 風格基調：1920s 偵探黑色電影，克蘇魯宇宙恐怖

## 輸出格式
請回傳以下 JSON，不要回傳其他任何文字：
{
  "name_zh": "招式名稱（中文，2-4字）",
  "name_en": "Move Name (English)",
  "check_attribute": "屬性代碼（strength/agility/constitution/intellect/willpower/perception/charisma）",
  "narrative_attack_zh": "攻擊敘事中文",
  "narrative_attack_en": "Attack narrative in English",
  "narrative_success_zh": "成功敘事中文",
  "narrative_success_en": "Success narrative in English",
  "narrative_fail_zh": "失敗敘事中文",
  "narrative_fail_en": "Failure narrative in English"
}
```

### 批次生成 Prompt

在單張 Prompt 基礎上增加：

```
## 批次要求
請一次生成 {count} 張不重複的風格卡。
屬性分佈：{distribution_description}

每張風格卡的招式動作應該各不相同，展現該風格的多樣性。
避免重複的動詞和意象。

## 輸出格式
請回傳 JSON 陣列，不要回傳其他任何文字：
[
  { ... 第一張 ... },
  { ... 第二張 ... },
  ...
]
```

## 6.4 後處理

API 回傳後：
1. 解析 JSON 回應
2. 驗證 `check_attribute` 是否為合法的七大屬性代碼
3. 驗證所有必填文字欄位非空
4. 自動生成唯一代碼（`{style_code}_card_{流水號}`）
5. 單張模式：填入編輯表單
6. 批次模式：列表展示，等候使用者逐張採用

## 6.5 錯誤處理

與 MOD-01 一致：
- API Key 無效 → 提示使用者檢查 Key
- 網路錯誤 → 顯示重試按鈕
- JSON 解析失敗 → 顯示原始回應文字
- 屬性代碼無效 → 自動修正為最接近的合法值，並提示使用者

---

# 第七部分：表單互動邏輯

## 7.1 風格切換

- 點擊左側風格 → API 請求 `GET /api/combat-styles/:id`
- 載入回傳資料到三個區塊
- 風格卡列表刷新，自動選中第一張

## 7.2 專精表格

- 行內編輯：點擊欄位直接切換為輸入狀態
- 修改後欄位背景微亮（金色 glow），提示有未儲存變更
- 按 [儲存] 呼叫 `PUT /api/specs/:id`
- 按 [刪除] 彈出確認後呼叫 `DELETE /api/specs/:id`

## 7.3 風格卡編輯

- 編輯任一欄位時即時更新右側預覽
- [儲存] 呼叫 `PUT /api/style-cards/:id`（編輯模式）或 `POST /api/combat-styles/:styleId/cards`（新增模式）
- [另存新卡] → 複製當前欄位內容，清除 id，進入新增模式
- [清空] → 清空所有欄位，進入新增模式
- 未儲存狀態下切換風格卡 → 提示「有未儲存的變更，是否放棄？」

## 7.4 屬性顯示

所有屬性相關的顯示使用統一的顏色標籤：

| 屬性 | 顏色 | 縮寫 |
|------|------|------|
| 力量 | #B84C4C（紅） | STR |
| 敏捷 | #2D8B6F（綠） | AGI |
| 體質 | #C9A84C（金） | CON |
| 智力 | #4A7C9B（藍） | INT |
| 意志 | #7B4EA3（紫） | WIL |
| 感知 | #8B5E3C（棕） | PER |
| 魅力 | #B84C4C（粉紅，與力量區分用飽和度） | CHA |

> 如果 admin-shared.js 中已有屬性顏色定義，使用既有的。如果沒有，新增上述定義。

---

# 第八部分：數據驗證規則

## 8.1 風格卡屬性分佈檢查

在風格卡列表區塊底部，顯示當前風格的屬性分佈統計：

```
屬性分佈：
力量 ████████░░ 4 張（27%）
敏捷 ██████████████ 7 張（47%）
意志 ████░░░░░░ 2 張（13%）
感知 ████░░░░░░ 2 張（13%）
```

- 以水平條形圖顯示
- 如果某屬性佔比超過 60%，顯示黃色警告「屬性分佈偏重」
- 如果某屬性佔比為 0%，顯示提示「此屬性尚無風格卡」

## 8.2 風格卡最低數量提示

- 每種風格建議至少 8 張風格卡（確保足夠的隨機性）
- 少於 8 張時在列表底部顯示提示：「建議至少 8 張風格卡以確保隨機性」
- 少於 3 張時顯示紅色警告：「風格卡數量過少，遊戲體驗可能單調」

---

# 第九部分：參考常數

所有常數從 `admin-shared.js` 引用。如果以下常數不存在，需要新增：

```javascript
// 戰鬥風格（若不存在則新增）
const COMBAT_STYLES = {
  shooting:  { code: 'shooting',  zh: '槍枝射擊', en: 'Shooting' },
  archery:   { code: 'archery',   zh: '弓術',     en: 'Archery' },
  sidearm:   { code: 'sidearm',   zh: '隨身武器', en: 'Sidearm' },
  military:  { code: 'military',  zh: '軍用武器', en: 'Military Weapons' },
  brawl:     { code: 'brawl',     zh: '搏擊',     en: 'Brawl' },
  arcane:    { code: 'arcane',    zh: '施法',     en: 'Arcane' },
  engineer:  { code: 'engineer',  zh: '工兵',     en: 'Engineer' },
  assassin:  { code: 'assassin',  zh: '暗殺',     en: 'Assassination' },
};

// 屬性顏色（若不存在則新增）
const ATTRIBUTE_COLORS = {
  strength:     '#B84C4C',
  agility:      '#2D8B6F',
  constitution: '#C9A84C',
  intellect:    '#4A7C9B',
  willpower:    '#7B4EA3',
  perception:   '#8B5E3C',
  charisma:     '#D4728C',
};

// 敘事風格預設（用於 AI 生成）
const NARRATIVE_STYLES = {
  noir:     { zh: '寫實硬派', en: 'Hard-boiled Noir',      desc: '1920s 偵探黑色電影，冷硬、簡潔、不動聲色' },
  horror:   { zh: '宇宙恐怖', en: 'Cosmic Horror',         desc: '洛夫克拉夫特式恐怖，強調渺小與未知' },
  action:   { zh: '動作片',   en: 'Pulp Action',           desc: '快節奏、誇張、充滿張力的動作描寫' },
  literary: { zh: '文學風',   en: 'Literary',              desc: '優雅內斂的文學敘事，注重心理描寫' },
};
```

---

# 第十部分：完成後

1. 執行 Seed Data 腳本，灌入 8 種風格 + 30 種專精的預設資料
2. 測試所有 CRUD 操作
3. 測試 Gemini AI 生成（單張 + 批次）
4. 確認屬性分佈統計功能正常
5. 確認響應式佈局在不同螢幕尺寸下正常運作
6. Git commit：`feat: implement combat style & specialization manager (MOD-05) — full CRUD with PostgreSQL, style card management, and Gemini AI generation`
7. 更新 index.html 中 MOD-05 的狀態標籤從 `PLANNED` 改為 `READY`
8. Push 到 GitHub

---

# 附錄：相關文件

- 《規則書 v1.0 第二章》§8 — 戰鬥風格卡系統（調查員風格卡結構、怪物風格卡結構、武器修正與風格卡關係）
- 《規則書 v1.0 第六章》§10 — 戰鬥熟練與專精完整代碼表（8 風格 + 30 專精）
- 《規則書 v1.0 第六章》§4 — 三層修正值疊加（熟練/專精在成長曲線中的定位）
- 《資料庫結構設計 v0.1》§3.5 — proficiency_definitions 原始結構（本模組擴充為三張表）
- 《規則書 v1.0 第一章》§7.6 — 七大屬性定義
