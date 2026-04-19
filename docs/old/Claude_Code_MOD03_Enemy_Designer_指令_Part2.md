# Claude Code 指令：敵人設計器 MOD-03（Part 2/3）
## Enemy Designer Instructions — API + 頁面佈局 + 編輯邏輯

> **本文件為 Part 2/3。**
> Part 1 涵蓋：資料庫結構 + 全部 Seed Data。
> **Part 2 涵蓋：後端 API + 頁面佈局 + 怪物種族編輯 + 位階變體編輯邏輯。**
> Part 3 涵蓋：招式池管理 + AI 行為配置 + Gemini 生成 + 家族總覽面板。

---

# 第四部分：後端 API

在 `packages/server/src/routes/` 新增以下端點。
所有端點前綴：`/api/admin/monsters`

## 4.1 怪物家族 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| GET | `/families` | 列出所有家族（含種族數量統計） |
| GET | `/families/:id` | 取得單一家族完整資料 |
| PUT | `/families/:id` | 更新家族資料 |

> 家族不提供 POST/DELETE — 家族列表由 Seed Data 固定，管理員只能編輯不能新增/刪除。

### GET /families 回傳格式

```json
{
  "families": [
    {
      "id": "uuid",
      "code": "house_cthulhu",
      "name_zh": "克蘇魯眷族",
      "name_en": "House of Cthulhu",
      "family_type": "deity",
      "is_active": true,
      "sort_order": 1,
      "design_status": "approved",
      "species_count": 5,
      "variant_count": 12,
      "attack_card_count": 36
    }
  ]
}
```

## 4.2 怪物種族 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| GET | `/species` | 列出所有種族（可按家族篩選） |
| GET | `/species/:id` | 取得單一種族完整資料（含所有變體摘要） |
| POST | `/species` | 新增種族 |
| PUT | `/species/:id` | 更新種族 |
| DELETE | `/species/:id` | 刪除種族（連同所有變體、招式卡、敘事描述） |

### GET /species 查詢參數

| 參數 | 類型 | 說明 |
|------|------|------|
| `family_id` | UUID | 按家族篩選 |
| `family_code` | string | 按家族代碼篩選（二擇一） |
| `design_status` | string | 按設計狀態篩選 |
| `tier_min` | integer | 最低位階篩選 |
| `tier_max` | integer | 最高位階篩選 |

### GET /species/:id 回傳格式

```json
{
  "species": {
    "id": "uuid",
    "family_id": "uuid",
    "family_code": "house_cthulhu",
    "family_name_zh": "克蘇魯眷族",
    "code": "deep_one",
    "name_zh": "深潛者",
    "name_en": "Deep One",
    "description_zh": "...",
    "tier_min": 1,
    "tier_max": 3,
    "base_keywords": [],
    "base_attack_element": "physical",
    "base_ai_preference": null,
    "base_weaknesses": null,
    "base_resistances": null,
    "base_immunities": null,
    "base_status_immunities": null,
    "defense_attribute_tendency": null,
    "design_notes": null,
    "design_status": "draft",
    "variants": [
      {
        "id": "uuid",
        "code": "deep_one_minion",
        "name_zh": "深潛者（雜兵）",
        "tier": 1,
        "dc": 12,
        "hp_base": 4,
        "design_status": "draft",
        "attack_card_count": 3
      }
    ],
    "shared_attack_cards": [
      {
        "id": "uuid",
        "code": "deep_one_claw_strike",
        "name_zh": "利爪撕裂",
        "defense_attribute": "agility",
        "damage_physical": 2
      }
    ]
  }
}
```

## 4.3 位階變體 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| GET | `/variants` | 列出所有變體（可按種族/家族/位階篩選） |
| GET | `/variants/:id` | 取得單一變體完整資料（含招式卡、敘事描述） |
| POST | `/variants` | 新增變體（自動帶入位階建議數值） |
| PUT | `/variants/:id` | 更新變體 |
| DELETE | `/variants/:id` | 刪除變體（連同招式卡、敘事描述） |
| POST | `/variants/:id/duplicate` | 複製變體（快速建立同種族不同位階） |

### GET /variants 查詢參數

| 參數 | 類型 | 說明 |
|------|------|------|
| `species_id` | UUID | 按種族篩選 |
| `family_id` | UUID | 按家族篩選 |
| `family_code` | string | 按家族代碼篩選 |
| `tier` | integer | 按位階篩選 |
| `design_status` | string | 按設計狀態篩選 |

### POST /variants 請求格式

```json
{
  "species_id": "uuid",
  "code": "deep_one_elite",
  "name_zh": "深潛者精英",
  "name_en": "Deep One Elite",
  "tier": 3
}
```

後端收到 `tier` 後，自動帶入該位階的建議數值範圍中間值：
- tier 1 → dc:12, hp_base:4, damage_physical:1, spell_defense:0, attacks_per_round:1
- tier 2 → dc:16, hp_base:11, damage_physical:3, spell_defense:2, attacks_per_round:1
- tier 3 → dc:20, hp_base:23, damage_physical:4, spell_defense:4, attacks_per_round:1
- tier 4 → dc:24, hp_base:42, damage_physical:6, spell_defense:6, attacks_per_round:2
- tier 5 → dc:28, hp_base:62, damage_physical:8, spell_defense:8, attacks_per_round:2

同時自動生成 5 階段預設敘事描述（見 Part 1 §2.3）。

### POST /variants/:id/duplicate

複製一個變體的所有數值、詞綴、AI 設定、招式卡、敘事描述，
code 和 name 自動加後綴 `_copy`，tier 保持不變。
用途：設計師想從「深潛者（雜兵）」快速衍生出「深潛者（威脅）」時，
先複製再修改位階和數值。

### GET /variants/:id 回傳格式

```json
{
  "variant": {
    "id": "uuid",
    "species_id": "uuid",
    "species_code": "deep_one",
    "species_name_zh": "深潛者",
    "family_code": "house_cthulhu",
    "family_name_zh": "克蘇魯眷族",
    "code": "deep_one_elite",
    "name_zh": "深潛者精英",
    "tier": 3,
    "dc": 20,
    "hp_base": 22,
    "hp_per_player": 2,
    "damage_physical": 5,
    "damage_horror": 1,
    "regen_per_round": 0,
    "spell_defense": 4,
    "attacks_per_round": 1,
    "fear_radius": 1,
    "fear_value": 3,
    "fear_type": "first_sight",
    "movement_speed": 1,
    "movement_type": "ground",
    "keywords": ["massive", "crush"],
    "attack_element": null,
    "weaknesses": null,
    "resistances": null,
    "immunities": null,
    "resistance_values": {},
    "inflicted_statuses": null,
    "self_buffs": null,
    "status_immunities": null,
    "ai_preference": null,
    "ai_preference_param": null,
    "is_undefeatable": false,
    "phase_count": 1,
    "phase_rules": [],
    "legendary_actions": [],
    "environment_effects": [],

    "resolved": {
      "attack_element": "physical",
      "weaknesses": ["fire", "electric"],
      "resistances": ["ice"],
      "immunities": [],
      "status_immunities": ["frozen", "wet"],
      "ai_preference": "nearest",
      "inflicted_statuses": [{"code":"wet","frequency":"high"}],
      "self_buffs": [{"code":"armor","frequency":"high"}]
    },

    "attack_cards": [],
    "status_descriptions": [
      { "hp_threshold": 100, "description_zh": "牠看起來毫髮無傷。" },
      { "hp_threshold": 75,  "description_zh": "牠似乎受了一些傷，但行動不受影響。" },
      { "hp_threshold": 50,  "description_zh": "牠的動作開始遲緩，傷口清晰可見。" },
      { "hp_threshold": 25,  "description_zh": "牠拖著殘破的身軀，每一步都在顫抖。" },
      { "hp_threshold": 0,   "description_zh": "牠轟然倒下，不再動彈。" }
    ]
  }
}
```

> **`resolved` 欄位很重要**：後端自動計算繼承鏈解析後的實際值，
> 前端用 `resolved` 顯示有效值，用原始欄位判斷是否為覆寫。

### 後端驗證規則

1. **神秘抗性禁止**：`immunities` 和 `resistances` 中出現 `arcane` → 回傳 400 錯誤
2. **位階範圍限制**：變體的 `tier` 必須在種族的 `tier_min` 到 `tier_max` 範圍內
3. **Code 唯一性**：所有 code 全域唯一
4. **巨頭必須不可擊敗**：tier = 5 且 `is_undefeatable` = false 時顯示警告（非錯誤）

## 4.4 招式卡 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| GET | `/attack-cards` | 列出招式卡（按種族或變體篩選） |
| GET | `/attack-cards/:id` | 取得單一招式卡 |
| POST | `/attack-cards` | 新增招式卡 |
| PUT | `/attack-cards/:id` | 更新招式卡 |
| DELETE | `/attack-cards/:id` | 刪除招式卡 |
| POST | `/attack-cards/batch` | 批次新增（AI 生成用） |

### GET /attack-cards 查詢參數

| 參數 | 類型 | 說明 |
|------|------|------|
| `variant_id` | UUID | 按變體篩選（含種族級共享） |
| `species_id` | UUID | 按種族篩選（只含種族級共享） |

> 當按 `variant_id` 查詢時，回傳該變體的專屬招式 + 所屬種族的共享招式。

## 4.5 敘事狀態描述 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| PUT | `/variants/:id/status-descriptions` | 批次更新（整組覆寫） |

一次提交 5 階段的完整敘事，後端整組替換。

## 4.6 統計 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| GET | `/stats/overview` | 全域統計（各家族種族數/變體數/招式卡數） |
| GET | `/stats/family/:code` | 單一家族統計（位階分佈、詞綴使用統計、屬性覆蓋） |
| GET | `/stats/tier-distribution` | 全域位階分佈 |

### GET /stats/overview 回傳格式

```json
{
  "total_families": 10,
  "total_species": 32,
  "total_variants": 0,
  "total_attack_cards": 0,
  "families": [
    {
      "code": "house_cthulhu",
      "name_zh": "克蘇魯眷族",
      "species_count": 5,
      "variant_count": 0,
      "attack_card_count": 0,
      "design_progress": "0%"
    }
  ],
  "tier_distribution": {
    "1": 0, "2": 0, "3": 0, "4": 0, "5": 0
  }
}
```

---

# 第五部分：頁面佈局

## 5.1 整體佈局結構

```
┌──────────────────────────────────────────────────────────────┐
│  頂部導航列（← 返回首頁 | 敵人設計器 | MOD-03）              │
├────────────┬─────────────────────────────────────────────────┤
│            │                                                 │
│  左側面板   │  右側主區域                                      │
│  (280px)   │                                                 │
│            │  ┌─────────────────────────────────────────────┐│
│  家族選擇   │  │ 🐙 怪物編輯  |  📊 家族總覽                 ││
│  (10 個)   │  ├─────────────────────────────────────────────┤│
│            │  │                                             ││
│  ────────  │  │  （依標籤頁切換內容）                         ││
│            │  │                                             ││
│  種族列表   │  │                                             ││
│  (按家族   │  │                                             ││
│   篩選)    │  │                                             ││
│            │  │                                             ││
│  ────────  │  │                                             ││
│            │  │                                             ││
│  變體列表   │  └─────────────────────────────────────────────┘│
│  (按種族   │                                                 │
│   篩選)    │                                                 │
│            │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

## 5.2 左側面板

### 家族選擇區

- 顯示 10 個啟用家族（`is_active = true`）的按鈕列表
- 每個按鈕顯示：家族圖示（emoji）+ 中文名 + 種族數/變體數統計
- 按鈕右側顯示小型進度指示（已設計變體數 / 預估總數）
- 選中的家族以金色邊框 `--border-hover` 高亮

```
家族 emoji 對應：
house_cthulhu      → 🐙
house_hastur       → 👁
house_shub         → 🐐
house_nyarlathotep → 🎭
house_yog          → 🌀
house_cthugha      → 🔥
house_yig          → 🐍
fallen             → 🕯
undying            → 💀
independent        → ⚡
```

### 種族列表區

- 顯示所選家族下的所有種族
- 每個種族卡片顯示：中文名、英文名、位階範圍（e.g. ⚔ 雜兵–精英）、變體數量
- 底部「+ 新增種族」按鈕

### 變體列表區

- 顯示所選種族下的所有位階變體
- 每個變體卡片顯示：中文名、位階標籤（帶顏色）、DC、HP、設計狀態
- 底部「+ 新增變體」按鈕
- 位階標籤顏色：

```
雜兵: #5A5A52（灰色，--text-tertiary）
威脅: #4A7C9B（冷鋼藍，--info）
精英: #C9A84C（金色，--gold）
頭目: #B84C4C（紅色，--danger）
巨頭: #7B4EA3（紫色，--oracle）
```

### 左側面板互動邏輯

1. 進入頁面 → 載入所有家族 + 統計數據
2. 點擊家族 → 載入該家族的種族列表 → 清空變體列表 → 清空右側編輯區
3. 點擊種族 → 載入該種族的變體列表 → 右側顯示種族編輯
4. 點擊變體 → 右側顯示變體編輯
5. 不選擇任何項目時 → 右側顯示歡迎提示或家族統計摘要

## 5.3 右側主區域 — 雙標籤頁

### 標籤頁一：🐙 怪物編輯

此標籤頁的內容依左側選擇而定：

- **選擇了家族，未選種族** → 顯示家族基本資訊卡（唯讀摘要）
- **選擇了種族，未選變體** → 顯示種族編輯區
- **選擇了變體** → 顯示變體編輯區（主要工作區域）

### 標籤頁二：📊 家族總覽

不管左側選擇什麼都能切換到此標籤頁，內容見 Part 3。

---

# 第六部分：種族編輯區

## 6.1 種族基本資訊卡

一張卡片內包含以下欄位：

| 欄位 | 類型 | 說明 |
|------|------|------|
| 代碼 (code) | 文字輸入 | `snake_case`，建立後不可改 |
| 中文名 (name_zh) | 文字輸入 | |
| 英文名 (name_en) | 文字輸入 | |
| 歸屬家族 | 下拉選單 | 列出所有啟用家族（建立後不可改） |
| 種族描述 (description_zh) | 文字區域 | |
| 神話學背景 (lore_zh) | 文字區域 | |
| 設計備註 (design_notes) | 文字區域 | |
| 設計狀態 | 下拉選單 | draft / review / approved |

## 6.2 種族預設值卡

一張卡片，標題「種族預設值（變體繼承）」：

| 欄位 | 類型 | 說明 |
|------|------|------|
| 位階範圍 | 雙滑桿或雙下拉 | tier_min 到 tier_max（1–5） |
| 基礎攻擊元素 | 下拉選單 | 5 種元素 + 「使用家族預設」選項 |
| 基礎 AI 偏好 | 下拉選單 | 7 種偏好 + 「使用家族預設」選項 |
| 基礎詞綴 | 多選標籤 | 從 MONSTER_KEYWORDS 中多選 |
| 元素弱點 | 多選標籤 | 從 ATTACK_ELEMENTS 中多選（不含 arcane） + 「使用家族預設」 |
| 元素抗性 | 多選標籤 | 同上（不含 arcane） |
| 元素免疫 | 多選標籤 | 同上（不含 arcane） |
| 狀態免疫 | 多選標籤 | 從 NEGATIVE_STATUSES 中多選 + 「使用家族預設」 |
| 防禦屬性傾向 | 7 個屬性各有下拉：high/medium/low/none | + 「使用家族預設」 |

> 「使用家族預設」= 存為 NULL，顯示時用淡色標示家族的預設值。

## 6.3 種族下轄變體列表

種族編輯區底部顯示此種族的所有變體，以表格或卡片網格呈現：

| 變體名稱 | 位階 | DC | HP | 傷害 | 招式卡數 | 設計狀態 | 操作 |
|---------|------|-----|-----|------|---------|---------|------|
| 深潛者（雜兵）| ⚔ 雜兵 | 12 | 4 | 2 | 3 | draft | 編輯 / 複製 / 刪除 |

- 「+ 新增變體」按鈕 → 彈出小對話框：輸入代碼/中文名/英文名 + 選擇位階 → 建立
- 「複製」→ 呼叫 `/variants/:id/duplicate` API

---

# 第七部分：位階變體編輯區

位階變體是管理員的**主要工作區域**。選擇一個變體後，右側顯示以下四個編輯區塊：

## 7.1 區塊一：基本資訊

一張卡片：

| 欄位 | 類型 | 說明 |
|------|------|------|
| 代碼 (code) | 文字輸入 | 建立後不可改 |
| 中文名 (name_zh) | 文字輸入 | |
| 英文名 (name_en) | 文字輸入 | |
| 歸屬種族 | 唯讀顯示 | 種族中文名 + 家族中文名 |
| 位階 | 下拉選單 | 1–5（受種族 tier_min/tier_max 限制） |
| 不可擊敗 | 開關 | 巨頭劇情怪用 |
| 描述 (description_zh) | 文字區域 | |
| 設計狀態 | 下拉選單 | draft / review / approved |

## 7.2 區塊二：核心數值面板

這是設計師最常操作的區塊。以**數值卡片網格**呈現，每個數值一個小卡片。

### 戰鬥數值（2×4 網格）

```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ DC       │ │ HP       │ │ HP/人    │ │ 法術防禦  │
│   [20]   │ │   [22]   │ │   [2]    │ │   [4]    │
│ 建議: 20 │ │ 18–28   │ │          │ │ 3–5     │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ 物理傷害  │ │ 恐懼傷害  │ │ 每回合回血│ │ 攻擊次數  │
│   [5]    │ │   [1]    │ │   [0]    │ │   [1]    │
│ 3–6     │ │          │ │ 0–1     │ │ 1       │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
```

- 每個數值卡片包含：標籤、數字輸入框、下方灰字提示建議範圍
- 建議範圍根據位階自動更新（切換位階時重新帶入）
- 數值超出建議範圍時，邊框變為警告色 `--warning` 但不阻止儲存

### 恐懼系統（1×3 網格 + 下拉）

```
┌──────────┐ ┌──────────┐ ┌────────────────┐
│ 恐懼半徑  │ │ 恐懼值   │ │ 恐懼觸發類型    │
│   [1]    │ │   [3]    │ │ [初見 ▼]       │
│ 家族: 1–2│ │ 家族: 2–4│ │                │
└──────────┘ └──────────┘ └────────────────┘
```

### 移動（1×2 網格 + 下拉）

```
┌──────────┐ ┌────────────────┐
│ 移動速度  │ │ 移動類型        │
│   [1]    │ │ [地面 ▼]       │
└──────────┘ └────────────────┘
```

## 7.3 區塊三：詞綴與狀態配置

### 詞綴配置

以分類標籤群組呈現：

**移動類：** `[ ] 快速` `[ ] 飛行`

**交戰類：** `[ ] 獵手` `[ ] 巨大` `[ ] 冷漠`

**死亡效果類：** `[ ] 壓垮` `[ ] 詛咒` `[ ] 鬧鬼`

**防禦類：** `[ ] 物理抗性 [___]` `[ ] 物理免疫` `[ ] 火抗性 [___]` `[ ] 冰抗性 [___]` `[ ] 雷抗性 [___]`
（勾選抗性時旁邊出現數字輸入框，填入減免點數）

**特殊類：** `[ ] 群體 [___]`（分身數量）

- 從種族繼承的詞綴用淡色底色標示，可取消
- 變體新增的詞綴用正常底色
- **不提供 `arcane_resistance` 或 `arcane_immunity` 選項**

### 元素弱點/抗性/免疫

三行多選標籤：

```
弱點：[物理] [火] [冰] [雷]       ← 4 個選項（不含神秘）
抗性：[物理] [火] [冰] [雷]       ← 4 個選項（不含神秘）
免疫：[物理] [火] [冰] [雷]       ← 4 個選項（不含神秘）
```

- 繼承值用淡色標示 + 「繼承自種族/家族」tooltip
- 覆寫時清除繼承標示

### 負面狀態施放

可編輯列表，每行：

```
[狀態下拉 ▼] [頻率下拉 ▼] [備註文字_______________] [🗑]
```

頻率選項：`very_high` / `high` / `medium` / `low`

底部「+ 新增狀態」按鈕。

繼承自種族/家族的狀態用淡色底色，「繼承」標籤。

### 正面狀態（怪物自身）

同上格式。

### 狀態免疫

多選標籤，從 NEGATIVE_STATUSES 中選取。

## 7.4 區塊四：AI 行為配置

一張卡片：

| 欄位 | 類型 | 說明 |
|------|------|------|
| AI 偏好 | 下拉選單 | 7 種 + 「使用種族/家族預設」 |
| 偏好參數 | 文字輸入 | 僅 `lowest_attr` 時顯示，選擇哪個屬性 |
| AI 行為補充說明 | 文字區域 | 自由文字 |

下方顯示已解析的有效 AI 偏好（`resolved` 值），標明來源：

```
✦ 有效偏好：最近 (nearest)  — 來源：家族預設
```

## 7.5 區塊五：頭目/巨頭專屬

僅當位階 ≥ 4 時顯示此區塊。

### 多階段戰鬥

| 欄位 | 類型 | 說明 |
|------|------|------|
| 階段數 | 數字輸入 | 預設 1，頭目通常 2–3 |

階段數 > 1 時展開可編輯列表：

```
第 2 階段
  觸發條件：[HP 低於 ▼] [50] %
  效果描述：[________________________]
  
第 3 階段
  觸發條件：[HP 低於 ▼] [25] %
  效果描述：[________________________]
```

### 傳奇行動

可編輯列表：

```
[行動名稱___] [觸發時機 ▼] [效果描述_______________] [🗑]
```

觸發時機選項：`round_start` / `round_end` / `on_hit` / `on_investigator_move` / `custom`

### 環境改變效果

可編輯列表：

```
[觸發時機 ▼] [效果描述_______________] [🗑]
```

觸發時機選項：`on_spawn` / `phase_change` / `on_death` / `per_round` / `custom`

## 7.6 區塊六：敘事狀態描述

顯示 5 階段的敘事文字編輯：

```
┌─────────────────────────────────────────────────┐
│ 敘事狀態描述                                      │
├─────────────────────────────────────────────────┤
│ 100% — 完好                                      │
│ [牠看起來毫髮無傷。_________________________]      │
│                                                   │
│ 75% — 輕傷                                       │
│ [牠似乎受了一些傷，但行動不受影響。_________]        │
│                                                   │
│ 50% — 重傷                                       │
│ [牠的動作開始遲緩，傷口清晰可見。___________]        │
│                                                   │
│ 25% — 瀕死                                       │
│ [牠拖著殘破的身軀，每一步都在顫抖。_________]        │
│                                                   │
│ 0% — 死亡                                        │
│ [牠轟然倒下，不再動彈。_____________________]       │
├─────────────────────────────────────────────────┤
│ [🤖 AI 生成全部敘事]                               │
└─────────────────────────────────────────────────┘
```

- 新建變體時自動帶入預設文字
- 「AI 生成」按鈕呼叫 Gemini 根據怪物名稱/種族/家族生成風味文字（見 Part 3）

## 7.7 儲存邏輯

- 所有編輯區塊共用同一個「儲存」按鈕（固定在右下角浮動）
- 有未儲存變更時按鈕亮起金色光暈
- 儲存時一次送出所有欄位（PUT /variants/:id）
- 敘事描述單獨送出（PUT /variants/:id/status-descriptions）
- 儲存成功後左側面板同步更新統計數據

---

> **Part 2 結束。**
> Part 3 將涵蓋：招式池管理 + AI 行為配置 + Gemini AI 生成 + 家族總覽面板。
