# Claude Code 指令：卡片設計器 MOD-01
## Card Designer Module Instructions

> **給 Claude Code：** 請建立卡片設計器，包含前後端兩部分：
> 1. **後端 API**：在 `packages/server/src/routes/` 新增卡片 CRUD 端點
> 2. **前端頁面**：在 `packages/client/public/admin/admin-card-designer.html` 建立介面
> 
> 資料存入 PostgreSQL 的 `card_definitions` 和 `card_effects` 表（Schema 見 `docs/資料庫結構設計_v0.1.md`）。
> 所有裝置打開同一個網址就能存取同一份資料，不需要匯出匯入。
> 
> **視覺原則：** 功能優先，不需要精美設計。樸素、清楚、所有欄位和數字一目了然即可。
> 但仍須遵守 admin-shared.css 的暗黑哥德色彩系統（深色背景、金色強調色）。

---

## 一、頁面結構

頁面分為三個主要區域：

```
┌──────────────────────────────────────────────────────┐
│  頂部導航列（返回首頁 + 頁面標題 MOD-01）             │
├──────────────────────────────────────────────────────┤
│  工具列：[+ 新增卡片] [搜尋] [篩選：陣營/風格/類別]   │
├──────────────┬───────────────────────────────────────┤
│              │                                       │
│   卡片列表   │         編輯表單 + 即時預覽            │
│  （左側面板） │        （右側主內容區）                │
│              │                                       │
│  · 搜尋結果  │  ┌─────────────┬──────────────┐       │
│  · 點擊載入  │  │  編輯表單    │  即時預覽     │       │
│              │  │  （所有欄位） │ （卡面排版）  │       │
│              │  └─────────────┴──────────────┘       │
└──────────────┴───────────────────────────────────────┘
```

---

## 二、左側面板：卡片列表

- 顯示所有已建立的卡片（從後端 API 讀取）
- 每張卡片顯示：名稱、代碼、陣營極標籤、類別標籤
- 支援搜尋（按名稱中英文、代碼）
- 支援篩選：
  - 陣營極：E / I / S / N / T / F / J / P / 中立 / 全部
  - 卡片風格：A+H / A+C / O+H / O+C / 全部
  - 卡片類別：資產 / 事件 / 盟友 / 技能 / 弱點 / 神啟卡 / 簽名卡 / 全部
- 點擊卡片 → 右側載入該卡片的資料進入編輯模式
- 底部顯示卡片總數統計

---

## 三、右側主區域：編輯表單

### 3.1 身份資訊區

| 欄位 | 類型 | 說明 | 驗證 |
|------|------|------|------|
| 代碼 (code) | 文字輸入 | 唯一識別碼，如 `core_45_automatic` | 必填，唯一，僅允許小寫英文+底線+數字 |
| 中文名稱 (name_zh) | 文字輸入 | 如「.45 自動手槍」 | 必填 |
| 英文名稱 (name_en) | 文字輸入 | 如「.45 Automatic」 | 必填 |
| 陣營極 (faction) | 下拉選單 | E/I/S/N/T/F/J/P/中立 — 使用 admin-shared.js 的 FACTIONS 常數 | 必填 |
| 卡片風格 (style) | 下拉選單 | A+H / A+C / O+H / O+C — 使用 CARD_STYLES 常數 | 必填 |
| 卡片類別 (type) | 下拉選單 | 資產 / 事件 / 盟友 / 技能 / 弱點 / 神啟卡 / 簽名卡 — 使用 CARD_TYPES 常數（需擴充弱點/神啟/簽名） | 必填 |
| 裝備欄位 (slot) | 下拉選單 | 手持 / 身體 / 配件 / 神秘 / 盟友 / 無 | 資產和盟友必填 |
| 獨特卡 (is_unique) | 勾選框 | 場上只能存在一張 | — |
| 等級 (level) | 數字 | 卡片等級（升級路徑用） | 預設 0 |

### 3.2 數值資訊區

| 欄位 | 類型 | 說明 | 驗證 |
|------|------|------|------|
| 費用 (cost) | 數字（0–6） | 打出所需資源 | 0–6，使用 GAME_RULES 的 CARD_COST_MIN/MAX |
| 費用貨幣 (cost_currency) | 下拉選單 | 資源 / 禁忌洞察 / 信仰 等（暫時只放「資源」，待陣營貨幣確認） | 預設「資源」 |
| 檢定加值 (skill_value) | 數字（0–5） | 當作手牌加值使用時的固定修正 | 0–5 |
| 傷害 (damage) | 數字（0–10） | 造成的固定傷害 | — |
| 恐懼傷害 (horror) | 數字（0–10） | 造成的恐懼（SAN）傷害 | — |
| 治療 HP (health_boost) | 數字（0–10） | 恢復的 HP | — |
| 治療 SAN (sanity_boost) | 數字（0–10） | 恢復的 SAN | — |
| 武器階層 (weapon_tier) | 下拉選單 | 隨身/基礎/標準/進階/稀有/傳奇/無 — 使用 WEAPON_TIERS 常數 | 武器卡必填 |
| 彈藥 (ammo) | 數字 | 子彈數量 | 武器卡適用 |
| 使用次數 (uses) | 數字 | 可使用次數（如法術 3 次） | 非武器的消耗型適用 |
| 消耗品 (is_consumable) | 勾選框 | 用完後移除出遊戲（而非進棄牌堆） | — |
| 檢定屬性 (check_attribute) | 下拉選單 | 力量/敏捷/體質/智力/意志/感知/魅力/無 — 使用 ATTRIBUTES 常數 | — |
| 檢定修正 (check_modifier) | 數字（-3 到 +5） | 裝備提供的檢定加成 | — |
| 檢定方式 (check_method) | 下拉選單 | 擲骰 / 混沌袋 | 預設「擲骰」 |
| 手牌上限修改 (hand_limit_mod) | 數字（-3 到 0） | 裝備此卡時對手牌上限的影響 | — |

### 3.3 效果資訊區

效果是一個可新增多筆的列表，每筆效果包含：

| 欄位 | 類型 | 說明 |
|------|------|------|
| 觸發時機 (trigger) | 下拉選單 | 打出時 / 加值投入時 / 消費時 / 進場時 / 離場時 / 抽到時 / 檢定成功時 / 檢定失敗時 / 反應 / 被動 / 免費行動 |
| 效果代碼 (effect_code) | 文字輸入 | 對應程式邏輯的識別碼，如 `deal_damage`、`heal_hp`、`draw_card` |
| 效果參數 (effect_params) | JSON 輸入 | 效果的參數，如 `{"amount": 3, "target": "self"}` |
| 中文描述 (desc_zh) | 文字區域 | 效果的中文說明文字 |
| 英文描述 (desc_en) | 文字區域 | 效果的英文說明文字 |

- 提供 [+ 新增效果] 按鈕
- 每筆效果可刪除
- 效果可拖曳排序（選配，非必要）

### 3.4 敘事資訊區

| 欄位 | 類型 | 說明 |
|------|------|------|
| 風味文字 (flavor_text) | 文字區域 | 卡片底部的敘事文字 |

### 3.5 特殊欄位區（依卡片類別動態顯示）

當卡片類別為「神啟卡」時，額外顯示：

| 欄位 | 類型 | 說明 |
|------|------|------|
| 可否移除 (removable) | 勾選框 | 預設不可移除 |
| 可否用作加值 (committable) | 勾選框 | 預設不可 |
| 累計觸發致死次數 (lethal_count) | 數字 | 抽到幾次角色刪除，0 = 不會致死 |

當卡片類別為「簽名卡」時，額外顯示：

| 欄位 | 類型 | 說明 |
|------|------|------|
| 歸屬調查員代碼 (owner_investigator) | 文字輸入 | 這張簽名卡屬於哪個調查員 |

---

## 四、即時預覽區

在編輯表單右側（或下方，響應式），即時顯示卡片的樸素預覽。

預覽排版結構（純文字，不需要圖片）：

```
┌─────────────────────────────────┐
│ [費用]              [陣營極標籤] │
│                                 │
│         [卡片名稱]              │
│         [卡片英文名]             │
│         [類別標籤]              │
│                                 │
│ ──────────────────────────────  │
│ [關鍵字標籤列]                   │
│ 如：Item. Weapon. Firearm.      │
│ ──────────────────────────────  │
│                                 │
│ [彈藥/使用次數]                  │
│                                 │
│ [效果文字]                       │
│ 完整的效果描述，中文             │
│                                 │
│ ──────────────────────────────  │
│ [風味文字]                       │
│ 斜體顯示                        │
│ ──────────────────────────────  │
│ [檢定加值]    [傷害]   [HP/SAN] │
│ 底部三格數值                     │
└─────────────────────────────────┘
```

- 預覽隨表單輸入即時更新（使用 `input` 事件監聽）
- 不需要精美卡面設計，用簡單的 border + 文字排版即可
- 陣營極用對應的顏色標示（從 FACTIONS 常數取色）

---

## 五、操作按鈕

表單底部的按鈕：

- **儲存** — 呼叫後端 API 存入資料庫（新卡 POST、更新 PUT）
- **另存新卡** — 複製當前卡片為新卡（清空代碼和 ID，讓使用者填新代碼）
- **刪除** — 呼叫後端 API 刪除（需確認對話框）
- **匯出 JSON** — 將所有卡片匯出為 JSON 檔案下載（備份用途）
- **匯入 JSON** — 從 JSON 檔案批次匯入卡片到資料庫
- **清空表單** — 重設所有欄位

---

## 五之二、後端 API 端點

在 `packages/server/src/routes/` 新增 `cards.ts`：

### 資料庫初始化

首先需要在 PostgreSQL 中建立 `card_definitions` 和 `card_effects` 表。
請參考 `docs/資料庫結構設計_v0.1.md` 中 3.2 和 3.3 的 Schema。

若資料庫尚未初始化這些表，請在 server 啟動時自動建立（或提供 migration 腳本）。

### API 端點

```
GET    /api/cards              — 取得所有卡片（支援查詢參數篩選）
GET    /api/cards/:id          — 取得單張卡片（含 effects）
POST   /api/cards              — 新增卡片（含 effects）
PUT    /api/cards/:id          — 更新卡片（含 effects）
DELETE /api/cards/:id          — 刪除卡片（含級聯刪除 effects）
POST   /api/cards/import       — 批次匯入（接受 JSON 陣列）
GET    /api/cards/export       — 匯出所有卡片為 JSON
```

### 查詢參數（GET /api/cards）

```
?faction=S              — 篩選陣營極
?style=AH               — 篩選卡片風格
?type=asset             — 篩選卡片類別
?search=手槍            — 搜尋名稱（中英文模糊搜尋）
?weapon_tier=3          — 篩選武器階層
```

### 回傳格式

```json
{
  "success": true,
  "data": { ... },       // 單筆
  "data": [ ... ],       // 多筆
  "total": 42,           // 總數
  "error": null
}
```

### 前端呼叫

前端頁面透過 fetch 呼叫後端 API：

```javascript
const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : 'https://你的Railway網址';  // 從環境讀取或寫在 admin-shared.js

// 讀取所有卡片
const res = await fetch(`${API_BASE}/api/cards?faction=S`);
const { data } = await res.json();

// 儲存卡片
await fetch(`${API_BASE}/api/cards`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(cardData)
});
```

注意：Railway server 的 CORS 設定需要允許 Vercel 網域和 localhost 的請求（這個應該在初始化時已經設好）。

---

## 六、資料結構

每張卡片在 localStorage 中的結構：

```javascript
{
  id: crypto.randomUUID(),
  code: "core_45_automatic",
  name_zh: ".45 自動手槍",
  name_en: ".45 Automatic",
  faction: "S",          // E/I/S/N/T/F/J/P/neutral
  style: "AH",           // AH/AC/OH/OC
  type: "asset",         // asset/event/ally/skill/weakness/revelation/signature
  slot: "hand",          // hand/body/accessory/arcane/ally/none
  is_unique: false,
  level: 0,

  cost: 3,
  cost_currency: "resource",
  skill_value: 1,
  damage: 3,
  horror: 0,
  health_boost: 0,
  sanity_boost: 0,
  weapon_tier: 3,
  ammo: 4,
  uses: null,
  is_consumable: false,
  check_attribute: "agility",
  check_modifier: 2,
  check_method: "dice",   // "dice" or "chaos_bag"
  hand_limit_mod: 0,

  effects: [
    {
      trigger: "on_consume",
      effect_code: "ranged_attack",
      effect_params: { ammo_cost: 1 },
      desc_zh: "消耗 1 彈藥，進行一次敏捷 +2 的「射擊」檢定。成功時造成 3 點傷害。",
      desc_en: "Spend 1 ammo: Fight. You get +2 AGI for this attack. This attack deals 3 damage."
    }
  ],

  flavor_text: "沉甸甸的握把傳來冰冷的金屬觸感。在這個世界裡，這可能是你最可靠的朋友。",

  // 特殊欄位（神啟卡用）
  removable: true,
  committable: true,
  lethal_count: 0,

  // 特殊欄位（簽名卡用）
  owner_investigator: null,

  // 中繼資料
  version: 1,
  created_at: "2026-04-12T...",
  updated_at: "2026-04-12T..."
}
```

---

## 七、表單互動邏輯

1. **類別切換時動態顯示/隱藏欄位：**
   - 選擇「資產」→ 顯示裝備欄位、武器相關欄位
   - 選擇「事件」→ 隱藏裝備欄位、武器欄位
   - 選擇「神啟卡」→ 顯示特殊區（可移除、可加值、致死次數）
   - 選擇「簽名卡」→ 顯示歸屬調查員欄位

2. **武器階層選擇時自動填入建議值：**
   - 選擇「標準 Tier 3」→ 自動填入傷害 3、費用 3

3. **陣營極選擇時更新預覽顏色**

4. **即時驗證：**
   - 代碼格式檢查（小寫+底線+數字）
   - 代碼唯一性檢查
   - 必填欄位提示
   - 費用範圍 1–6 檢查

---

## 八、參考常數

所有常數從 `admin-shared.js` 引用：
- `GAME_RULES` — 費用範圍、屬性列表
- `ATTRIBUTES` — 七屬性中英文
- `FACTIONS` — 八陣營極中英文與顏色
- `WEAPON_TIERS` — 武器六階
- `CARD_STYLES` — 四種卡片風格
- `CARD_TYPES` — 四種卡片類別（需擴充弱點/神啟/簽名）

---

## 九、AI 卡片生成（Gemini 2.5 Flash）

### 9.1 API 設定

- 在頁面頂部工具列加一個 **「設定 API Key」** 按鈕
- 點擊後彈出輸入框，讓使用者填入 Gemini API Key
- Key 儲存在 localStorage（key: `gemini_api_key`），不上傳、不推送
- 有 Key 時顯示綠色狀態指示，無 Key 時 AI 生成按鈕灰色不可用

### 9.2 介面

在編輯表單上方加一個 AI 生成區域：

```
┌─────────────────────────────────────────────────┐
│  AI 卡片生成                                      │
│  ┌───────────────────────────────────────┐ [生成] │
│  │  輸入你想要的卡片描述...               │       │
│  │  例如：S陣營的進階武器，獵槍，費用4    │       │
│  └───────────────────────────────────────┘       │
│  [快速模板] 武器 | 法術 | 治療 | 事件 | 盟友 | 神啟 │
└─────────────────────────────────────────────────┘
```

- 文字輸入框讓使用者用自然語言描述想要的卡片
- 快速模板按鈕：點擊後自動填入預設描述（如「S 陣營的基礎武器，手槍類」）
- [生成] 按鈕呼叫 Gemini API
- 生成過程中顯示 loading 狀態
- 生成完成後自動填入所有表單欄位，使用者可修改後儲存

### 9.3 API 呼叫

使用 Gemini API 的 REST endpoint：

```javascript
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7
      }
    })
  }
);
```

### 9.4 Prompt 設計

Prompt 必須包含：

1. **遊戲規則摘要**（從 admin-shared.js 的常數組合）：
   - 數值規格：費用 1–6、武器六階傷害表、檢定加值範圍 0–5
   - 陣營極定義：八個極的名稱、風格偏重、機制關鍵字
   - 卡片三層標籤系統說明
   - HP/SAN 公式（提供規模感）

2. **輸出格式要求**：要求回傳完全符合我們卡片資料結構的 JSON

3. **使用者的描述**：使用者輸入的自然語言

Prompt 範例：

```
你是一個克蘇魯神話卡牌遊戲的卡片設計師。請根據以下規則和使用者需求，生成一張完整的卡片。

## 遊戲規則
- 骰子系統：d20
- 卡片費用範圍：1–6
- 武器傷害階層：隨身1/基礎2/標準3/進階4/稀有5/傳奇6
- 檢定加值範圍：0–5
- 八個陣營極：
  E 號令（團隊增益、NPC互動）
  I 深淵（牌組操控、自我增幅）
  S 鐵證（裝備運用、物理戰鬥）
  N 天啟（混沌袋操控、預見事件）
  T 解析（弱點揭露、戰術佈局）
  F 聖燼（治療、守護、犧牲換效果）
  J 鐵壁（傷害減免、穩定輸出）
  P 流影（反應行動、逆境翻盤）
- 卡片風格：A+H直接正面 / A+C直接負面 / O+H間接正面 / O+C間接負面
- 卡片類別：資產（場上持續）/ 事件（一次性）/ 盟友（NPC夥伴）/ 技能（檢定加值）

## 使用者需求
{使用者輸入的描述}

## 輸出格式
請回傳完全符合以下 JSON 結構的卡片資料，不要回傳其他任何文字：
{完整的卡片 JSON 結構範例}
```

### 9.5 後處理

API 回傳後：
1. 解析 JSON 回應
2. 驗證所有欄位是否在合法範圍內（費用 1–6、傷害 0–10 等）
3. 自動生成唯一代碼（如果 AI 生成的代碼已存在）
4. 填入表單所有欄位
5. 更新即時預覽
6. 使用者可自由修改後再儲存

### 9.6 錯誤處理

- API Key 無效 → 提示使用者檢查 Key
- 網路錯誤 → 顯示重試按鈕
- JSON 解析失敗 → 顯示原始回應文字，讓使用者手動處理
- 數值超出範圍 → 自動修正並提示使用者

---

## 十、完成後

1. Git commit：`feat: implement card designer (MOD-01) — full CRUD with PostgreSQL, live preview, and Gemini AI generation`
2. 更新 index.html 中 MOD-01 的狀態標籤從 `PLANNED` 改為 `READY`
3. Push 到 GitHub
