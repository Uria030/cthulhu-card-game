// Orchestrator：主策略是讓 GEMMA 透過 Ollama tool-use 自主呼叫工具
// Gemma 4 E2B 是小模型，tool-use 可靠度不如大模型
// 若 GEMMA 在 N 輪內仍未完成關鍵步驟，改走「確定性 fallback」把流程跑完
// 兩條路都產生一樣的 TaskResult，使用者無感

import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { logger, taskLogger } from '../utils/logger.js';
import { loadSystemPrompt } from './promptLoader.js';
import { routeGemini } from './taskRouter.js';
import { callGemini } from './geminiClient.js';
import { validateTaskOutput } from './validator.js';
import { writeToAdminApi } from './adminApiClient.js';
import { TOOL_DEFINITIONS, GEMMA_SYSTEM_PROMPT } from '../tools/toolDefinitions.js';
import { executeToolHandler, type ToolCall } from '../tools/toolHandlers.js';
import type { OrchestrationContext, TaskRequest, TaskResult } from '../types.js';

const MAX_ITERATIONS = 10;
const MAX_VALIDATION_RETRIES = 3;

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: ToolCall[];
  };
  done?: boolean;
}

async function callOllama(messages: OllamaChatMessage[]): Promise<OllamaChatResponse> {
  const { data } = await axios.post<OllamaChatResponse>(
    `${config.ollamaBaseUrl}/api/chat`,
    {
      model: config.ollamaModel,
      messages,
      tools: TOOL_DEFINITIONS,
      stream: false,
    },
    { timeout: 120000 },
  );
  return data;
}

function countItems(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (data === null || data === undefined) return 0;
  return 1;
}

export async function runOrchestration(task: TaskRequest): Promise<TaskResult> {
  const taskId = randomUUID();
  const startedAt = new Date().toISOString();
  const tlog = taskLogger(taskId);

  const systemPrompt = await loadSystemPrompt(task.taskType);
  const route = routeGemini(task);
  tlog.info({ taskId, task, route }, 'task received');
  logger.info(
    { taskId, taskType: task.taskType, model: route.model, aiProvider: task.aiProvider ?? 'auto' },
    'orchestration start',
  );

  // 使用者強制指定 provider 的處理策略
  //   'gemini' → 跳過 Phase 1，直接走 Phase 2（遠端 Gemini API）
  //   'gemma'  → 只試 Phase 1（本地 Ollama Gemma），失敗不 fallback
  //   undefined → 維持既有雙階段行為
  const skipGemmaPhase = task.aiProvider === 'gemini';
  const skipGeminiFallback = task.aiProvider === 'gemma';

  const ctx: OrchestrationContext = {
    taskId,
    task,
    route,
    systemPrompt,
    collectedItems: [],
    errors: [],
    logs: [
      `route: ${route.model} (${route.reason})`,
      `aiProvider: ${task.aiProvider ?? 'auto (gemma→gemini fallback)'}`,
    ],
    usage: { inputTokens: 0, outputTokens: 0 },
  };

  let gemmaCompleted = false;
  let gemmaTriedTools = false;

  // Phase 1：嘗試 GEMMA tool-use 主導（若使用者指定 'gemini' 則跳過）
  if (skipGemmaPhase) {
    ctx.logs.push('skipping Phase 1 (gemma) per aiProvider=gemini');
  } else try {
    const messages: OllamaChatMessage[] = [
      { role: 'system', content: GEMMA_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Task: ${JSON.stringify(task)}\nLoaded design prompt is ready. Begin by calling invoke_gemini with model="${route.model}".`,
      },
    ];

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const response = await callOllama(messages);
      tlog.debug({ iter, message: response.message }, 'gemma response');

      const toolCalls = response.message.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        gemmaTriedTools = true;
        messages.push({
          role: 'assistant',
          content: response.message.content ?? '',
          tool_calls: toolCalls,
        });
        for (const tc of toolCalls) {
          const res = await executeToolHandler(tc, ctx);
          tlog.info({ tool: tc.function.name, ok: res.ok, error: res.error }, 'tool executed');
          messages.push({
            role: 'tool',
            tool_call_id: tc.id ?? tc.function.name,
            content: JSON.stringify(res),
          });
        }
        continue;
      }

      // GEMMA 結束且無新工具呼叫 — 檢查是否已達成最低條件
      if (ctx.collectedItems.length > 0) {
        gemmaCompleted = true;
      }
      break;
    }
  } catch (err) {
    tlog.warn({ err: (err as Error).message }, 'gemma tool-use path failed, falling back');
    ctx.logs.push(`gemma tool-use failed: ${(err as Error).message}, fallback engaged`);
  }

  // Phase 2：遠端 Gemini API 路徑
  //   - 若 skipGeminiFallback（使用者指定本地 Gemma）→ 不進入此階段
  //   - 若 skipGemmaPhase（使用者指定遠端 Gemini）→ 直接進入此階段當主路徑
  if (!gemmaCompleted && skipGeminiFallback) {
    ctx.logs.push('skipping Phase 2 (gemini) per aiProvider=gemma; task failed in local path');
  } else if (!gemmaCompleted) {
    ctx.logs.push(
      skipGemmaPhase
        ? 'running Phase 2 as primary path (aiProvider=gemini)'
        : gemmaTriedTools
          ? 'gemma tried but did not complete; running deterministic fallback'
          : 'gemma did not emit tool calls; running deterministic fallback',
    );

    let lastError: string | undefined;
    let validated: unknown = null;

    for (let attempt = 1; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
      try {
        const gem = await callGemini({
          systemPrompt,
          userInput: task.input,
          model: route.model,
          previousError: lastError,
        });
        ctx.usage.inputTokens += gem.usage.inputTokens;
        ctx.usage.outputTokens += gem.usage.outputTokens;
        tlog.info({ attempt, usage: gem.usage, model: gem.modelName }, 'gemini call (fallback)');

        const v = validateTaskOutput(task.taskType, gem.json);
        if (v.valid) {
          validated = gem.json;
          ctx.collectedItems = [gem.json];
          break;
        }
        lastError = v.errors.join('; ');
        ctx.errors.push({ stage: 'validation', message: lastError, retryAttempt: attempt });
        tlog.warn({ attempt, errors: v.errors }, 'validation failed, retrying');
      } catch (err) {
        const msg = (err as Error).message;
        ctx.errors.push({ stage: 'gemini', message: msg, retryAttempt: attempt });
        tlog.error({ attempt, err: msg }, 'gemini call failed');
        lastError = msg;
      }
    }

    if (validated !== null) gemmaCompleted = true;
  }

  // Phase 3：寫入 DB（若未寫且 writeToDb 未關閉）
  if (gemmaCompleted && task.writeToDb !== false && !ctx.writeResult) {
    try {
      const last = ctx.collectedItems[ctx.collectedItems.length - 1];
      const writeResult = await writeToAdminApi(task.taskType, last);
      ctx.writeResult = writeResult;
      tlog.info({ writeResult }, 'admin api write completed');
    } catch (err) {
      const msg = (err as Error).message;
      ctx.errors.push({ stage: 'admin_api', message: msg });
      tlog.error({ err: msg }, 'admin api write failed');
    }
  }

  const last = ctx.collectedItems[ctx.collectedItems.length - 1];
  const itemsGenerated = countItems(last);
  const itemsWritten = ctx.writeResult?.written ?? 0;
  const status: TaskResult['status'] =
    gemmaCompleted && ctx.errors.filter((e) => e.stage !== 'validation').length === 0
      ? itemsWritten === itemsGenerated || task.writeToDb === false
        ? 'success'
        : 'partial'
      : ctx.collectedItems.length > 0
        ? 'partial'
        : 'failed';

  const result: TaskResult = {
    taskId,
    status,
    modelUsed: route.model,
    itemsGenerated,
    itemsWritten,
    errors: ctx.errors,
    items: Array.isArray(last) ? (last as unknown[]) : last !== undefined ? [last] : [],
    logs: ctx.logs,
    startedAt,
    completedAt: new Date().toISOString(),
  };

  tlog.info({ result }, 'orchestration complete');
  return result;
}
