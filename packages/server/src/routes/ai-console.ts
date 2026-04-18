import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

type AuthUser = { userId: string; role: string };

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://127.0.0.1:8787';
const BRIDGE_HEALTH_TIMEOUT_MS = 5_000;
const BRIDGE_TASK_TIMEOUT_MS = 120_000;

export const aiConsoleRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin);

  // ── GET /api/ai-console/tasks ── list with filters
  app.get<{
    Querystring: {
      status?: string;
      module?: string;
      since?: string;
      limit?: string;
      offset?: string;
      sort?: string;
      order?: string;
    };
  }>('/api/ai-console/tasks', async (request, reply) => {
    const q = request.query || {};
    const user = (request as any).user as AuthUser;

    const conds: string[] = ['user_id = $1'];
    const vals: any[] = [user.userId];

    if (q.status) {
      vals.push(q.status);
      conds.push(`status = $${vals.length}`);
    }
    if (q.module) {
      vals.push(q.module);
      conds.push(`module_code = $${vals.length}`);
    }
    if (q.since) {
      const sinceInterval = /^\d+h$/.test(q.since)
        ? `${parseInt(q.since, 10)} hours`
        : /^\d+d$/.test(q.since)
          ? `${parseInt(q.since, 10)} days`
          : null;
      if (sinceInterval) {
        conds.push(`created_at > NOW() - INTERVAL '${sinceInterval}'`);
      }
    }

    const sortCol =
      ['created_at', 'completed_at', 'status'].includes(q.sort || '') ? q.sort : 'created_at';
    const sortDir = q.order === 'asc' ? 'ASC' : 'DESC';

    const limit = Math.min(parseInt(q.limit || '50', 10) || 50, 500);
    const offset = Math.max(parseInt(q.offset || '0', 10) || 0, 0);

    try {
      const whereClause = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS total FROM ai_console_tasks ${whereClause}`,
        vals,
      );
      const listRes = await pool.query(
        `SELECT id, user_id, module_code, user_prompt, attached_text, context_tags,
                ai_model, status, artifacts_created, error_message,
                created_at, started_at, completed_at
           FROM ai_console_tasks ${whereClause}
           ORDER BY ${sortCol} ${sortDir}
           LIMIT ${limit} OFFSET ${offset}`,
        vals,
      );
      return reply.send({ success: true, data: listRes.rows, total: countRes.rows[0].total });
    } catch (error) {
      request.log.error(error, 'list ai-console tasks error');
      return reply.status(500).send({ success: false, error: 'Failed to list tasks' });
    }
  });

  // ── POST /api/ai-console/tasks ── create new task
  app.post<{
    Body: {
      module_code: string;
      user_prompt: string;
      attached_text?: string;
      context_tags?: string[];
      ai_model: string;
      ai_response?: unknown;
    };
  }>('/api/ai-console/tasks', async (request, reply) => {
    const b = request.body || ({} as any);
    const user = (request as any).user as AuthUser;

    if (!b.module_code || !b.user_prompt || !b.ai_model) {
      return reply
        .status(400)
        .send({ success: false, error: 'module_code, user_prompt, ai_model are required' });
    }

    try {
      const res = await pool.query(
        `INSERT INTO ai_console_tasks
           (user_id, module_code, user_prompt, attached_text, context_tags, ai_model, ai_response, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'queued')
         RETURNING id, status, created_at`,
        [
          user.userId,
          b.module_code,
          b.user_prompt,
          b.attached_text ?? null,
          b.context_tags ?? [],
          b.ai_model,
          b.ai_response ? JSON.stringify(b.ai_response) : null,
        ],
      );
      return reply.status(201).send({ success: true, data: res.rows[0] });
    } catch (error) {
      request.log.error(error, 'create ai-console task error');
      return reply.status(500).send({ success: false, error: 'Failed to create task' });
    }
  });

  // ── GET /api/ai-console/tasks/:id ──
  app.get<{ Params: { id: string } }>('/api/ai-console/tasks/:id', async (request, reply) => {
    const user = (request as any).user as AuthUser;
    try {
      const res = await pool.query(
        `SELECT * FROM ai_console_tasks WHERE id = $1 AND user_id = $2`,
        [request.params.id, user.userId],
      );
      if (res.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Task not found' });
      }
      return reply.send({ success: true, data: res.rows[0] });
    } catch (error) {
      request.log.error(error, 'get ai-console task error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch task' });
    }
  });

  // ── PUT /api/ai-console/tasks/:id/status ──
  app.put<{
    Params: { id: string };
    Body: {
      status?: string;
      ai_response?: unknown;
      artifacts_created?: unknown[];
      error_message?: string | null;
    };
  }>('/api/ai-console/tasks/:id/status', async (request, reply) => {
    const user = (request as any).user as AuthUser;
    const b = request.body || ({} as any);
    const sets: string[] = [];
    const vals: any[] = [];

    if (b.status) {
      vals.push(b.status);
      sets.push(`status = $${vals.length}`);
      if (b.status === 'running') sets.push(`started_at = COALESCE(started_at, NOW())`);
      if (['completed', 'failed', 'cancelled'].includes(b.status)) sets.push(`completed_at = NOW()`);
    }
    if (b.ai_response !== undefined) {
      vals.push(JSON.stringify(b.ai_response));
      sets.push(`ai_response = $${vals.length}`);
    }
    if (b.artifacts_created !== undefined) {
      vals.push(JSON.stringify(b.artifacts_created));
      sets.push(`artifacts_created = $${vals.length}`);
    }
    if (b.error_message !== undefined) {
      vals.push(b.error_message);
      sets.push(`error_message = $${vals.length}`);
    }

    if (sets.length === 0) {
      return reply.status(400).send({ success: false, error: 'No fields to update' });
    }

    vals.push(request.params.id, user.userId);
    try {
      const res = await pool.query(
        `UPDATE ai_console_tasks SET ${sets.join(', ')}
           WHERE id = $${vals.length - 1} AND user_id = $${vals.length}
           RETURNING *`,
        vals,
      );
      if (res.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Task not found' });
      }
      return reply.send({ success: true, data: res.rows[0] });
    } catch (error) {
      request.log.error(error, 'update ai-console task status error');
      return reply.status(500).send({ success: false, error: 'Failed to update task status' });
    }
  });

  // ── DELETE /api/ai-console/tasks/:id ──
  app.delete<{ Params: { id: string } }>('/api/ai-console/tasks/:id', async (request, reply) => {
    const user = (request as any).user as AuthUser;
    try {
      const res = await pool.query(
        `DELETE FROM ai_console_tasks
           WHERE id = $1 AND user_id = $2
             AND status IN ('queued', 'failed', 'cancelled', 'completed')
           RETURNING id`,
        [request.params.id, user.userId],
      );
      if (res.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Task not found or not deletable' });
      }
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, 'delete ai-console task error');
      return reply.status(500).send({ success: false, error: 'Failed to delete task' });
    }
  });

  // ── POST /api/ai-console/tasks/:id/cancel ──
  app.post<{ Params: { id: string } }>(
    '/api/ai-console/tasks/:id/cancel',
    async (request, reply) => {
      const user = (request as any).user as AuthUser;
      try {
        const res = await pool.query(
          `UPDATE ai_console_tasks
             SET status = 'cancelled', completed_at = NOW()
             WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'running')
             RETURNING id, status`,
          [request.params.id, user.userId],
        );
        if (res.rows.length === 0) {
          return reply
            .status(404)
            .send({ success: false, error: 'Task not found or not cancellable' });
        }
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, 'cancel ai-console task error');
        return reply.status(500).send({ success: false, error: 'Failed to cancel task' });
      }
    },
  );

  // ── POST /api/ai-console/tasks/:id/retry ── duplicate original as a new queued task
  app.post<{ Params: { id: string } }>(
    '/api/ai-console/tasks/:id/retry',
    async (request, reply) => {
      const user = (request as any).user as AuthUser;
      try {
        const src = await pool.query(
          `SELECT module_code, user_prompt, attached_text, context_tags, ai_model
             FROM ai_console_tasks WHERE id = $1 AND user_id = $2`,
          [request.params.id, user.userId],
        );
        if (src.rows.length === 0) {
          return reply.status(404).send({ success: false, error: 'Source task not found' });
        }
        const s = src.rows[0];
        const res = await pool.query(
          `INSERT INTO ai_console_tasks
             (user_id, module_code, user_prompt, attached_text, context_tags, ai_model, status)
           VALUES ($1,$2,$3,$4,$5,$6,'queued')
           RETURNING id, status, created_at`,
          [user.userId, s.module_code, s.user_prompt, s.attached_text, s.context_tags, s.ai_model],
        );
        return reply.status(201).send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, 'retry ai-console task error');
        return reply.status(500).send({ success: false, error: 'Failed to retry task' });
      }
    },
  );

  // ── GET /api/ai-console/bridge/health ── proxy to bridge /health
  app.get('/api/ai-console/bridge/health', async (request, reply) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BRIDGE_HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch(`${BRIDGE_URL}/health`, { signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      return reply.status(res.status).send({
        success: res.ok,
        bridgeUrl: BRIDGE_URL,
        data,
      });
    } catch (error: any) {
      clearTimeout(timer);
      request.log.error(error, 'bridge /health proxy error');
      return reply.status(502).send({
        success: false,
        bridgeUrl: BRIDGE_URL,
        error: `bridge unreachable: ${error.message || String(error)}`,
      });
    }
  });

  // ── POST /api/ai-console/bridge/run-task ── proxy to bridge /task
  app.post<{
    Body: {
      taskType: string;
      input: string;
      writeToDb?: boolean;
      batchCount?: number;
      contextTags?: string[];
    };
  }>('/api/ai-console/bridge/run-task', async (request, reply) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BRIDGE_TASK_TIMEOUT_MS);
    try {
      const res = await fetch(`${BRIDGE_URL}/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body || {}),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({ error: 'bridge returned non-JSON' }));
      return reply.status(res.status).send(data);
    } catch (error: any) {
      clearTimeout(timer);
      request.log.error(error, 'bridge /task proxy error');
      return reply.status(502).send({
        success: false,
        error: `bridge task failed: ${error.message || String(error)}`,
      });
    }
  });

  // ── DELETE /api/ai-console/tasks/clear-history ── keep running/queued
  app.delete('/api/ai-console/tasks/clear-history', async (request, reply) => {
    const user = (request as any).user as AuthUser;
    try {
      const res = await pool.query(
        `DELETE FROM ai_console_tasks
           WHERE user_id = $1 AND status NOT IN ('running', 'queued')
           RETURNING id`,
        [user.userId],
      );
      return reply.send({ success: true, data: { deleted: res.rowCount ?? 0 } });
    } catch (error) {
      request.log.error(error, 'clear ai-console history error');
      return reply.status(500).send({ success: false, error: 'Failed to clear history' });
    }
  });
};
