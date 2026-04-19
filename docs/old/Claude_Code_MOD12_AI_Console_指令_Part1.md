# Claude Code 指令：AI 主控台 MOD-12（Part 1 / 3）
## AI Console Module — Architecture & Data Layer

> **給 Claude Code：** 請建立 Admin Module 的第 12 個模組「AI 主控台」，這是 Uria 的個人工作台，用於透過聊天介面下指令給 AI（GEMMA 或 Gemini），讓 AI 自動呼叫各模組的 API 寫入遊戲資料。
>
> **本模組性質：** Uria 個人專用工具，未來開放給其他設計者使用時**此模組不開放**（其他設計者只看見 11 個原模組與 6 個模擬器）。
>
> **本模組與其他模組的關係：** 本模組**不寫入任何新的遊戲資料表**，而是調用既有 11 個模組的 API。可視為「站在所有模組之上的指揮層」。
>
> **三份指令文件：**
> - **Part 1（本文）：** 架構說明、資料層（任務佇列）、AI 自動偵測機制
> - **Part 2：** 前端 UI（左側聊天 + 中央 11 模組導覽 + 右側任務面板）
> - **Part 3：** 11 模組路由 Prompt 設計、Tool Use 機制、執行流程

---

## 一、設計目標

### 1.1 Uria 的工作體驗

```
1. 進入 admin/index.html
2. 看到既有的 11 個模組 + 6 個模擬器入口（保留不變）
3. 額外看到「AI 主控台 MOD-12」入口卡片
4. 點擊進入後：
   - 左側：聊天視窗（輸入指令給 AI）
   - 中央：11 個模組按鈕（指定 AI 用哪個模組執行）
   - 右側：任務佇列、執行中、已完成、失敗的任務清單
5. Uria 上傳純文字檔案（如已切割好的星之彩段落）+ 點按鈕「卡片設計」+ 輸入「依此段落設計 5 張深潛者主題卡片」
6. AI 開始執行，右側任務面板即時更新進度
7. 完成後可在對應模組（如 MOD-01 卡片設計器）看到產出的卡片
```

### 1.2 雙模式運作

| 模式 | 觸發條件 | 模型 | 用途 |
|------|---------|------|------|
| 本地模式 | `http://127.0.0.1:11434` 可達 | GEMMA 4 E2B（本地 Ollama） | Uria 在家使用，不耗 API 費用 |
| 遠端模式 | 本地不可達 → 自動切換 | Gemini 2.5 Pro（遠端 API） | Uria 遠端工作，自帶 API Key |

**API Key 儲存：** 由 `gemma-bridge/.env` 的 `GEMINI_API_KEY` 提供（bridge 作為本模組的 AI 執行引擎，MOD-12 前端不直接持有 API Key；詳見 §四）。

### 1.3 不在本模組職責內的事

- **不寫入任何新的遊戲資料表**（卡片、敵人、地點等都透過既有 API）
- **不修改既有 11 個模組的程式碼**（只呼叫它們的 API）
- **不處理 GEMMA 的安裝**（Uria 已自行安裝 Ollama）
- **不做檔案上傳到伺服器**（純文字檔在前端讀取後直接放入 prompt）

---

## 二、目錄結構與檔案

### 2.1 新增檔案

```
packages/client/public/admin/
├── admin-ai-console.html          # MOD-12 主頁面（新增）
├── admin-ai-console.js            # MOD-12 專用邏輯（新增）
├── admin-ai-console.css           # MOD-12 專用樣式（新增）
└── admin-ai-tasks/                # 任務佇列相關（新增資料夾）
    ├── taskQueue.js               # 任務佇列管理
    ├── taskExecutor.js            # 任務執行引擎（呼叫 bridge + 逐項 POST 到對應模組 API）
    ├── bridgeClient.js            # gemma-bridge HTTP 用戶端（/task、/health）
    └── subtaskSanitizer.js        # AI 回傳欄位白名單過濾器（避免控制欄位污染 DB）
```

### 2.2 既有檔案需修改的部分

```
packages/client/public/admin/
├── index.html                     # 新增 MOD-12 入口卡片
├── admin-shared.js                # 新增 AI 主控台相關常數
└── admin-shared.css               # （無需修改）
```

### 2.3 資料庫 Schema 變更

**新增 1 張表（PostgreSQL）：**

```sql
-- AI 主控台任務歷史紀錄
CREATE TABLE ai_console_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  
  -- 任務內容
  module_code     VARCHAR(16) NOT NULL,           -- 'MOD-01' / 'MOD-02' / ... / 'MOD-11'
  user_prompt     TEXT NOT NULL,                  -- Uria 輸入的指令原文
  attached_text   TEXT,                            -- 附加的純文字內容（可為空）
  
  -- AI 互動
  ai_model        VARCHAR(32) NOT NULL,           -- 'gemma-4-e2b' / 'gemini-2.5-pro'
  ai_response     JSONB,                           -- AI 回傳的結構化 plan
  
  -- 執行狀態
  status          VARCHAR(16) NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  
  -- 結果統計
  artifacts_created JSONB NOT NULL DEFAULT '[]', -- 產出物件清單，例：[{type: 'card', id: 'uuid', name: '深潛者守衛'}]
  error_message   TEXT,
  
  -- 時間
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_ai_tasks_user ON ai_console_tasks(user_id);
CREATE INDEX idx_ai_tasks_status ON ai_console_tasks(status);
CREATE INDEX idx_ai_tasks_created ON ai_console_tasks(created_at DESC);
```

> **設計理由：** 任務歷史儲存在 PostgreSQL 而非僅前端 localStorage，原因：
> 1. Uria 可能跨裝置工作（家用桌機、筆電遠端）
> 2. 任務執行可能跨多個 API 呼叫，需要可靠的中繼狀態
> 3. 失敗任務的 `error_message` 對未來除錯有價值

---

## 三、權限控制（重要）

### 3.1 模組可見性

**index.html 顯示邏輯：**

```javascript
// admin-shared.js 新增
const ADMIN_ONLY_MODULES = ['MOD-12'];

// 在 index.html 的模組卡片渲染邏輯中
function renderModuleCards(currentUser) {
  const allModules = [...MOD_LIST, ...SIM_LIST];
  
  return allModules
    .filter(mod => {
      // 只有 admin 角色可看見 MOD-12
      if (ADMIN_ONLY_MODULES.includes(mod.code)) {
        return currentUser.role === 'admin';
      }
      return true;
    })
    .map(mod => createModuleCard(mod));
}
```

### 3.2 後端 API 權限

**所有 `/api/ai-console/*` 端點必須加上 admin 角色驗證：**

```typescript
// 中介層
async function requireAdmin(request, reply) {
  const user = await getAuthenticatedUser(request);
  if (!user || user.role !== 'admin') {
    return reply.code(403).send({ 
      success: false, 
      error: 'Admin role required' 
    });
  }
  request.user = user;
}

// 套用到所有 ai-console 路由
fastify.register(async (instance) => {
  instance.addHook('preHandler', requireAdmin);
  // ... 所有 ai-console 端點
}, { prefix: '/api/ai-console' });
```

### 3.3 前端守門

`admin-ai-console.html` 載入時，第一件事是檢查當前使用者角色：

```javascript
window.addEventListener('DOMContentLoaded', async () => {
  const user = await fetchCurrentUser();
  if (!user || user.role !== 'admin') {
    document.body.innerHTML = `
      <div class="access-denied">
        <h1>權限不足</h1>
        <p>本模組僅限管理員使用。</p>
        <a href="index.html">← 返回首頁</a>
      </div>
    `;
    return;
  }
  initConsole(user);
});
```

---

## 四、bridge 整合與執行引擎

### 4.1 架構決議：透過 gemma-bridge 執行 AI 任務

MOD-12 **不直接呼叫 AI 模型**，而是透過 HTTP 呼叫既已建置的 `gemma-bridge/` 模組（port 8787）執行所有 AI 互動。

**理由：**
- `gemma-bridge` 已具備模型路由（Flash/Pro 自動選擇、本地/遠端切換）、Prompt 載入、JSON Schema 驗證、呼叫對應模組 API、重試機制等能力。若在 MOD-12 重寫是重複工作。
- MOD-12 專注於「指揮介面」職責：Uria 與 AI 的互動體驗、任務歷史管理、兩階段確認流程。
- API Key 儲存於 `bridge/.env`，MOD-12 前端不直接持有，減少洩露面。

### 4.2 bridge /health 偵測流程

頁面載入時只需偵測 bridge 可達性：

```
GET http://127.0.0.1:8787/health (timeout 3 秒)
  ↓
解析回傳 { status, upstreams: { ollama, gemini, admin_api } }
  ↓
根據 upstreams 狀態顯示模式指示器：
  - ollama up + gemini up   → 綠點「AI 完備（本地 + 遠端）」
  - ollama down + gemini up → 金點「僅遠端 Gemini」
  - ollama up + gemini down → 灰點「僅本地 GEMMA」
  - 皆 down 或 bridge 不可達 → 紅點「AI 不可用（請啟動 bridge）」
```

### 4.3 模式指示器（位於頁面頂部）

```html
<div class="ai-mode-indicator" id="aiModeIndicator">
  <span class="mode-dot" id="modeDot"></span>
  <span class="mode-label" id="modeLabel">偵測中...</span>
  <button class="mode-refresh" onclick="redetectBridge()" title="重新偵測">⟳</button>
</div>
```

### 4.4 bridgeClient 程式碼骨架

```javascript
// admin-ai-tasks/bridgeClient.js

const BRIDGE_URL = 'http://127.0.0.1:8787';

export async function healthCheck() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${BRIDGE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const data = await response.json();
    return { ok: true, upstreams: data.upstreams };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export async function runTask({ taskType, input, writeToDb = false, batchCount, contextTags }) {
  const response = await fetch(`${BRIDGE_URL}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskType, input, writeToDb, batchCount, contextTags }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`bridge 呼叫失敗 (${response.status}): ${text}`);
  }
  return response.json();  // { taskId, status, items, errors, usage, ... }
}
```

指示器狀態切換邏輯：

```javascript
let bridgeStatus = null;

async function redetectBridge() {
  setModeIndicator('detecting');
  const result = await healthCheck();
  if (!result.ok) {
    bridgeStatus = null;
    setModeIndicator('unavailable', result.reason);
    return;
  }
  bridgeStatus = result.upstreams;
  const { ollama, gemini } = result.upstreams;
  if (ollama === 'up' && gemini === 'up') setModeIndicator('both');
  else if (gemini === 'up') setModeIndicator('remote-only');
  else if (ollama === 'up') setModeIndicator('local-only');
  else setModeIndicator('unavailable', 'bridge 回報所有 upstream 皆 down');
}
```

### 4.5 第一期支援範圍（重要）

bridge 當前支援的 taskType 限定以下 5 種：`card_design` / `combo_design` / `talent_tree` / `enemy_design` / `stage_design`。對應到 MOD-12 的模組按鈕：

| bridge taskType | 對應 MOD | 第一期啟用 |
|-----------------|---------|-----------|
| `card_design`（含 combo_design）| MOD-01 卡片設計器 | ✅ |
| `talent_tree` | MOD-02 天賦樹設計器 | ✅ |
| `enemy_design` | MOD-03 敵人設計器 | ✅ |
| `stage_design` | （MOD-07 關卡未建置）| ⚠️ 留空 |

**第一期 MOD-12 僅啟用 3 個模組按鈕（MOD-01、MOD-02、MOD-03）**，其餘 6 個（MOD-04/05/08/09/10/11）按鈕顯示為 `disabled` + 提示「待第二期擴充 gemma-bridge 支援」。

**第二期工作（不在本次實作範圍）：** 為 MOD-04/05/08/09/10/11 在 bridge 新增 taskType、`src/schemas/*.ts`、`prompts/*.md`，以及對應的 `src/core/adminApiClient.ts` ENDPOINT_RESOLVERS 補齊。

### 4.6 雙測試分工

本模組實作完成後，Uria 會在兩個環境分別驗證：

| 測試 | 環境 | 驗證目標 |
|------|------|---------|
| 遠端測試 | 任何有穩定網路的裝置 | 接 Gemini API 測試「AI 規劃 → 確認 → 3 模組寫入」流水線，驗證 endpoint 正確、subtask 過濾有效 |
| 小黑測試 | 小黑（GTX 1650 / 4GB VRAM，本地 Ollama） | 確認本地 GEMMA 可執行；實測調整 `LOCAL_LIMIT`（見 Part 3 §二）；驗證模式指示器偵測正確 |

實作預設兩環境皆需可用。差異僅在 `bridge/.env` 是否填 `GEMINI_API_KEY` 與是否啟動本機 Ollama。

---

## 五、後端 API 端點

### 5.1 端點清單

```
# 任務管理
POST   /api/ai-console/tasks                — 建立新任務（Uria 提交指令）
GET    /api/ai-console/tasks                — 取得任務列表（含篩選）
GET    /api/ai-console/tasks/:id            — 取得單一任務詳情
PUT    /api/ai-console/tasks/:id/status     — 更新任務狀態
DELETE /api/ai-console/tasks/:id            — 刪除任務（僅限 queued/failed/cancelled 狀態）

# 任務操作
POST   /api/ai-console/tasks/:id/cancel     — 取消執行中任務
POST   /api/ai-console/tasks/:id/retry      — 重試失敗任務（建立新任務複製設定）

# 批次操作
DELETE /api/ai-console/tasks/clear-history  — 清空歷史紀錄（保留執行中與待執行）
GET    /api/ai-console/tasks/export         — 匯出任務歷史 JSON
```

### 5.2 查詢參數

```
?status=completed         — 篩選狀態
?module=MOD-01            — 篩選模組
?limit=50                 — 限制筆數（預設 50）
?offset=0                 — 分頁偏移
?sort=created_at          — 排序欄位
?order=desc               — 排序方向
```

### 5.3 POST /api/ai-console/tasks 請求格式

```json
{
  "module_code": "MOD-01",
  "user_prompt": "依此段落設計 5 張深潛者主題的恐懼系卡片",
  "attached_text": "（純文字內容，可為空）",
  "ai_model": "gemma-4-e2b"
}
```

**回應：**

```json
{
  "success": true,
  "data": {
    "id": "uuid...",
    "status": "queued",
    "created_at": "2026-04-18T09:00:00Z"
  }
}
```

### 5.4 GET /api/ai-console/tasks 回應格式

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid...",
      "module_code": "MOD-01",
      "user_prompt": "依此段落設計 5 張深潛者主題的恐懼系卡片",
      "ai_model": "gemma-4-e2b",
      "status": "completed",
      "artifacts_created": [
        { "type": "card", "id": "uuid...", "name": "深潛者的呢喃" },
        { "type": "card", "id": "uuid...", "name": "海水浸泡" }
      ],
      "created_at": "2026-04-18T09:00:00Z",
      "completed_at": "2026-04-18T09:01:23Z"
    }
  ],
  "total": 42
}
```

### 5.5 後端不直接呼叫 AI

**重要：** 後端**只負責任務狀態管理**，**不呼叫 AI 模型**。

實際的 AI 呼叫由前端 JavaScript 執行：
- 前端建立任務（POST /api/ai-console/tasks）→ 後端記錄 `queued`
- 前端開始執行：呼叫 AI API → 後端更新 `running`
- 前端取得 AI 回應 → 解析 plan → 呼叫對應模組 API（如 POST /api/cards）
- 前端完成 → 後端更新 `completed` 並記錄 `artifacts_created`

**理由：**
1. 沿用既有「前端直呼 Gemini」架構
2. 本地 GEMMA 在使用者本機，後端無法存取
3. 失敗時前端可重試，不需後端介入

---

## 六、與 11 個模組的整合對應表

### 6.1 模組對應表（2026/04/18 實測結果）

從 `packages/server/src/routes/*.ts` 實測的真實 API endpoint：

| MOD | 名稱 | HTML 檔案 | 實際 POST Endpoint |
|-----|------|-----------|-------------------|
| MOD-01 | 卡片設計器 | admin-card-designer.html | `/api/cards` |
| MOD-02 | 天賦樹設計器 | admin-talent-skill.html | `/api/talent-trees/:factionCode/nodes`（:factionCode 由 item.faction_code 取徑）|
| MOD-03 | 敵人設計器 | admin-enemy-designer.html | `/api/admin/monsters/variants`（另有 `/families`、`/species` 兩子端點）|
| MOD-04 | 團隊精神管理 | admin-team-spirit.html | `/api/team-spirits`（第二期） |
| MOD-05 | 戰鬥風格與專精 | admin-proficiency.html | `/api/combat-styles`、`/api/combat-styles/:styleId/specs`（兩層；第二期） |
| MOD-06 | 戰役敘事設計器 | （尚未建置） | — |
| MOD-07 | 關卡編輯器 | （尚未建置） | — |
| MOD-08 | 地點設計器 | admin-location-designer.html | `/api/admin/locations`（第二期） |
| MOD-09 | 鍛造與製作管理 | admin-forge-craft.html | `/api/affixes`、`/api/recipes`、`/api/materials`（三套獨立；第二期） |
| MOD-10 | 城主設計器 | admin-keeper-designer.html | `/api/admin/keeper/mythos-cards`、`/api/admin/keeper/encounter-cards`（第二期） |
| MOD-11 | 調查員設計器 | admin-investigator-designer.html | `/api/admin/investigators`（第二期） |

> **第一期只啟用 MOD-01 / MOD-02 / MOD-03**（bridge 現支援的 taskType）。其他模組的 endpoint 列出僅供第二期擴充時參照。
>
> **給 Claude Code：** 上表 endpoint 皆為 2026/04/18 查證結果。照抄即可，**不要自行「簡化」**（例如把 `/api/admin/monsters/variants` 改成 `/api/monster-variants`，這會 404）。

### 6.2 對應的中央按鈕（11 個模組各一個）

中央區域顯示 11 個按鈕，按下後：
1. 該按鈕的 `module_code` 成為當前任務的 `module_code`
2. 按鈕視覺上 highlight（金色邊框）
3. 左側聊天視窗的 placeholder 變為「（指定使用 MOD-XX）請輸入指令...」

### 6.3 模組路由 Prompt 設計

**Part 3 將詳述 11 個模組各自的 Prompt 模板。**

每個模組都有一份對應的 system prompt，內容包含：
- 該模組負責的資料類型
- 該模組的 Schema 重點欄位
- 規則書相關章節摘要
- 期望的 JSON 輸出格式
- Tool Use 函數定義（要呼叫哪個 API）

---

## 七、Part 1 完成檢查項

Claude Code 完成 Part 1 對應實作後，應確認：

- [ ] `ai_console_tasks` 表已建立
- [ ] 後端 8 個 API 端點全部實作完成
- [ ] 所有 `/api/ai-console/*` 端點受 admin 角色保護
- [ ] `index.html` 已新增 MOD-12 入口卡片（僅 admin 可見）
- [ ] `admin-shared.js` 已新增 `ADMIN_ONLY_MODULES` 常數
- [ ] `admin-ai-tasks/bridgeClient.js` 可呼叫 bridge `/health` 並解析 upstreams 狀態
- [ ] 模式指示器可區分四種狀態：both / remote-only / local-only / unavailable

---

## 八、給 Claude Code 的紀律提醒

1. **endpoint 以 §6.1 為準**：照抄 2026/04/18 實測路徑，禁止自行「簡化」或「整理」。
2. **不要修改既有 11 個模組的程式碼**：本模組是「指揮層」，所有資料寫入透過呼叫既有 API。
3. **AI 呼叫透過 gemma-bridge**：MOD-12 前端**不**直接呼叫 Ollama 或 Gemini。所有 AI 互動經由 `bridgeClient.js` 呼叫 `http://127.0.0.1:8787/task`。API Key 由 bridge 的 `.env` 提供。
4. **第一期只啟用 MOD-01/02/03**：其餘模組按鈕 disabled，不要「順便」實作。
5. **Part 2 與 Part 3 是 Part 1 的延伸**：請依序讀完三份再開始實作，避免中途返工。

---

## 九、文件版本

| 版本 | 日期 | 變更 |
|------|------|------|
| v1.0 | 2026/04/18 | Part 1 初版 — 架構、資料層、AI 自動偵測、後端 API |
