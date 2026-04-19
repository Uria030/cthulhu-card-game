# MOD-12 AI 主控台指令修正補充 v1.0
## MOD-12 AI Console — Instruction Amendment v1.0

> **給 Claude Code：** 本文件是 `Claude_Code_MOD12_AI_Console_指令_Part1~3.md` 三份指令的**正式補充**。實作時請**與三份 Part 文件一併閱讀**，凡本文件所列項目與原文衝突，**以本文件為準**（override）。
>
> **修正來源：** Uria 與 Claude 在 2026/04/18 下午對原三份 Part 文件進行架構審視，發現四類需修正項目：
> 1. **架構重疊**：MOD-12 與既已建置完成的 `gemma-bridge/` 模組功能高度重複
> 2. **API endpoint 預估錯誤**：Part 2 §4.3 `MOD_BUTTONS` 9 筆預估，實際核對後 7 錯 2 對 1 半對
> 3. **Token 上限過樂觀**：Part 3 §2.3 `LOCAL_LIMIT = 6000` 對小黑（GTX 1650 / 4GB VRAM）偏高
> 4. **subtask 未過濾**：Part 3 §4.1 `callModuleApi` 直接把 AI 回傳的物件 POST 出去，控制欄位會污染 API

---

## §A 執行架構修正：採 gemma-bridge 作為執行引擎（方案 C）

### A.1 為何修正

`d:\UG\gemma-bridge\` 已於 2026/04/18 上午完成建置與錯誤修正，其能力與 MOD-12 原設計重疊：

| 能力 | gemma-bridge 現況 | MOD-12 原設計 |
|------|------------------|--------------|
| AI 呼叫（本地 + 遠端） | ✅ `taskRouter.ts`、`geminiClient.ts`、`gemmaOrchestrator.ts` | Part 3 §3 要重寫一份 |
| Prompt 載入 | ✅ `prompts/*.md`（5 份：card / combo / talent_tree / enemy / stage） | Part 3 §7 要寫 9 份 |
| JSON 驗證 | ✅ `validator.ts`（含 H-1 consume cap / H-2 稀有度反推 / F-2 icons 分離） | 原文無 |
| 呼叫模組 API | ✅ `adminApiClient.ts` ENDPOINT_RESOLVERS 已對齊實際路徑 | Part 2 §4.3 預估錯誤 |
| 重試 / 錯誤分類 | ✅ `retry.ts` + logger | 原文有但要重寫 |

**結論：** MOD-12 不應重新實作 AI 呼叫與驗證邏輯，改為**透過 HTTP 呼叫 gemma-bridge** 執行實際的 AI 任務。

### A.2 新的整合流程

```
Uria 在 MOD-12 聊天視窗輸入指令 + 選擇模組 + 送出
  ↓
MOD-12 前端 POST http://127.0.0.1:8787/task
  body: {
    taskType: "card_design" | "combo_design" | "talent_tree" | "enemy_design",
    input: userPrompt + (attachedText || ""),
    writeToDb: false,        ← 第一階段不寫入
    batchCount: <可選>,
    contextTags: <可選>
  }
  ↓
bridge 內部執行：
  [taskRouter 選 Flash/Pro → geminiClient 呼叫 → validator 驗證 → 回傳 items 陣列]
  ↓
MOD-12 取得 bridge 回傳的 TaskResult { items, errors, usage, ... }
  ↓
MOD-12 把 items 渲染為「AI 計畫」顯示給 Uria 確認
  ↓
          ┌── Uria 取消 ──→ 任務結束
          │
    Uria 確認
          ↓
MOD-12 **自己**逐項 POST 到對應模組 API（不再呼叫 bridge）
  理由：bridge 已經產出乾淨 items，再呼叫一次會重複消耗 token
  做法：見 §D subtask 過濾層
  ↓
MOD-12 把 artifacts_created 寫入 ai_console_tasks 表
```

### A.3 MOD-12 實際要保留的職責（精簡後）

| 保留 | 廢除 |
|------|------|
| UI 三欄版面（Part 2 全部） | AI 呼叫邏輯（Part 3 §3 整段） |
| `ai_console_tasks` 表與 8 個後端 API（Part 1 §2.3、§5） | Part 3 §2 的 Prompt 結構設計（改用 bridge 的 `prompts/*.md`） |
| 模式指示器顯示（Part 1 §4.2） | Part 1 §4 完整的偵測邏輯（簡化為「檢查 bridge `/health` 是否可達」） |
| 兩階段確認流程（Part 3 §1） | Part 3 §2.3 `checkTokenLimit`、`estimateTokens`（bridge 自己處理） |
| 模組按鈕選擇器（Part 2 §4） | Part 3 §7.1 要撰寫 9 份 system prompt（直接用 bridge 的 prompts） |
| 任務面板（Part 2 §5） | |

### A.4 模式指示器邏輯（取代 Part 1 §4.1）

原本偵測「本地 Ollama + 遠端 API Key」兩個條件，現改為：

```
頁面載入
  ↓
GET http://127.0.0.1:8787/health
  ↓
┌──────────────┴──────────────┐
↓                              ↓
bridge 可達                    bridge 不可達
↓                              ↓
讀取回傳的 upstreams.ollama    顯示「bridge 未啟動」
與 upstreams.gemini 狀態       按鈕：[啟動 bridge 指南]
↓
顯示：
  - 綠點：本地 Ollama + 遠端 Gemini 皆 up
  - 金點：只有遠端 Gemini up
  - 灰點：只有本地 Ollama up（罕見）
  - 紅點：兩者皆 down
```

這樣 MOD-12 前端完全不需要自己做 `fetch('http://127.0.0.1:11434/api/tags')`，也不需要管 `localStorage.gemini_api_key`（key 在 bridge 的 `.env` 中）。

### A.5 第一期範圍限制（重要）

bridge 當前只支援 5 種 taskType，對應的模組：

| bridge taskType | 對應 MOD | 第一期支援 |
|-----------------|---------|-----------|
| `card_design` | MOD-01 卡片設計器 | ✅ |
| `combo_design` | MOD-01（展開為多卡）| ✅ |
| `talent_tree` | MOD-02 天賦樹設計器 | ✅ |
| `enemy_design` | MOD-03 敵人設計器 | ✅ |
| `stage_design` | （MOD-07 關卡未建置）| ⚠️ 留空 |

**第一期 MOD-12 僅啟用 3 個模組按鈕**（MOD-01、MOD-02、MOD-03），其餘 6 個按鈕（MOD-04/05/08/09/10/11）顯示為 `disabled` + 提示「需先擴充 gemma-bridge taskType 支援（第二期）」。

**第二期工作**（不在本次實作範圍）：
1. 為 MOD-04/05/08/09/10/11 在 bridge 新增 taskType 與對應 `schemas/*.ts` + `prompts/*.md`
2. 對應的 `adminApiClient.ts` ENDPOINT_RESOLVERS 補齊

---

## §B 11 模組 API Endpoint 查證結果（取代 Part 2 §4.3 的 `MOD_BUTTONS` 預估）

### B.1 實際路徑對照表（2026/04/18 查證）

從 `packages/server/src/routes/*.ts` 實測：

| MOD | 名稱 | 實際 POST Endpoint | 備註 |
|-----|------|-------------------|------|
| MOD-01 | 卡片設計器 | `POST /api/cards` | 單張建立；combo 展開後逐張呼叫 |
| MOD-02 | 天賦樹設計器 | `POST /api/talent-trees/:factionCode/nodes` | 需從 item.faction_code 取徑；另有 `POST /api/talent-trees/import` 批次匯入 |
| MOD-03 | 敵人設計器 | `POST /api/admin/monsters/variants` | 主要寫入點；另有 `/families`、`/species` 兩個子端點 |
| MOD-04 | 團隊精神管理 | `POST /api/team-spirits` | — |
| MOD-05 | 戰鬥風格與專精 | `POST /api/combat-styles`、`POST /api/combat-styles/:styleId/specs` | 兩層結構 |
| MOD-08 | 地點設計器 | `POST /api/admin/locations` | 注意 `/admin/` 前綴 |
| MOD-09 | 鍛造與製作管理 | `POST /api/affixes`、`POST /api/recipes`、`POST /api/materials` | 三套獨立端點 |
| MOD-10 | 城主設計器 | `POST /api/admin/keeper/mythos-cards`、`POST /api/admin/keeper/encounter-cards` | 神話卡與遭遇卡分開 |
| MOD-11 | 調查員設計器 | `POST /api/admin/investigators` | 注意 `/admin/` 前綴 |

### B.2 修正後的 `MOD_BUTTONS`（Part 2 §4.3 整段取代）

```javascript
const MOD_BUTTONS = [
  // ━━━ 第一期：透過 gemma-bridge 執行 ━━━
  {
    code: 'MOD-01',
    name_zh: '卡片設計器',
    bridgeTaskType: 'card_design',    // 送給 bridge 的 taskType
    api: '/api/cards',                // MOD-12 確認後自己逐項 POST
    available: true,
  },
  {
    code: 'MOD-02',
    name_zh: '天賦樹設計器',
    bridgeTaskType: 'talent_tree',
    api: '/api/talent-trees/:factionCode/nodes',  // :factionCode 由 item.faction_code 決定
    apiPathResolver: (item) => `/api/talent-trees/${encodeURIComponent(item.faction_code)}/nodes`,
    available: true,
  },
  {
    code: 'MOD-03',
    name_zh: '敵人設計器',
    bridgeTaskType: 'enemy_design',
    api: '/api/admin/monsters/variants',
    available: true,
  },

  // ━━━ 第二期：待擴充 bridge taskType ━━━
  {
    code: 'MOD-04', name_zh: '團隊精神', api: '/api/team-spirits',
    available: false, reason: '待擴充 bridge 支援（第二期）',
  },
  {
    code: 'MOD-05', name_zh: '戰鬥風格',
    api: '/api/combat-styles',
    available: false, reason: '待擴充 bridge 支援（第二期）',
  },
  {
    code: 'MOD-06', name_zh: '戰役敘事', api: null,
    available: false, reason: '模組尚未建置',
  },
  {
    code: 'MOD-07', name_zh: '關卡編輯器', api: null,
    available: false, reason: '模組尚未建置',
  },
  {
    code: 'MOD-08', name_zh: '地點設計器',
    api: '/api/admin/locations',
    available: false, reason: '待擴充 bridge 支援（第二期）',
  },
  {
    code: 'MOD-09', name_zh: '鍛造製作',
    api: '/api/affixes',  // 多端點；第二期決定如何拆分
    available: false, reason: '待擴充 bridge 支援（第二期）',
  },
  {
    code: 'MOD-10', name_zh: '城主設計器',
    api: '/api/admin/keeper/mythos-cards',  // 多端點
    available: false, reason: '待擴充 bridge 支援（第二期）',
  },
  {
    code: 'MOD-11', name_zh: '調查員設計器',
    api: '/api/admin/investigators',
    available: false, reason: '待擴充 bridge 支援（第二期）',
  },
];
```

### B.3 Combo 的特殊處理

bridge 的 `combo_design` 回傳一個物件含 `cards[]` 陣列。adminApiClient 展平後逐張 POST 到 `/api/cards`。MOD-12 若使用 `combo_design`：
- 可用「切換進階模式」按鈕在 MOD-01 內觸發 combo taskType
- 或在 MOD-01 按鈕外另立一個「Combo」按鈕（非必要）

**建議：** 第一期不另做 combo 按鈕，使用者在 MOD-01 的輸入框寫「設計一組 3 張 combo」時，由 MOD-12 判斷字串包含「combo」關鍵字時改送 `combo_design` taskType。若偵測不準，退而求其次，在聊天介面加一個下拉選「單張 / 批次 / Combo」讓 Uria 明確指定。

---

## §C Token 上限下修（取代 Part 3 §2.3 的 `LOCAL_LIMIT = 6000`）

小黑硬體：GTX 1650 / 4GB VRAM，Gemma 4 E2B 在此硬體上實測可用 context 窗遠小於官方標稱。

### C.1 新的上限建議

```javascript
const LOCAL_LIMIT_DEFAULT = 3500;  // 原為 6000，下修到 3500 作為起始值

// 提供設定面板讓 Uria 自行調整（Part 2 §2 的設定面板已規劃）
function getLocalLimit() {
  const saved = localStorage.getItem('mod12_local_token_limit');
  const val = saved ? parseInt(saved, 10) : LOCAL_LIMIT_DEFAULT;
  return Number.isFinite(val) && val > 500 ? val : LOCAL_LIMIT_DEFAULT;
}
```

### C.2 實測調整流程（給 Uria）

1. 首次在小黑使用 MOD-12 時，先送一個**單張卡片短指令**（如「設計一張基礎手電筒」）
2. 觀察：
   - 若 GEMMA 無回應或 Ollama OOM 錯誤 → 設定面板把 `LOCAL_LIMIT` 往下調到 2000
   - 若正常回應且時間可接受 → 嘗試逐步往上調到 5000、6000 看看極限
3. 把實測上限寫回 `localStorage.mod12_local_token_limit`

### C.3 超限時的提示文字（取代原 Part 3 §2.3 錯誤訊息）

```
輸入過長（估算 ${tokens} tokens，小黑 GEMMA 目前上限設為 ${LOCAL_LIMIT}）。

建議：
1. 把附加文字切成更小段，一次一段
2. 或在設定面板切換到「強制遠端 Gemini 2.5 Pro」（Flash 有 100 萬 token）
3. 或在設定面板調整本地上限（需先實測硬體極限）
```

---

## §D subtask 過濾層（取代 Part 3 §4.1 的 `callModuleApi`）

### D.1 問題

AI 回傳的 `items` 可能含控制欄位如 `type: "create_card"`、`design_notes`、`effect_value_estimate` 等，這些是：
- **bridge 驗證用** / **Uria 審核用** → 應保留在 plan 顯示中
- **非 DB 欄位** → 直接 POST 會被後端拒絕或寫入髒資料

### D.2 白名單方案

每個模組定義一份允許送到 API 的欄位白名單：

```javascript
// admin-ai-tasks/subtaskSanitizer.js

const API_FIELD_WHITELIST = {
  'MOD-01': [
    // 對應 card_definitions 表欄位（來源：001_create_card_tables.sql + 002 migration）
    'code', 'series', 'name_zh', 'name_en', 'faction', 'style',
    'card_type', 'slot', 'is_unique', 'is_signature', 'is_weakness',
    'is_revelation', 'level', 'cost', 'cost_currency', 'skill_value',
    'damage', 'horror', 'health_boost', 'sanity_boost',
    'weapon_tier', 'ammo', 'uses', 'consume_type',
    'check_attribute', 'check_modifier', 'check_method',
    'hand_limit_mod', 'ally_hp', 'ally_san', 'subtypes',
    'flavor_text', 'removable', 'committable', 'lethal_count',
    'owner_investigator',
    'is_book', 'is_relic', 'study_method', 'study_required',
    'study_test_attribute', 'study_test_dc', 'study_difficulty_tier',
    'study_upgrade_card', 'upgrades',
    'commit_icons', 'consume_enabled', 'consume_effect',
    'attribute_modifiers', 'spell_type', 'spell_casting',
    'combat_style', 'xp_cost',
    // 下列需伴隨送到 card_effects 表（分離處理，見 D.4）
    // 'play_effect_zh', 'play_effect_en', ...
  ],
  'MOD-02': [
    // 對應 talent_tree_nodes 表（Claude Code 請讀 MOD-02 的 migration 確認）
    'node_id', 'faction_code', 'level', 'branch', 'title_zh',
    'effect_zh', 'prerequisites',
    // 其他欄位以實際 migration 為準
  ],
  'MOD-03': [
    // 對應 monster_variants 表
    'code', 'species_code', 'family_code', 'name_zh', 'name_en',
    'tier', 'hp', 'san_damage', 'horror_radius', 'horror_value',
    'attack_element', 'vulnerabilities', 'resistances', 'immunities',
    'status_descriptions', 'attack_narratives', 'applies_status',
    'behavior_pattern', 'quantity', 'design_notes',
    // Claude Code 請讀 MOD-03 Part 1 確認完整欄位
  ],
};

/**
 * 把 AI 回傳的 subtask 過濾為只含白名單欄位的乾淨物件。
 * @param moduleCode 'MOD-01' / 'MOD-02' / 'MOD-03'
 * @param subtask AI 回傳的原始物件
 * @returns 可以直接 POST 到 API 的乾淨物件
 */
function sanitizeSubtask(moduleCode, subtask) {
  const whitelist = API_FIELD_WHITELIST[moduleCode];
  if (!whitelist) {
    throw new Error(`No whitelist defined for module: ${moduleCode}`);
  }
  const clean = {};
  for (const key of whitelist) {
    if (subtask[key] !== undefined) clean[key] = subtask[key];
  }
  return clean;
}
```

### D.3 修正後的 `callModuleApi`

```javascript
async function callModuleApi(moduleConfig, subtask) {
  const cleaned = sanitizeSubtask(moduleConfig.code, subtask);

  // 路徑解析（MOD-02 需從 subtask.faction_code 取徑）
  const path = moduleConfig.apiPathResolver
    ? moduleConfig.apiPathResolver(subtask)  // 用過濾前的原物件解析
    : moduleConfig.api;

  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cleaned),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API 呼叫失敗 (${response.status}) ${path}：${errText}`);
  }

  const result = await response.json();
  return {
    type: moduleConfig.code,
    id: result.data?.id,
    name: result.data?.name_zh || result.data?.code || '已建立',
  };
}
```

### D.4 卡片效果分表（MOD-01 特別處理）

`card_definitions` 與 `card_effects` 是兩張表。bridge 回傳的卡片物件若包含 `play_effect_zh` 等敘事，可能需要另外寫入 `card_effects`。**此處待 MOD-01 cards.ts 路由確認實作邏輯**——若 `/api/cards` 的 POST 已內建效果分表處理（把 body 的 effect 相關欄位寫入 `card_effects`），則 MOD-12 不需額外處理；若未內建，MOD-12 需在 POST 卡片後，用拿到的 `card_id` 另外 POST 到 `/api/cards/:id/effects`。

**給 Claude Code：** 實作前請直接讀 `packages/server/src/routes/cards.ts` 確認 POST 行為。

---

## §E Uria 雙測試分工（確認需求）

Uria 明確表示本次實作完成後，會分兩個環境驗證：

| 測試 | 環境 | 驗證目標 |
|------|------|---------|
| 遠端測試 | 小白（有穩定網路）或任何裝置 | 接 Gemini API 確認「AI 規劃 → 確認 → 11 模組寫入」整條流水線正常；驗證 §B endpoint 正確、§D 過濾有效 |
| 小黑測試 | 小黑（GTX 1650 / 4GB VRAM，本地 Ollama） | 確認本地 GEMMA 可執行；調整 §C 的 `LOCAL_LIMIT`；驗證 MOD-12 模式指示器能正確偵測 bridge upstream 狀態 |

實作時**預設情境是兩者都要可用**。雙環境差異只在 `bridge/.env` 的 API Key 是否填入（遠端測試填、小黑測試可不填因為主要跑本地）與是否啟動 Ollama。

---

## §F 本次修正項目清單（對應原三份 Part 文件）

| # | 原文位置 | 本文件修正 |
|---|---------|-----------|
| 1 | Part 1 §4 整節（AI 模式自動偵測） | **簡化**：改為偵測 bridge `/health`（§A.4） |
| 2 | Part 1 §6.1 模組對應表 | **取代**：用 §B.1 的實測路徑 |
| 3 | Part 2 §4.3 `MOD_BUTTONS` | **整段取代**：用 §B.2 的新結構（含 `bridgeTaskType`、`available=false` 標註、`apiPathResolver`） |
| 4 | Part 3 §2 Prompt 結構 | **廢除**：改由 bridge 的 `prompts/*.md` 提供，MOD-12 不重複 |
| 5 | Part 3 §2.3 `LOCAL_LIMIT = 6000` | **下修**到 3500 + 可設定（§C.1） |
| 6 | Part 3 §3 AI 呼叫實作（callGemmaLocal / callGeminiRemote / parseAIResponse） | **廢除**：改為單一函式呼叫 bridge `/task`（§A.2） |
| 7 | Part 3 §4.1 `callModuleApi` | **補強**：加 `sanitizeSubtask` 白名單過濾（§D.3） |
| 8 | Part 3 §7.1 撰寫 9 份 prompts 工作 | **縮減到 0 份**：第一期復用 bridge 的 card_design/talent_tree/enemy_design；第二期再處理 MOD-04/05/08/09/10/11 |
| 9 | Part 3 §8 完成檢查項 | **部分廢除**：刪除「9 份 system prompt 已建立」檢查項；新增「MOD-12 能呼叫 bridge /task 並解析回傳」檢查項 |

---

## §G 實作順序建議（取代 Part 3 文末的「建議實作順序」）

1. **後端資料層（Part 1 §2.3 + §5）** — `ai_console_tasks` 表 + 8 個 API 端點（admin 角色守門）。
2. **前端骨架（Part 2 全部）** — 三欄版面、設定面板、檔案上傳、模組按鈕 grid（用 §B.2 的新 `MOD_BUTTONS`）。
3. **bridge 連線層（§A.2 / §A.4）** — 加一層 `bridgeClient.js` 統一呼叫 `POST /task` 與 `GET /health`。
4. **兩階段執行流程（Part 3 §1 + §5）** — 保留原文邏輯，但 AI 呼叫改 `bridgeClient.runTask(taskType, input, {writeToDb: false})`。
5. **subtask 過濾（§D）** — 實作 `sanitizeSubtask` 與三模組白名單。
6. **任務面板（Part 2 §5）** — 完成輪詢與 UI。
7. **端到端測試** — Uria 依 §E 分雙環境驗證。

---

## §H 給 Claude Code 的最終提醒（取代 Part 3 §7.1）

- **不要自行實作 AI 呼叫**：所有 AI 互動**透過 bridge HTTP API**，不直接呼叫 Ollama 或 Gemini。
- **不要重寫 Prompts**：bridge 的 `prompts/*.md` 已經是事實來源，MOD-12 不維護第二份。
- **不要自行推測 API endpoint**：§B.1 是實測結果，照抄即可；不要「簡化」為 `/api/xxx` 的直觀版本。
- **不要擴大第一期範圍**：MOD-04/05/08/09/10/11 按鈕一律 disabled，不要「順便」實作。
- **不要略過 `sanitizeSubtask`**：AI 產出含太多控制欄位，直接 POST 會出錯。

---

## §I 文件版本

| 版本 | 日期 | 變更 |
|------|------|------|
| v1.0 | 2026/04/18 | 初版 — 架構改為透過 gemma-bridge、endpoint 實測修正、Token 上限下修、subtask 過濾 |
