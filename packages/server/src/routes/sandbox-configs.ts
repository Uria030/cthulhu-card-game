import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { requireAuth, requireAdminRole } from '../middleware/auth.js';

export const sandboxConfigRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // ── GET /api/sandbox-configs ── 列出所有(可帶 stage_id 篩選)
  app.get<{ Querystring: { stage_id?: string } }>('/api/sandbox-configs', async (request, reply) => {
    const { stage_id } = request.query;
    try {
      const sql = stage_id
        ? `SELECT * FROM sandbox_configs WHERE stage_id = $1 ORDER BY created_at DESC`
        : `SELECT * FROM sandbox_configs ORDER BY created_at DESC`;
      const params = stage_id ? [stage_id] : [];
      const r = await pool.query(sql, params);
      return reply.send({ success: true, data: r.rows, total: r.rows.length });
    } catch (err) {
      request.log.error(err, 'GET /api/sandbox-configs error');
      return reply.status(500).send({ success: false, error: 'Failed to list sandbox configs' });
    }
  });

  // ── GET /api/sandbox-configs/:id ──
  app.get<{ Params: { id: string } }>('/api/sandbox-configs/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const r = await pool.query('SELECT * FROM sandbox_configs WHERE id = $1', [id]);
      if (r.rows.length === 0) return reply.status(404).send({ success: false, error: 'Config not found' });
      return reply.send({ success: true, data: r.rows[0] });
    } catch (err) {
      request.log.error(err, 'GET sandbox-config error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch config' });
    }
  });

  // ── POST /api/sandbox-configs ──
  app.post<{ Body: Record<string, any> }>('/api/sandbox-configs', async (request, reply) => {
    const b = request.body;
    if (!b.stage_id || !b.config_name) {
      return reply.status(400).send({ success: false, error: 'stage_id 與 config_name 為必填' });
    }
    try {
      const r = await pool.query(`
        INSERT INTO sandbox_configs (
          stage_id, config_name, monster_pool, mythos_pool, encounter_pool,
          injected_cards, keeper_action_pool, combat_style_override, notes
        ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9)
        RETURNING *
      `, [
        b.stage_id, b.config_name,
        JSON.stringify(b.monster_pool || []),
        JSON.stringify(b.mythos_pool || []),
        JSON.stringify(b.encounter_pool || []),
        JSON.stringify(b.injected_cards || []),
        JSON.stringify(b.keeper_action_pool || []),
        JSON.stringify(b.combat_style_override || {}),
        b.notes || null,
      ]);
      return reply.status(201).send({ success: true, data: r.rows[0] });
    } catch (err: any) {
      if (err?.code === '23505') return reply.status(409).send({ success: false, error: '同 stage 內 config_name 已存在' });
      request.log.error(err, 'POST sandbox-config error');
      return reply.status(500).send({ success: false, error: 'Failed to create sandbox config' });
    }
  });

  // ── PUT /api/sandbox-configs/:id ──
  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/sandbox-configs/:id', async (request, reply) => {
    const { id } = request.params;
    const b = request.body;
    try {
      const r = await pool.query(`
        UPDATE sandbox_configs SET
          config_name = COALESCE($1, config_name),
          monster_pool = COALESCE($2::jsonb, monster_pool),
          mythos_pool = COALESCE($3::jsonb, mythos_pool),
          encounter_pool = COALESCE($4::jsonb, encounter_pool),
          injected_cards = COALESCE($5::jsonb, injected_cards),
          keeper_action_pool = COALESCE($6::jsonb, keeper_action_pool),
          combat_style_override = COALESCE($7::jsonb, combat_style_override),
          notes = $8,
          updated_at = NOW()
        WHERE id = $9 RETURNING *
      `, [
        b.config_name ?? null,
        b.monster_pool ? JSON.stringify(b.monster_pool) : null,
        b.mythos_pool ? JSON.stringify(b.mythos_pool) : null,
        b.encounter_pool ? JSON.stringify(b.encounter_pool) : null,
        b.injected_cards ? JSON.stringify(b.injected_cards) : null,
        b.keeper_action_pool ? JSON.stringify(b.keeper_action_pool) : null,
        b.combat_style_override ? JSON.stringify(b.combat_style_override) : null,
        b.notes ?? null,
        id,
      ]);
      if (r.rows.length === 0) return reply.status(404).send({ success: false, error: 'Config not found' });
      return reply.send({ success: true, data: r.rows[0] });
    } catch (err) {
      request.log.error(err, 'PUT sandbox-config error');
      return reply.status(500).send({ success: false, error: 'Failed to update config' });
    }
  });

  // ── DELETE /api/sandbox-configs/:id ──
  app.delete<{ Params: { id: string } }>('/api/sandbox-configs/:id', { preHandler: requireAdminRole }, async (request, reply) => {
    const { id } = request.params;
    try {
      const r = await pool.query('DELETE FROM sandbox_configs WHERE id = $1 RETURNING id, config_name', [id]);
      if (r.rows.length === 0) return reply.status(404).send({ success: false, error: 'Config not found' });
      return reply.send({ success: true, data: { deleted: r.rows[0] } });
    } catch (err) {
      request.log.error(err, 'DELETE sandbox-config error');
      return reply.status(500).send({ success: false, error: 'Failed to delete config' });
    }
  });

  // ── POST /api/sandbox-configs/:id/load ── 把此 config 設為 stage.sandbox_config_id
  app.post<{ Params: { id: string } }>('/api/sandbox-configs/:id/load', async (request, reply) => {
    const { id } = request.params;
    try {
      const cfg = await pool.query('SELECT stage_id FROM sandbox_configs WHERE id = $1', [id]);
      if (cfg.rows.length === 0) return reply.status(404).send({ success: false, error: 'Config not found' });
      const stageId = cfg.rows[0].stage_id;
      await pool.query('UPDATE stages SET sandbox_config_id = $1, updated_at = NOW() WHERE id = $2', [id, stageId]);
      return reply.send({ success: true, data: { stage_id: stageId, sandbox_config_id: id } });
    } catch (err) {
      request.log.error(err, 'POST sandbox-config load error');
      return reply.status(500).send({ success: false, error: 'Failed to load config' });
    }
  });

  // ── PUT /api/stages/:id/sandbox-mode ── 切換 stage 的 is_sandbox 旗標
  app.put<{ Params: { id: string }; Body: { is_sandbox: boolean } }>('/api/stages/:id/sandbox-mode', async (request, reply) => {
    const { id } = request.params;
    const { is_sandbox } = request.body || ({} as any);
    if (typeof is_sandbox !== 'boolean') {
      return reply.status(400).send({ success: false, error: 'is_sandbox 必須為 boolean' });
    }
    try {
      const r = await pool.query(
        'UPDATE stages SET is_sandbox = $1, updated_at = NOW() WHERE id = $2 RETURNING id, code, is_sandbox, sandbox_config_id',
        [is_sandbox, id]
      );
      if (r.rows.length === 0) return reply.status(404).send({ success: false, error: 'Stage not found' });
      return reply.send({ success: true, data: r.rows[0] });
    } catch (err) {
      request.log.error(err, 'PUT sandbox-mode error');
      return reply.status(500).send({ success: false, error: 'Failed to toggle sandbox mode' });
    }
  });
};
