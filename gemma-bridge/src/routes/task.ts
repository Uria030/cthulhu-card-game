import type { FastifyInstance } from 'fastify';
import { runOrchestration } from '../core/gemmaOrchestrator.js';
import type { TaskRequest, TaskType } from '../types.js';

const TASK_TYPES: TaskType[] = [
  'card_design',
  'talent_tree',
  'enemy_design',
  'stage_design',
  'combo_design',
];

function isValidTaskRequest(body: unknown): body is TaskRequest {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  if (typeof b.taskType !== 'string' || !TASK_TYPES.includes(b.taskType as TaskType)) return false;
  if (typeof b.input !== 'string' || b.input.length === 0) return false;
  if (b.aiProvider !== undefined && b.aiProvider !== 'gemma' && b.aiProvider !== 'gemini') return false;
  return true;
}

export async function registerTaskRoutes(app: FastifyInstance): Promise<void> {
  app.post('/task', async (req, reply) => {
    if (!isValidTaskRequest(req.body)) {
      return reply.code(400).send({
        error: 'invalid request',
        expected:
          '{ taskType: card_design|talent_tree|enemy_design|stage_design|combo_design, input: string, ... }',
      });
    }
    try {
      const result = await runOrchestration(req.body);
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'orchestration threw');
      return reply.code(500).send({
        error: 'orchestration failed',
        message: (err as Error).message,
      });
    }
  });
}
