export type TaskType =
  | 'card_design'
  | 'talent_tree'
  | 'enemy_design'
  | 'stage_design'
  | 'combo_design';

export type AiProvider = 'gemma' | 'gemini';

export interface TaskRequest {
  taskType: TaskType;
  input: string;
  complexity?: 'simple' | 'complex';
  writeToDb?: boolean;
  batchCount?: number;
  contextTags?: string[];
  /**
   * 'gemma' = 只走本地 Gemma（Ollama），失敗不 fallback
   * 'gemini' = 直接走遠端 Gemini API（跳過 Ollama 階段）
   * 未指定 = 維持舊行為（先 Gemma tool-use，失敗 fallback 到遠端 Gemini API）
   */
  aiProvider?: AiProvider;
}

export interface TaskError {
  stage: 'prompt' | 'gemini' | 'validation' | 'admin_api' | 'ollama';
  message: string;
  retryAttempt?: number;
  itemIndex?: number;
}

export interface TaskResult {
  taskId: string;
  status: 'success' | 'partial' | 'failed';
  modelUsed: 'flash' | 'pro';
  itemsGenerated: number;
  itemsWritten: number;
  errors: TaskError[];
  items: unknown[];
  logs: string[];
  startedAt: string;
  completedAt: string;
}

export interface GeminiRouteDecision {
  model: 'flash' | 'pro';
  reason: string;
  estimatedInputTokens: number;
}

export interface GeminiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface AdminWriteResult {
  written: number;
  failed: number;
  errors: string[];
}

export interface OrchestrationContext {
  taskId: string;
  task: TaskRequest;
  route: GeminiRouteDecision;
  systemPrompt: string;
  collectedItems: unknown[];
  errors: TaskError[];
  logs: string[];
  usage: GeminiUsage;
  writeResult?: AdminWriteResult;
}
