import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

export const teamSpiritRoutes: FastifyPluginAsync = async (app) => {
  // All team-spirit API routes require authentication
  app.addHook('preHandler', requireAuth);

  // ════════════════════════════════════════════
  //  批次操作 — 必須在 /:id 之前定義
  // ════════════════════════════════════════════

  // ── GET /api/team-spirits/export ── 匯出全部（含 depth_effects）
  app.get('/api/team-spirits/export', async (request, reply) => {
    try {
      const spirits = await pool.query('SELECT * FROM spirit_definitions ORDER BY sort_order, code');
      const depths = await pool.query('SELECT * FROM spirit_depth_effects ORDER BY spirit_def_id, depth');

      const data = spirits.rows.map((s: any) => ({
        ...s,
        total_value: s.total_value != null ? parseFloat(s.total_value) : null,
        value_per_cohesion: s.value_per_cohesion != null ? parseFloat(s.value_per_cohesion) : null,
        effect_tags: typeof s.effect_tags === 'string' ? JSON.parse(s.effect_tags) : s.effect_tags,
        depth_effects: depths.rows
          .filter((d: any) => d.spirit_def_id === s.id)
          .map((d: any) => ({
            ...d,
            effect_value: d.effect_value != null ? parseFloat(d.effect_value) : null,
          })),
      }));

      reply.header('Content-Disposition', `attachment; filename="team-spirits-export-${new Date().toISOString().split('T')[0]}.json"`);
      return reply.send({ exported_at: new Date().toISOString(), total: data.length, data });
    } catch (error) {
      request.log.error(error, 'Export team-spirits error');
      return reply.status(500).send({ success: false, error: 'Failed to export team spirits' });
    }
  });

  // ── GET /api/team-spirits/stats ── 統計
  app.get('/api/team-spirits/stats', async (request, reply) => {
    try {
      const byCategory = await pool.query(`
        SELECT category, COUNT(*)::int AS count
        FROM spirit_definitions
        GROUP BY category ORDER BY category
      `);
      const byStatus = await pool.query(`
        SELECT design_status, COUNT(*)::int AS count
        FROM spirit_definitions
        GROUP BY design_status ORDER BY design_status
      `);
      return reply.send({
        success: true,
        data: {
          by_category: byCategory.rows,
          by_design_status: byStatus.rows,
        },
      });
    } catch (error) {
      request.log.error(error, 'GET team-spirits/stats error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch stats' });
    }
  });

  // ── GET /api/team-spirits/compare ── 價值比較摘要
  app.get('/api/team-spirits/compare', async (request, reply) => {
    try {
      const spirits = await pool.query(`
        SELECT sd.id, sd.code, sd.name_zh, sd.category, sd.design_status,
               sd.total_value, sd.value_per_cohesion, sd.effect_tags,
               sd.milestone_name_zh
        FROM spirit_definitions sd
        ORDER BY sd.sort_order, sd.code
      `);
      const depths = await pool.query(`
        SELECT spirit_def_id, depth, effect_value
        FROM spirit_depth_effects
        ORDER BY spirit_def_id, depth
      `);

      const depthMap = new Map<string, number[]>();
      for (const d of depths.rows as any[]) {
        const key = String(d.spirit_def_id);
        if (!depthMap.has(key)) depthMap.set(key, [0, 0, 0, 0, 0]);
        const arr = depthMap.get(key)!;
        if (d.depth >= 1 && d.depth <= 5) {
          arr[d.depth - 1] = d.effect_value != null ? parseFloat(d.effect_value) : 0;
        }
      }

      const data = spirits.rows.map((s: any) => ({
        id: s.id,
        code: s.code,
        name_zh: s.name_zh,
        category: s.category,
        design_status: s.design_status,
        total_value: s.total_value != null ? parseFloat(s.total_value) : null,
        value_per_cohesion: s.value_per_cohesion != null ? parseFloat(s.value_per_cohesion) : null,
        effect_tags: typeof s.effect_tags === 'string' ? JSON.parse(s.effect_tags) : s.effect_tags,
        has_milestone: !!s.milestone_name_zh,
        depth_values: depthMap.get(String(s.id)) || [0, 0, 0, 0, 0],
      }));

      return reply.send({ success: true, data, total: data.length });
    } catch (error) {
      request.log.error(error, 'GET team-spirits/compare error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch compare data' });
    }
  });

  // ── POST /api/team-spirits/import ── 匯入 JSON
  app.post<{ Body: any }>('/api/team-spirits/import', async (request, reply) => {
    const payload = request.body as any;
    const items = Array.isArray(payload) ? payload : (payload?.data ?? payload);
    if (!Array.isArray(items)) {
      return reply.status(400).send({ success: false, error: 'Expected JSON array of team spirits (or { data: [...] })' });
    }
    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (const item of items) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const spiritRes = await client.query(`
          INSERT INTO spirit_definitions (
            code, name_zh, name_en, category, description, description_en,
            design_notes, adopt_effect_zh, adopt_effect_en, maxed_effect_zh, maxed_effect_en,
            milestone_name_zh, milestone_name_en, milestone_desc, milestone_effect_zh, milestone_effect_en,
            total_value, value_per_cohesion, effect_tags, design_status, sort_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
          ON CONFLICT (code) DO UPDATE SET
            name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en,
            category = EXCLUDED.category, description = EXCLUDED.description,
            description_en = EXCLUDED.description_en, design_notes = EXCLUDED.design_notes,
            adopt_effect_zh = EXCLUDED.adopt_effect_zh, adopt_effect_en = EXCLUDED.adopt_effect_en,
            maxed_effect_zh = EXCLUDED.maxed_effect_zh, maxed_effect_en = EXCLUDED.maxed_effect_en,
            milestone_name_zh = EXCLUDED.milestone_name_zh, milestone_name_en = EXCLUDED.milestone_name_en,
            milestone_desc = EXCLUDED.milestone_desc, milestone_effect_zh = EXCLUDED.milestone_effect_zh,
            milestone_effect_en = EXCLUDED.milestone_effect_en,
            total_value = EXCLUDED.total_value, value_per_cohesion = EXCLUDED.value_per_cohesion,
            effect_tags = EXCLUDED.effect_tags, design_status = EXCLUDED.design_status,
            sort_order = EXCLUDED.sort_order, updated_at = NOW()
          RETURNING id
        `, [
          item.code, item.name_zh, item.name_en || null, item.category || null,
          item.description || null, item.description_en || null, item.design_notes || null,
          item.adopt_effect_zh || null, item.adopt_effect_en || null,
          item.maxed_effect_zh || null, item.maxed_effect_en || null,
          item.milestone_name_zh || null, item.milestone_name_en || null,
          item.milestone_desc || null, item.milestone_effect_zh || null, item.milestone_effect_en || null,
          item.total_value ?? null, item.value_per_cohesion ?? null,
          item.effect_tags ? JSON.stringify(item.effect_tags) : null,
          item.design_status || 'draft', item.sort_order || 0,
        ]);
        const spiritId = spiritRes.rows[0].id;

        // Import depth_effects
        if (Array.isArray(item.depth_effects)) {
          for (const de of item.depth_effects) {
            await client.query(`
              INSERT INTO spirit_depth_effects (spirit_def_id, depth, effect_name_zh, effect_name_en, effect_desc_zh, effect_desc_en, effect_value, effect_formula)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT (spirit_def_id, depth) DO UPDATE SET
                effect_name_zh = EXCLUDED.effect_name_zh, effect_name_en = EXCLUDED.effect_name_en,
                effect_desc_zh = EXCLUDED.effect_desc_zh, effect_desc_en = EXCLUDED.effect_desc_en,
                effect_value = EXCLUDED.effect_value, effect_formula = EXCLUDED.effect_formula,
                updated_at = NOW()
            `, [spiritId, de.depth, de.effect_name_zh || null, de.effect_name_en || null,
                de.effect_desc_zh || null, de.effect_desc_en || null,
                de.effect_value ?? null, de.effect_formula || null]);
          }
        }

        await client.query('COMMIT');
        results.success++;
      } catch (error: any) {
        await client.query('ROLLBACK');
        results.failed++;
        results.errors.push(`${item.code || 'unknown'}: ${error.message}`);
      } finally {
        client.release();
      }
    }
    return reply.send({ success: true, data: results });
  });

  // ════════════════════════════════════════════
  //  團隊精神 CRUD
  // ════════════════════════════════════════════

  // ── GET /api/team-spirits ── 列出所有
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/team-spirits', async (request, reply) => {
    try {
      const { category, design_status, search, sort } = request.query;
      const conditions: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (category) {
        conditions.push(`sd.category = $${idx++}`);
        params.push(category);
      }
      if (design_status) {
        conditions.push(`sd.design_status = $${idx++}`);
        params.push(design_status);
      }
      if (search) {
        conditions.push(`(sd.name_zh ILIKE $${idx} OR sd.name_en ILIKE $${idx} OR sd.code ILIKE $${idx})`);
        params.push(`%${search}%`);
        idx++;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      let orderBy = 'sd.sort_order, sd.code';
      if (sort === 'total_value') orderBy = 'sd.total_value DESC NULLS LAST, sd.code';
      else if (sort === 'value_per_cohesion') orderBy = 'sd.value_per_cohesion DESC NULLS LAST, sd.code';
      else if (sort === 'sort_order') orderBy = 'sd.sort_order, sd.code';

      const result = await pool.query(`
        SELECT sd.*,
          (SELECT COUNT(*) FROM spirit_depth_effects sde WHERE sde.spirit_def_id = sd.id)::int AS depth_count
        FROM spirit_definitions sd
        ${where}
        ORDER BY ${orderBy}
      `, params);

      const data = result.rows.map((s: any) => ({
        ...s,
        total_value: s.total_value != null ? parseFloat(s.total_value) : null,
        value_per_cohesion: s.value_per_cohesion != null ? parseFloat(s.value_per_cohesion) : null,
        effect_tags: typeof s.effect_tags === 'string' ? JSON.parse(s.effect_tags) : s.effect_tags,
      }));

      return reply.send({ success: true, data, total: data.length });
    } catch (error) {
      request.log.error(error, 'GET /api/team-spirits error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch team spirits' });
    }
  });

  // ── GET /api/team-spirits/:id ── 單一精神 + depth_effects
  app.get<{ Params: { id: string } }>('/api/team-spirits/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const spirit = await pool.query('SELECT * FROM spirit_definitions WHERE id = $1', [id]);
      if (spirit.rows.length === 0) return reply.status(404).send({ success: false, error: 'Team spirit not found' });

      const depths = await pool.query('SELECT * FROM spirit_depth_effects WHERE spirit_def_id = $1 ORDER BY depth', [id]);

      const s = spirit.rows[0];
      return reply.send({
        success: true,
        data: {
          ...s,
          total_value: s.total_value != null ? parseFloat(s.total_value) : null,
          value_per_cohesion: s.value_per_cohesion != null ? parseFloat(s.value_per_cohesion) : null,
          effect_tags: typeof s.effect_tags === 'string' ? JSON.parse(s.effect_tags) : s.effect_tags,
          depth_effects: depths.rows.map((d: any) => ({
            ...d,
            effect_value: d.effect_value != null ? parseFloat(d.effect_value) : null,
          })),
        },
      });
    } catch (error) {
      request.log.error(error, 'GET team-spirit error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch team spirit' });
    }
  });

  // ── POST /api/team-spirits ── 新增
  app.post<{ Body: Record<string, any> }>('/api/team-spirits', async (request, reply) => {
    const b = request.body;
    try {
      const result = await pool.query(`
        INSERT INTO spirit_definitions (
          code, name_zh, name_en, category, description, description_en,
          design_notes, adopt_effect_zh, adopt_effect_en, maxed_effect_zh, maxed_effect_en,
          milestone_name_zh, milestone_name_en, milestone_desc, milestone_effect_zh, milestone_effect_en,
          total_value, value_per_cohesion, effect_tags, design_status, sort_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        RETURNING *
      `, [
        b.code, b.name_zh, b.name_en || null, b.category || null,
        b.description || null, b.description_en || null, b.design_notes || null,
        b.adopt_effect_zh || null, b.adopt_effect_en || null,
        b.maxed_effect_zh || null, b.maxed_effect_en || null,
        b.milestone_name_zh || null, b.milestone_name_en || null,
        b.milestone_desc || null, b.milestone_effect_zh || null, b.milestone_effect_en || null,
        b.total_value ?? null, b.value_per_cohesion ?? null,
        b.effect_tags ? JSON.stringify(b.effect_tags) : null,
        b.design_status || 'draft', b.sort_order || 0,
      ]);
      const s = result.rows[0];
      return reply.status(201).send({
        success: true,
        data: {
          ...s,
          total_value: s.total_value != null ? parseFloat(s.total_value) : null,
          value_per_cohesion: s.value_per_cohesion != null ? parseFloat(s.value_per_cohesion) : null,
          effect_tags: typeof s.effect_tags === 'string' ? JSON.parse(s.effect_tags) : s.effect_tags,
        },
      });
    } catch (error: any) {
      request.log.error(error, 'POST team-spirit error');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: 'Team spirit code already exists' });
      return reply.status(500).send({ success: false, error: 'Failed to create team spirit' });
    }
  });

  // ── PUT /api/team-spirits/:id ── 更新
  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/team-spirits/:id', async (request, reply) => {
    const { id } = request.params;
    const b = request.body;
    try {
      const result = await pool.query(`
        UPDATE spirit_definitions SET
          name_zh = $1, name_en = $2, category = $3, description = $4, description_en = $5,
          design_notes = $6, adopt_effect_zh = $7, adopt_effect_en = $8,
          maxed_effect_zh = $9, maxed_effect_en = $10,
          milestone_name_zh = $11, milestone_name_en = $12, milestone_desc = $13,
          milestone_effect_zh = $14, milestone_effect_en = $15,
          total_value = $16, value_per_cohesion = $17, effect_tags = $18,
          design_status = $19, sort_order = $20,
          updated_at = NOW()
        WHERE id = $21 RETURNING *
      `, [
        b.name_zh, b.name_en || null, b.category || null, b.description || null, b.description_en || null,
        b.design_notes || null, b.adopt_effect_zh || null, b.adopt_effect_en || null,
        b.maxed_effect_zh || null, b.maxed_effect_en || null,
        b.milestone_name_zh || null, b.milestone_name_en || null, b.milestone_desc || null,
        b.milestone_effect_zh || null, b.milestone_effect_en || null,
        b.total_value ?? null, b.value_per_cohesion ?? null,
        b.effect_tags ? JSON.stringify(b.effect_tags) : null,
        b.design_status || 'draft', b.sort_order || 0,
        id,
      ]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Team spirit not found' });
      const s = result.rows[0];
      return reply.send({
        success: true,
        data: {
          ...s,
          total_value: s.total_value != null ? parseFloat(s.total_value) : null,
          value_per_cohesion: s.value_per_cohesion != null ? parseFloat(s.value_per_cohesion) : null,
          effect_tags: typeof s.effect_tags === 'string' ? JSON.parse(s.effect_tags) : s.effect_tags,
        },
      });
    } catch (error) {
      request.log.error(error, 'PUT team-spirit error');
      return reply.status(500).send({ success: false, error: 'Failed to update team spirit' });
    }
  });

  // ── DELETE /api/team-spirits/:id ── 刪除（CASCADE 深度效果）
  app.delete<{ Params: { id: string } }>('/api/team-spirits/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const result = await pool.query('DELETE FROM spirit_definitions WHERE id = $1 RETURNING id, code', [id]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Team spirit not found' });
      return reply.send({ success: true, data: { deleted: result.rows[0] } });
    } catch (error) {
      request.log.error(error, 'DELETE team-spirit error');
      return reply.status(500).send({ success: false, error: 'Failed to delete team spirit' });
    }
  });

  // ════════════════════════════════════════════
  //  深度效果
  // ════════════════════════════════════════════

  // ── GET /api/team-spirits/:spiritId/depths ── 取得某精神的全部深度效果
  app.get<{ Params: { spiritId: string } }>('/api/team-spirits/:spiritId/depths', async (request, reply) => {
    const { spiritId } = request.params;
    try {
      const result = await pool.query(
        'SELECT * FROM spirit_depth_effects WHERE spirit_def_id = $1 ORDER BY depth',
        [spiritId]
      );
      const data = result.rows.map((d: any) => ({
        ...d,
        effect_value: d.effect_value != null ? parseFloat(d.effect_value) : null,
      }));
      return reply.send({ success: true, data, total: data.length });
    } catch (error) {
      request.log.error(error, 'GET depths error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch depth effects' });
    }
  });

  // ── PUT /api/team-spirits/:spiritId/depths ── 批次更新 5 點 (upsert)
  app.put<{ Params: { spiritId: string }; Body: any[] }>('/api/team-spirits/:spiritId/depths', async (request, reply) => {
    const { spiritId } = request.params;
    const items = request.body;
    if (!Array.isArray(items)) {
      return reply.status(400).send({ success: false, error: 'Expected JSON array of depth effects' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify spirit exists
      const check = await client.query('SELECT id FROM spirit_definitions WHERE id = $1', [spiritId]);
      if (check.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ success: false, error: 'Team spirit not found' });
      }

      const upserted = [];
      for (const de of items) {
        const res = await client.query(`
          INSERT INTO spirit_depth_effects (spirit_def_id, depth, effect_name_zh, effect_name_en, effect_desc_zh, effect_desc_en, effect_value, effect_formula)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (spirit_def_id, depth) DO UPDATE SET
            effect_name_zh = EXCLUDED.effect_name_zh, effect_name_en = EXCLUDED.effect_name_en,
            effect_desc_zh = EXCLUDED.effect_desc_zh, effect_desc_en = EXCLUDED.effect_desc_en,
            effect_value = EXCLUDED.effect_value, effect_formula = EXCLUDED.effect_formula,
            updated_at = NOW()
          RETURNING *
        `, [spiritId, de.depth, de.effect_name_zh || null, de.effect_name_en || null,
            de.effect_desc_zh || null, de.effect_desc_en || null,
            de.effect_value ?? null, de.effect_formula || null]);
        upserted.push(res.rows[0]);
      }

      // Update parent updated_at
      await client.query('UPDATE spirit_definitions SET updated_at = NOW() WHERE id = $1', [spiritId]);

      await client.query('COMMIT');
      const data = upserted.map((d: any) => ({
        ...d,
        effect_value: d.effect_value != null ? parseFloat(d.effect_value) : null,
      }));
      return reply.send({ success: true, data, total: data.length });
    } catch (error) {
      await client.query('ROLLBACK');
      request.log.error(error, 'PUT depths batch error');
      return reply.status(500).send({ success: false, error: 'Failed to update depth effects' });
    } finally {
      client.release();
    }
  });

  // ── PUT /api/team-spirits/:spiritId/depths/:depth ── 更新單一深度
  app.put<{ Params: { spiritId: string; depth: string }; Body: Record<string, any> }>('/api/team-spirits/:spiritId/depths/:depth', async (request, reply) => {
    const { spiritId, depth } = request.params;
    const b = request.body;
    try {
      const result = await pool.query(`
        INSERT INTO spirit_depth_effects (spirit_def_id, depth, effect_name_zh, effect_name_en, effect_desc_zh, effect_desc_en, effect_value, effect_formula)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (spirit_def_id, depth) DO UPDATE SET
          effect_name_zh = EXCLUDED.effect_name_zh, effect_name_en = EXCLUDED.effect_name_en,
          effect_desc_zh = EXCLUDED.effect_desc_zh, effect_desc_en = EXCLUDED.effect_desc_en,
          effect_value = EXCLUDED.effect_value, effect_formula = EXCLUDED.effect_formula,
          updated_at = NOW()
        RETURNING *
      `, [spiritId, depth, b.effect_name_zh || null, b.effect_name_en || null,
          b.effect_desc_zh || null, b.effect_desc_en || null,
          b.effect_value ?? null, b.effect_formula || null]);

      // Update parent updated_at
      await pool.query('UPDATE spirit_definitions SET updated_at = NOW() WHERE id = $1', [spiritId]);

      const d = result.rows[0];
      return reply.send({
        success: true,
        data: {
          ...d,
          effect_value: d.effect_value != null ? parseFloat(d.effect_value) : null,
        },
      });
    } catch (error) {
      request.log.error(error, 'PUT single depth error');
      return reply.status(500).send({ success: false, error: 'Failed to update depth effect' });
    }
  });
};
