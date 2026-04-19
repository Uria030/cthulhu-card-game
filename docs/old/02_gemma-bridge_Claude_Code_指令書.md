# 文件 02：gemma-bridge 橋接程式 Claude Code 指令書
## Claude Code Instructions for gemma-bridge Module

> **給 Claude Code：** 請建立一個獨立的新 Node.js 模組 `gemma-bridge/`，作為本地 GEMMA（Ollama）與雲端 Gemini API 之間的橋接層。
>
> **本模組不修改 Admin Module 現有程式碼**，而是透過 HTTP 呼叫現有 API，與設計器在同一層級運作。

---

## 架構總覽

```
┌──────────────────────────────────────────────────────────────┐
│ Uria 透過 HTTP 請求送入任務                                   │
│  POST http://127.0.0.1:8787/task                              │
└────────────────────┬─────────────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────────────────┐
│ gemma-bridge（本模組，Port 8787）                             │
│  - Task Router：判斷任務類型                                  │
│  - Prompt Loader：載入對應的 System Prompt 模板               │
│  - Gemma Orchestrator：呼叫本地 Ollama Tool Use              │
│  - Gemini Client：呼叫雲端 Gemini API（Flash / Pro 路由）    │
│  - Validator：JSON Schema 驗證                                │
│  - Admin API Client：呼叫設計器現有 API 寫入 DB               │
│  - Task Logger：記錄所有任務與錯誤                            │
└────────────────────┬─────────────────────────────────────────┘
                     ↓
            本地 Ollama (11434)     雲端 Gemini API     Admin Module API
```

---

## 第一部分：專案結構

請在專案根目錄建立以下結構：

```
gemma-bridge/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
├── src/
│   ├── index.ts                    # Fastify 主入口
│   ├── config.ts                   # 環境變數載入
│   ├── types.ts                    # 共用型別定義
│   │
│   ├── routes/
│   │   ├── task.ts                 # POST /task 端點
│   │   └── health.ts               # GET /health 端點
│   │
│   ├── core/
│   │   ├── taskRouter.ts           # 任務類型判斷
│   │   ├── promptLoader.ts         # System Prompt 模板載入
│   │   ├── gemmaOrchestrator.ts    # GEMMA 工具呼叫協調器
│   │   ├── geminiClient.ts         # Gemini API 客戶端
│   │   ├── validator.ts            # JSON Schema 驗證
│   │   └── adminApiClient.ts       # Admin Module API 呼叫
│   │
│   ├── tools/
│   │   ├── toolDefinitions.ts      # GEMMA 可呼叫的工具定義
│   │   └── toolHandlers.ts         # 工具執行邏輯
│   │
│   ├── schemas/
│   │   ├── cardSchema.ts           # 卡片 JSON Schema
│   │   ├── talentNodeSchema.ts     # 天賦節點 JSON Schema
│   │   ├── enemySchema.ts          # 敵人 JSON Schema
│   │   ├── scenarioSchema.ts       # 場景 JSON Schema
│   │   └── comboSchema.ts          # Combo JSON Schema
│   │
│   └── utils/
│       ├── logger.ts               # Pino 日誌
│       ├── retry.ts                # 重試邏輯
│       └── tokenCounter.ts         # Token 估算（用於 Gemini 路由判斷）
│
├── prompts/
│   ├── card_design.md              # 卡片設計 System Prompt
│   ├── talent_tree.md              # 天賦樹設計 System Prompt
│   ├── enemy_design.md             # 敵人設計 System Prompt
│   ├── scenario_design.md          # 場景設計 System Prompt
│   └── combo_design.md             # Combo 設計 System Prompt
│
├── logs/
│   └── .gitkeep
│
└── tests/
    ├── task.test.ts
    └── validator.test.ts
```

---

## 第二部分：依賴套件

請在 `gemma-bridge/package.json` 定義以下依賴：

```json
{
  "name": "gemma-bridge",
  "version": "0.1.0",
  "description": "Local GEMMA action executor for Cthulhu TCG designer",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest"
  },
  "dependencies": {
    "fastify": "^4.28.1",
    "@fastify/cors": "^9.0.1",
    "axios": "^1.7.2",
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1",
    "pino": "^9.3.2",
    "pino-pretty": "^11.2.2",
    "dotenv": "^16.4.5",
    "@google/generative-ai": "^0.19.0"
  },
  "devDependencies": {
    "typescript": "^5.5.3",
    "tsx": "^4.16.2",
    "@types/node": "^20.14.10",
    "vitest": "^2.0.3"
  }
}
```

---

## 第三部分：環境變數（.env.example）

```env
# gemma-bridge 服務埠
BRIDGE_PORT=8787

# 本地 Ollama（GEMMA 動作執行層）
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma4:e2b

# 雲端 Gemini API（思考層）
GEMINI_API_KEY=<Uria 在此填入實際的 Gemini API Key>
GEMINI_FLASH_MODEL=gemini-2.5-flash
GEMINI_PRO_MODEL=gemini-2.5-pro

# 模型路由閾值（超過此 token 數或 complexity 標記為 complex 時改用 Pro）
MODEL_ROUTING_TOKEN_THRESHOLD=4000

# Admin Module API 基底 URL（Uria 既有設計器的後端）
ADMIN_API_BASE_URL=http://127.0.0.1:3000

# 日誌等級：trace / debug / info / warn / error
LOG_LEVEL=info

# 重試設定
MAX_RETRY_COUNT=3
RETRY_BACKOFF_MS=2000
```

**重要：** 請在 `gemma-bridge/.gitignore` 加入 `.env` 與 `logs/*.log`，避免 API Key 外洩。

---

## 第四部分：核心型別（src/types.ts）

```typescript
// 任務類型
export type TaskType =
  | 'card_design'       // 卡片設計（單張 / 批次）
  | 'talent_tree'       // 天賦樹節點
  | 'enemy_design'      // 敵人 / 怪物
  | 'scenario_design'   // 場景 / 關卡
  | 'combo_design';     // Combo 靈感展開

// Uria 送入的任務請求
export interface TaskRequest {
  taskType: TaskType;
  input: string;                    // Uria 的自然語言指令或貼入的長文
  complexity?: 'simple' | 'complex'; // 可選，強制指定思考模型等級
  writeToDb?: boolean;              // 預設 true；false 時只回傳 JSON 不寫 DB
  batchCount?: number;              // 批次產出張數（卡片 / 敵人 / combo 用）
  contextTags?: string[];           // 例如 ['house_cthulhu', 'faction_explorer']
}

// 任務執行結果
export interface TaskResult {
  taskId: string;
  status: 'success' | 'partial' | 'failed';
  modelUsed: 'flash' | 'pro';
  itemsGenerated: number;
  itemsWritten: number;
  errors: TaskError[];
  items: unknown[];                 // 產出的 JSON 物件（已通過驗證）
  logs: string[];
  startedAt: string;
  completedAt: string;
}

export interface TaskError {
  stage: 'prompt' | 'gemini' | 'validation' | 'admin_api' | 'ollama';
  message: string;
  retryAttempt?: number;
  itemIndex?: number;
}

// GEMMA 可呼叫的工具定義
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// Gemini 路由決策
export interface GeminiRouteDecision {
  model: 'flash' | 'pro';
  reason: string;
  estimatedInputTokens: number;
}
```

---

## 第五部分：Task Router（src/core/taskRouter.ts）

Task Router 負責判斷任務應該走哪一條路徑（單卡 / 批次 / 長文展開），以及決定使用 Gemini Flash 還是 Pro。

**路由規則：**

| 判斷條件 | 決策 |
|---------|------|
| `complexity === 'complex'` 明示 | Pro |
| `input.length > 3000` 字元 | Pro |
| `taskType === 'scenario_design'` 且含長文（偵測關鍵字「章節」「Campaign」「戰役」或字數 > 2000） | Pro |
| `taskType === 'talent_tree'` 且 `batchCount > 20` | Pro（大量節點需要跨節點平衡推理） |
| 其他情況 | Flash |

**實作要點：**
- 提供 `estimateInputTokens(input: string): number` 函數，粗略以「中文字數 × 1.5 + 英文字數 × 0.75」估算
- 回傳 `GeminiRouteDecision` 包含選用模型、原因、預估 tokens，供日誌追蹤

---

## 第六部分：Prompt Loader（src/core/promptLoader.ts）

從 `prompts/` 目錄載入對應的 System Prompt 模板。

```typescript
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TaskType } from '../types.js';

const PROMPT_MAP: Record<TaskType, string> = {
  card_design: 'card_design.md',
  talent_tree: 'talent_tree.md',
  enemy_design: 'enemy_design.md',
  scenario_design: 'scenario_design.md',
  combo_design: 'combo_design.md',
};

const promptCache = new Map<TaskType, string>();

export async function loadSystemPrompt(taskType: TaskType): Promise<string> {
  if (promptCache.has(taskType)) {
    return promptCache.get(taskType)!;
  }
  const filePath = resolve(process.cwd(), 'prompts', PROMPT_MAP[taskType]);
  const content = await readFile(filePath, 'utf-8');
  promptCache.set(taskType, content);
  return content;
}

export function clearPromptCache(): void {
  promptCache.clear();
}
```

**注意：** Prompt 模板檔案本身由 Uria 在後續文件 04–06 提供內容，Claude Code 只需建立目錄結構並在 `prompts/` 放入空白佔位符 `.md` 檔案（內容為 `# 待填入`）。

---

## 第七部分：Gemma Orchestrator（src/core/gemmaOrchestrator.ts）

這是架構中的關鍵——GEMMA 透過 Ollama 的 `/api/chat` 端點，使用 Tool Use 呼叫「呼叫 Gemini」「寫入 DB」這些動作。

**GEMMA 的 System Prompt（內建，不是 `prompts/` 目錄中的那些）：**

```
You are a local action executor. You DO NOT create creative content or make design decisions yourself.
Your only job is to call the appropriate tools in the correct order:

1. When given a task, FIRST call `invoke_gemini` with the user's input and the loaded design prompt.
2. After receiving Gemini's JSON output, call `validate_json` to check schema compliance.
3. If validation fails, call `invoke_gemini` again with the error feedback for correction (max 3 attempts).
4. If validation passes AND writeToDb is true, call `write_to_admin_api` to persist the data.
5. Always return a structured summary at the end.

You must NEVER generate card text, enemy stats, or scenario content yourself.
You must NEVER skip validation.
You must NEVER call write_to_admin_api before validation passes.
```

**工具定義（src/tools/toolDefinitions.ts）：**

```typescript
export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'invoke_gemini',
      description: 'Call cloud Gemini API to generate creative content (cards, enemies, scenarios, etc.)',
      parameters: {
        type: 'object',
        properties: {
          systemPrompt: { type: 'string', description: 'Loaded design prompt content' },
          userInput: { type: 'string', description: 'Uria original input' },
          model: { type: 'string', enum: ['flash', 'pro'] },
          previousError: { type: 'string', description: 'Validation error from previous attempt (for retry)' },
        },
        required: ['systemPrompt', 'userInput', 'model'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validate_json',
      description: 'Validate JSON output against the task schema',
      parameters: {
        type: 'object',
        properties: {
          taskType: { type: 'string' },
          jsonData: { type: 'object' },
        },
        required: ['taskType', 'jsonData'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_to_admin_api',
      description: 'Persist validated data by calling Admin Module API',
      parameters: {
        type: 'object',
        properties: {
          taskType: { type: 'string' },
          items: { type: 'array', items: { type: 'object' } },
        },
        required: ['taskType', 'items'],
      },
    },
  },
];
```

**Orchestrator 主流程：**

```typescript
export async function runOrchestration(
  task: TaskRequest,
  ctx: OrchestrationContext,
): Promise<TaskResult> {
  const messages = [
    { role: 'system', content: GEMMA_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(task) },
  ];

  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (iterations++ < MAX_ITERATIONS) {
    const response = await callOllama({
      model: process.env.OLLAMA_MODEL!,
      messages,
      tools: TOOL_DEFINITIONS,
      stream: false,
    });

    // 若 GEMMA 回傳 tool_calls，依序執行
    if (response.message.tool_calls?.length) {
      for (const toolCall of response.message.tool_calls) {
        const result = await executeToolHandler(toolCall, ctx);
        messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          tool_call_id: toolCall.id,
        });
      }
      continue;
    }

    // GEMMA 不再呼叫工具時，認為任務完成
    return buildTaskResult(ctx, response.message.content);
  }

  throw new Error('Orchestration exceeded max iterations');
}
```

---

## 第八部分：Gemini Client（src/core/geminiClient.ts）

使用官方 SDK `@google/generative-ai` 呼叫 Gemini API。

**重點功能：**

1. **模型路由：** 根據 Task Router 的決策，選擇 `gemini-2.5-flash` 或 `gemini-2.5-pro`
2. **Context Caching：** 對 System Prompt 使用 Gemini 的 Context Cache 機制，重複讀取只收 10% 費用
3. **JSON Mode：** 強制 Gemini 回傳合法 JSON（`responseMimeType: 'application/json'`）
4. **重試邏輯：** 網路錯誤或 5xx 時使用指數退避重試
5. **Token 追蹤：** 記錄每次呼叫的 input / output tokens 以便 Uria 估算成本

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function callGemini(args: {
  systemPrompt: string;
  userInput: string;
  model: 'flash' | 'pro';
  previousError?: string;
}): Promise<{ json: unknown; usage: { inputTokens: number; outputTokens: number } }> {
  const modelName =
    args.model === 'pro'
      ? process.env.GEMINI_PRO_MODEL!
      : process.env.GEMINI_FLASH_MODEL!;

  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: args.systemPrompt,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.7,
    },
  });

  let prompt = args.userInput;
  if (args.previousError) {
    prompt = `${prompt}\n\n[Previous attempt had validation error, please correct:]\n${args.previousError}`;
  }

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const usage = result.response.usageMetadata;

  return {
    json: JSON.parse(text),
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    },
  };
}
```

---

## 第九部分：Validator（src/core/validator.ts）

使用 `ajv` 驗證 JSON Schema。每種任務類型對應一份 Schema 定義（見 `src/schemas/`）。

**Schema 設計要求：**

### 9.1 卡片 Schema（src/schemas/cardSchema.ts）

依據《規則書第三章》與《卡片價值計算規範 v1.1》。關鍵驗證規則：

- `commit_icons` 與 `attribute_modifiers` 必須是不同的欄位（這是高風險分離點）
- `rarity` 必須在 `['pocket', 'basic', 'standard', 'advanced', 'rare', 'legendary']` 之中
- `card_type` 必須在 `['asset', 'ally', 'event', 'skill']` 之中
- `cost` 為整數 0–6
- `consume_effects` 的總價值必須 > 1.5V 且 ≤ 稀有度上限
- 若 `is_book === true` 或 `is_relic === true`，必須同時有 `study_method`、`study_required` 等欄位

### 9.2 天賦節點 Schema（src/schemas/talentNodeSchema.ts）

依據《支柱五：成長子系統》與 MOD-02 指令：

- `tier` 必須在 1–12 之間
- 里程碑節點（`tier === 3` 或 `tier === 6`）必須有 `milestone_type`
- `attribute_boost` 只允許在特定 tier 出現
- 總節點數檢查：每個陣營樹必須恰好 32 個節點

### 9.3 敵人 Schema（src/schemas/enemySchema.ts）

依據《怪物家族設計草案 v2》與 MOD-03 設計決議：

- `immunities` 與 `resistances` **絕對不能**出現 `arcane`（神秘元素無抗性是絕對規則）
- `family_code` 必須在合法家族清單內（`house_cthulhu`、`house_hastur` 等 10 組）
- `tier` 必須在 `['minion', 'threat', 'elite', 'boss', 'titan']` 之中
- 位階對應的 DC 值必須符合《規則書第六章》的 ENEMY_TIERS 定義（**已加 +4**）

### 9.4 場景 Schema（src/schemas/scenarioSchema.ts）

- 場景層級：`Campaign → Chapter → Stage → Scenario`
- Side Stage 跳過 Chapter 層級，需有 `is_side_stage: true` 旗標
- 每個 Scenario 必須有 `act_deck_id` 與 `agenda_deck_id`

### 9.5 Combo Schema（src/schemas/comboSchema.ts）

Combo 是 2–5 張卡片的互動展開，每張卡片使用 9.1 的卡片 Schema，外層包含：
- `combo_name_zh`
- `synergy_description`
- `cards`: [...] 陣列

**驗證器主函數：**

```typescript
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { cardSchema } from '../schemas/cardSchema.js';
// ... 其他 schema 引入

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validators: Record<string, ValidateFunction> = {
  card_design: ajv.compile(cardSchema),
  talent_tree: ajv.compile(talentNodeSchema),
  enemy_design: ajv.compile(enemySchema),
  scenario_design: ajv.compile(scenarioSchema),
  combo_design: ajv.compile(comboSchema),
};

export function validateTaskOutput(
  taskType: string,
  data: unknown,
): { valid: boolean; errors: string[] } {
  const validate = validators[taskType];
  if (!validate) throw new Error(`No validator for task type: ${taskType}`);
  const valid = validate(data);
  return {
    valid,
    errors: valid ? [] : (validate.errors ?? []).map((e) => `${e.instancePath}: ${e.message}`),
  };
}
```

---

## 第十部分：Admin API Client（src/core/adminApiClient.ts）

呼叫 Uria 現有的 Admin Module API 寫入 PostgreSQL。

**對應表：**

| taskType | Admin API Endpoint | Method |
|---------|-------------------|--------|
| `card_design` | `/api/cards` | POST（單張）/ POST 批次 |
| `talent_tree` | `/api/talent-tree/nodes` | POST |
| `enemy_design` | `/api/monster-variants` | POST |
| `scenario_design` | `/api/scenarios` | POST |
| `combo_design` | `/api/cards`（多張） | POST |

**實作要點：**

- 使用 `axios` 發送請求
- Base URL 從 `ADMIN_API_BASE_URL` 環境變數讀取
- 單張失敗不應中止整批——記錄錯誤、繼續下一張
- 回傳 `{ written: number, failed: number, errors: [...] }`

```typescript
import axios from 'axios';
import { logger } from '../utils/logger.js';

const ENDPOINT_MAP: Record<string, string> = {
  card_design: '/api/cards',
  talent_tree: '/api/talent-tree/nodes',
  enemy_design: '/api/monster-variants',
  scenario_design: '/api/scenarios',
  combo_design: '/api/cards',
};

export async function writeToAdminApi(
  taskType: string,
  items: unknown[],
): Promise<{ written: number; failed: number; errors: string[] }> {
  const endpoint = ENDPOINT_MAP[taskType];
  if (!endpoint) throw new Error(`No admin endpoint for task: ${taskType}`);

  const baseUrl = process.env.ADMIN_API_BASE_URL!;
  let written = 0;
  const errors: string[] = [];

  for (const [idx, item] of items.entries()) {
    try {
      await axios.post(`${baseUrl}${endpoint}`, item, { timeout: 15000 });
      written++;
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? `item[${idx}]: ${err.response?.status} ${err.response?.data?.message ?? err.message}`
        : `item[${idx}]: ${(err as Error).message}`;
      errors.push(msg);
      logger.warn({ idx, item, err: msg }, 'admin api write failed');
    }
  }

  return { written, failed: items.length - written, errors };
}
```

---

## 第十一部分：Fastify 主入口（src/index.ts）

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import 'dotenv/config';
import { registerTaskRoutes } from './routes/task.js';
import { registerHealthRoutes } from './routes/health.js';
import { logger } from './utils/logger.js';

const app = Fastify({ logger: false });

await app.register(cors, { origin: true });
await registerHealthRoutes(app);
await registerTaskRoutes(app);

const port = Number(process.env.BRIDGE_PORT ?? 8787);

app
  .listen({ port, host: '127.0.0.1' })
  .then(() => logger.info(`gemma-bridge listening on http://127.0.0.1:${port}`))
  .catch((err) => {
    logger.error(err, 'failed to start');
    process.exit(1);
  });
```

**POST /task 端點（src/routes/task.ts）：**

- 接收 `TaskRequest` body
- 呼叫 `runOrchestration()`
- 串流記錄 log 到 `logs/task-<taskId>.log`
- 回傳 `TaskResult`

**GET /health 端點（src/routes/health.ts）：**

檢查三個上游依賴：
1. Ollama `http://127.0.0.1:11434` 是否回應
2. Gemini API 是否可達（呼叫 `list models`）
3. Admin API Base URL 是否可達

回傳：

```json
{
  "status": "healthy",
  "upstreams": {
    "ollama": "up",
    "gemini": "up",
    "admin_api": "up"
  }
}
```

---

## 第十二部分：日誌策略（src/utils/logger.ts）

使用 `pino` 記錄結構化日誌。

**記錄內容：**

1. 每次 `/task` 請求的完整生命週期（接收、路由決策、Gemini 呼叫、驗證、寫入）
2. 每次 Gemini 呼叫的 token 使用量（方便估算成本）
3. 每次驗證失敗的詳細錯誤
4. 每次重試的原因與次數

**輸出到：**

- `stdout`（開發時以 `pino-pretty` 美化）
- `logs/task-<taskId>.log`（每個任務獨立檔案，方便事後追溯）
- `logs/errors.log`（只記錄 WARN 以上的事件）

---

## 第十三部分：重試策略（src/utils/retry.ts）

提供通用重試函數：

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts: number;
    backoffMs: number;
    shouldRetry?: (err: unknown) => boolean;
  },
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (options.shouldRetry && !options.shouldRetry(err)) throw err;
      if (attempt < options.maxAttempts) {
        await new Promise((r) => setTimeout(r, options.backoffMs * attempt));
      }
    }
  }
  throw lastErr;
}
```

**應用場景：**

1. Gemini API 呼叫（網路錯誤、5xx 才重試，4xx 不重試）
2. Admin API 呼叫（同上）
3. Ollama 呼叫（連線錯誤才重試）

**Validation 重試由 Orchestrator 層處理**（最多 3 次，每次把上一次錯誤回傳給 Gemini 修正）。

---

## 第十四部分：Prompt 佔位符檔案

在 `prompts/` 目錄建立以下 5 個檔案，內容暫為佔位符：

**card_design.md：**
```markdown
# 卡片設計 System Prompt（待填入）

> Uria 將於文件 04 提供完整內容。
> 本檔案目前僅為佔位符，避免 Prompt Loader 找不到檔案。

待填入內容：
- 三重用途系統
- V-value 計算規則
- 稀有度反推表
- 克蘇魯術語規範
- Few-shot 範例卡片
```

**talent_tree.md、enemy_design.md、scenario_design.md、combo_design.md：** 同上格式。

---

## 第十五部分：啟動腳本

在專案根目錄新增 `start-bridge.bat`（Windows 批次檔）：

```batch
@echo off
echo Starting gemma-bridge...
echo.
echo Checking Ollama...
curl -s http://127.0.0.1:11434 > nul
if errorlevel 1 (
  echo [X] Ollama is not running. Please start Ollama first.
  pause
  exit /b 1
)
echo [v] Ollama is running.
echo.
echo Starting bridge service on port 8787...
cd /d "%~dp0"
npm run dev
```

讓 Uria 只需雙擊 `start-bridge.bat` 即可啟動整個服務。

---

## 第十六部分：使用範例（README.md 內容）

在 `gemma-bridge/README.md` 撰寫使用範例：

```markdown
## 快速使用

### 啟動服務

雙擊 `start-bridge.bat`，或執行：

\`\`\`bash
npm run dev
\`\`\`

### 範例請求 1：單張卡片

\`\`\`bash
curl -X POST http://127.0.0.1:8787/task ^
  -H "Content-Type: application/json" ^
  -d "{\"taskType\":\"card_design\",\"input\":\"設計一張探索者陣營的基礎手電筒資產卡\",\"writeToDb\":false}"
\`\`\`

### 範例請求 2：批次卡片（Combo）

\`\`\`bash
curl -X POST http://127.0.0.1:8787/task ^
  -H "Content-Type: application/json" ^
  -d "{\"taskType\":\"combo_design\",\"input\":\"三張卡片的互動 COMBO，主題為深潛者感染\",\"batchCount\":3}"
\`\`\`

### 範例請求 3：長文場景展開

將整本星之彩小說文本存為 `starry_color.txt`，然後：

\`\`\`bash
curl -X POST http://127.0.0.1:8787/task ^
  -H "Content-Type: application/json" ^
  --data-binary "@starry_color_request.json"
\`\`\`

其中 `starry_color_request.json` 內容：

\`\`\`json
{
  "taskType": "scenario_design",
  "input": "<整本星之彩全文>",
  "complexity": "complex"
}
\`\`\`
```

---

## 第十七部分：交付檢查清單

請 Claude Code 執行完畢後，確認下列全部達成：

| 項目 | 檢查方式 |
|------|---------|
| 專案結構已建立 | `ls gemma-bridge/` |
| `npm install` 成功 | 無錯誤輸出 |
| `.env.example` 已放置 | 檢查檔案 |
| `prompts/` 下 5 個佔位符檔案已建立 | `ls gemma-bridge/prompts/` |
| 所有 Schema 檔案已建立（即使只是骨架） | `ls gemma-bridge/src/schemas/` |
| `npm run dev` 可啟動服務 | 看到 `gemma-bridge listening on...` |
| `GET /health` 回應正常 | curl 測試 |
| `start-bridge.bat` 可雙擊執行 | 本地測試 |
| 日誌目錄 `logs/` 已建立且 gitignore 已設定 | 檢查檔案 |
| `README.md` 已撰寫使用說明 | 檢查檔案 |

---

## 第十八部分：給 Claude Code 的最後提醒

1. **不修改 Admin Module 現有檔案** — 這是獨立新模組，只透過 HTTP 呼叫現有 API
2. **所有環境變數從 `.env` 讀取** — 不要 hardcode 任何 API Key 或 URL
3. **錯誤處理必須完整** — 任何一個 stage 失敗都要記錄詳細原因，不要吞掉錯誤
4. **不要自己撰寫 Prompt 內容** — `prompts/` 目錄只放佔位符，真正內容由 Uria 在後續文件提供
5. **Schema 驗證要嚴格** — 特別注意 `commit_icons` vs `attribute_modifiers` 分離、神秘無抗性、1:1 屬性修正等關鍵規則
6. **預留 Claude API 擴充點** — 未來 Uria 可能要求「情境 C（需決策）轉交 Claude」，請在 `geminiClient.ts` 旁保留一個 `claudeClient.ts` 的空骨架檔案

---

## 文件版本紀錄

| 版本 | 日期 | 變更內容 |
|------|------|---------|
| v1.0 | 2026/04/18 | 初版建立 — gemma-bridge 模組完整架構指令 |
