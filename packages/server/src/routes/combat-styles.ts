import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

export const combatStyleRoutes: FastifyPluginAsync = async (app) => {
  // All combat-style API routes require authentication
  app.addHook('preHandler', requireAuth);

  // ════════════════════════════════════════════
  //  批次操作 — 必須在 /:id 之前定義
  // ════════════════════════════════════════════

  // ── GET /api/combat-styles/export ── 匯出所有資料
  app.get('/api/combat-styles/export', async (request, reply) => {
    try {
      const styles = await pool.query('SELECT * FROM combat_styles ORDER BY sort_order, code');
      const specs = await pool.query('SELECT * FROM specializations ORDER BY combat_style_id, code');
      const cards = await pool.query('SELECT * FROM combat_style_cards ORDER BY combat_style_id, code');

      const data = styles.rows.map((s: any) => ({
        code: s.code,
        name_zh: s.name_zh,
        name_en: s.name_en,
        description_zh: s.description_zh,
        description_en: s.description_en,
        sort_order: s.sort_order,
        specializations: specs.rows.filter((sp: any) => sp.combat_style_id === s.id),
        style_cards: cards.rows.filter((c: any) => c.combat_style_id === s.id),
      }));

      reply.header('Content-Disposition', `attachment; filename="combat-styles-export-${new Date().toISOString().split('T')[0]}.json"`);
      return reply.send({ exported_at: new Date().toISOString(), total: data.length, data });
    } catch (error) {
      request.log.error(error, 'Export combat-styles error');
      return reply.status(500).send({ success: false, error: 'Failed to export combat styles' });
    }
  });

  // ── GET /api/combat-styles/stats ── 統計
  app.get('/api/combat-styles/stats', async (request, reply) => {
    try {
      const result = await pool.query(`
        SELECT
          cs.id, cs.code, cs.name_zh, cs.name_en,
          cs.spec_count,
          (SELECT COUNT(*) FROM combat_style_cards csc WHERE csc.combat_style_id = cs.id)::int AS card_count
        FROM combat_styles cs
        ORDER BY cs.sort_order, cs.code
      `);
      return reply.send({ success: true, data: result.rows, total: result.rows.length });
    } catch (error) {
      request.log.error(error, 'GET combat-styles/stats error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch stats' });
    }
  });

  // ── POST /api/combat-styles/import ── 匯入 JSON
  app.post<{ Body: any[] }>('/api/combat-styles/import', async (request, reply) => {
    const items = request.body;
    if (!Array.isArray(items)) {
      return reply.status(400).send({ success: false, error: 'Expected JSON array of combat styles' });
    }
    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (const item of items) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Upsert combat style by code
        const styleRes = await client.query(`
          INSERT INTO combat_styles (code, name_zh, name_en, description_zh, description_en, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (code) DO UPDATE SET
            name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en,
            description_zh = EXCLUDED.description_zh, description_en = EXCLUDED.description_en,
            sort_order = EXCLUDED.sort_order, updated_at = NOW()
          RETURNING id
        `, [item.code, item.name_zh, item.name_en, item.description_zh || null, item.description_en || null, item.sort_order || 0]);
        const styleId = styleRes.rows[0].id;

        // Import specializations
        if (Array.isArray(item.specializations)) {
          for (const sp of item.specializations) {
            await client.query(`
              INSERT INTO specializations (combat_style_id, code, name_zh, name_en, attribute, prof_bonus, spec_bonus, description_zh, description_en)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              ON CONFLICT (code) DO UPDATE SET
                name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en,
                attribute = EXCLUDED.attribute, prof_bonus = EXCLUDED.prof_bonus,
                spec_bonus = EXCLUDED.spec_bonus, description_zh = EXCLUDED.description_zh,
                description_en = EXCLUDED.description_en, updated_at = NOW()
            `, [styleId, sp.code, sp.name_zh, sp.name_en, sp.attribute || null, sp.prof_bonus || 0, sp.spec_bonus || 0, sp.description_zh || null, sp.description_en || null]);
          }
        }

        // Import style cards
        if (Array.isArray(item.style_cards)) {
          for (const sc of item.style_cards) {
            await client.query(`
              INSERT INTO combat_style_cards (combat_style_id, code, name_zh, name_en, check_attribute, narrative_attack_zh, narrative_attack_en, narrative_success_zh, narrative_success_en, narrative_fail_zh, narrative_fail_en)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (code) DO UPDATE SET
                name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en,
                check_attribute = EXCLUDED.check_attribute,
                narrative_attack_zh = EXCLUDED.narrative_attack_zh, narrative_attack_en = EXCLUDED.narrative_attack_en,
                narrative_success_zh = EXCLUDED.narrative_success_zh, narrative_success_en = EXCLUDED.narrative_success_en,
                narrative_fail_zh = EXCLUDED.narrative_fail_zh, narrative_fail_en = EXCLUDED.narrative_fail_en,
                updated_at = NOW()
            `, [styleId, sc.code, sc.name_zh, sc.name_en, sc.check_attribute || null, sc.narrative_attack_zh || null, sc.narrative_attack_en || null, sc.narrative_success_zh || null, sc.narrative_success_en || null, sc.narrative_fail_zh || null, sc.narrative_fail_en || null]);
          }
        }

        // Update counts
        await updateStyleCounts(client, styleId);
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
  //  戰鬥風格 CRUD
  // ════════════════════════════════════════════

  // ── GET /api/combat-styles ── 列出所有風格
  app.get('/api/combat-styles', async (request, reply) => {
    try {
      const result = await pool.query(`
        SELECT cs.*,
          (SELECT COUNT(*) FROM combat_style_cards csc WHERE csc.combat_style_id = cs.id)::int AS card_count
        FROM combat_styles cs
        ORDER BY cs.sort_order, cs.code
      `);
      return reply.send({ success: true, data: result.rows, total: result.rows.length });
    } catch (error) {
      request.log.error(error, 'GET /api/combat-styles error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch combat styles' });
    }
  });

  // ── GET /api/combat-styles/:id ── 單一風格 + 專精 + 風格卡
  app.get<{ Params: { id: string } }>('/api/combat-styles/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const style = await pool.query('SELECT * FROM combat_styles WHERE id = $1', [id]);
      if (style.rows.length === 0) return reply.status(404).send({ success: false, error: 'Combat style not found' });

      const specs = await pool.query('SELECT * FROM specializations WHERE combat_style_id = $1 ORDER BY code', [id]);
      const cards = await pool.query('SELECT * FROM combat_style_cards WHERE combat_style_id = $1 ORDER BY code', [id]);

      return reply.send({
        success: true,
        data: { ...style.rows[0], specializations: specs.rows, style_cards: cards.rows },
      });
    } catch (error) {
      request.log.error(error, 'GET combat-style error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch combat style' });
    }
  });

  // ── POST /api/combat-styles ── 新增風格
  app.post<{ Body: Record<string, any> }>('/api/combat-styles', async (request, reply) => {
    const b = request.body;
    try {
      const result = await pool.query(`
        INSERT INTO combat_styles (code, name_zh, name_en, description_zh, description_en, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [b.code, b.name_zh, b.name_en, b.description_zh || null, b.description_en || null, b.sort_order || 0]);
      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      request.log.error(error, 'POST combat-style error');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: 'Combat style code already exists' });
      return reply.status(500).send({ success: false, error: 'Failed to create combat style' });
    }
  });

  // ── PUT /api/combat-styles/:id ── 更新風格
  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/combat-styles/:id', async (request, reply) => {
    const { id } = request.params;
    const b = request.body;
    try {
      const result = await pool.query(`
        UPDATE combat_styles SET
          name_zh = $1, name_en = $2, description_zh = $3, description_en = $4, sort_order = $5,
          updated_at = NOW()
        WHERE id = $6 RETURNING *
      `, [b.name_zh, b.name_en, b.description_zh || null, b.description_en || null, b.sort_order || 0, id]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Combat style not found' });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT combat-style error');
      return reply.status(500).send({ success: false, error: 'Failed to update combat style' });
    }
  });

  // ── DELETE /api/combat-styles/:id ── 刪除（CASCADE）
  app.delete<{ Params: { id: string } }>('/api/combat-styles/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const result = await pool.query('DELETE FROM combat_styles WHERE id = $1 RETURNING id, code', [id]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Combat style not found' });
      return reply.send({ success: true, data: { deleted: result.rows[0] } });
    } catch (error) {
      request.log.error(error, 'DELETE combat-style error');
      return reply.status(500).send({ success: false, error: 'Failed to delete combat style' });
    }
  });

  // ════════════════════════════════════════════
  //  專精 CRUD
  // ════════════════════════════════════════════

  // ── GET /api/combat-styles/:styleId/specs ── 某風格下所有專精
  app.get<{ Params: { styleId: string } }>('/api/combat-styles/:styleId/specs', async (request, reply) => {
    const { styleId } = request.params;
    try {
      const result = await pool.query('SELECT * FROM specializations WHERE combat_style_id = $1 ORDER BY code', [styleId]);
      return reply.send({ success: true, data: result.rows, total: result.rows.length });
    } catch (error) {
      request.log.error(error, 'GET specs error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch specializations' });
    }
  });

  // ── POST /api/combat-styles/:styleId/specs ── 新增專精
  app.post<{ Params: { styleId: string }; Body: Record<string, any> }>('/api/combat-styles/:styleId/specs', async (request, reply) => {
    const { styleId } = request.params;
    const b = request.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(`
        INSERT INTO specializations (combat_style_id, code, name_zh, name_en, attribute, prof_bonus, spec_bonus, description_zh, description_en)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [styleId, b.code, b.name_zh, b.name_en, b.attribute || null, b.prof_bonus || 0, b.spec_bonus || 0, b.description_zh || null, b.description_en || null]);

      // 更新 spec_count
      await client.query(`
        UPDATE combat_styles SET spec_count = (SELECT COUNT(*) FROM specializations WHERE combat_style_id = $1)::int, updated_at = NOW()
        WHERE id = $1
      `, [styleId]);

      await client.query('COMMIT');
      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      await client.query('ROLLBACK');
      request.log.error(error, 'POST spec error');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: 'Specialization code already exists' });
      return reply.status(500).send({ success: false, error: 'Failed to create specialization' });
    } finally {
      client.release();
    }
  });

  // ── PUT /api/specs/:id ── 更新專精
  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/specs/:id', async (request, reply) => {
    const { id } = request.params;
    const b = request.body;
    try {
      const result = await pool.query(`
        UPDATE specializations SET
          name_zh = $1, name_en = $2, attribute = $3, prof_bonus = $4, spec_bonus = $5,
          description_zh = $6, description_en = $7, updated_at = NOW()
        WHERE id = $8 RETURNING *
      `, [b.name_zh, b.name_en, b.attribute || null, b.prof_bonus || 0, b.spec_bonus || 0, b.description_zh || null, b.description_en || null, id]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Specialization not found' });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT spec error');
      return reply.status(500).send({ success: false, error: 'Failed to update specialization' });
    }
  });

  // ── DELETE /api/specs/:id ── 刪除專精，更新 spec_count
  app.delete<{ Params: { id: string } }>('/api/specs/:id', async (request, reply) => {
    const { id } = request.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 先查出 combat_style_id
      const spec = await client.query('SELECT combat_style_id FROM specializations WHERE id = $1', [id]);
      if (spec.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ success: false, error: 'Specialization not found' });
      }
      const styleId = spec.rows[0].combat_style_id;

      await client.query('DELETE FROM specializations WHERE id = $1', [id]);

      // 更新 spec_count
      await client.query(`
        UPDATE combat_styles SET spec_count = (SELECT COUNT(*) FROM specializations WHERE combat_style_id = $1)::int, updated_at = NOW()
        WHERE id = $1
      `, [styleId]);

      await client.query('COMMIT');
      return reply.send({ success: true, data: { deleted: id } });
    } catch (error) {
      await client.query('ROLLBACK');
      request.log.error(error, 'DELETE spec error');
      return reply.status(500).send({ success: false, error: 'Failed to delete specialization' });
    } finally {
      client.release();
    }
  });

  // ════════════════════════════════════════════
  //  風格卡 CRUD
  // ════════════════════════════════════════════

  // ── GET /api/combat-styles/:styleId/cards ── 某風格下所有風格卡
  app.get<{ Params: { styleId: string } }>('/api/combat-styles/:styleId/cards', async (request, reply) => {
    const { styleId } = request.params;
    try {
      const result = await pool.query('SELECT * FROM combat_style_cards WHERE combat_style_id = $1 ORDER BY code', [styleId]);
      return reply.send({ success: true, data: result.rows, total: result.rows.length });
    } catch (error) {
      request.log.error(error, 'GET style-cards error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch style cards' });
    }
  });

  // ── POST /api/combat-styles/:styleId/cards ── 新增風格卡（code 自動生成）
  app.post<{ Params: { styleId: string }; Body: Record<string, any> }>('/api/combat-styles/:styleId/cards', async (request, reply) => {
    const { styleId } = request.params;
    const b = request.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 查 style 的 code
      const styleRes = await client.query('SELECT code FROM combat_styles WHERE id = $1', [styleId]);
      if (styleRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ success: false, error: 'Combat style not found' });
      }
      const styleCode = styleRes.rows[0].code;

      // 查最大流水號
      const prefix = `${styleCode}_card_`;
      const maxRes = await client.query(
        `SELECT code FROM combat_style_cards WHERE combat_style_id = $1 AND code LIKE $2 ORDER BY code DESC LIMIT 1`,
        [styleId, `${prefix}%`]
      );
      let nextNum = 1;
      if (maxRes.rows.length > 0) {
        const lastCode = maxRes.rows[0].code;
        const numPart = lastCode.substring(prefix.length);
        nextNum = parseInt(numPart, 10) + 1;
      }
      const code = `${prefix}${String(nextNum).padStart(2, '0')}`;

      const result = await client.query(`
        INSERT INTO combat_style_cards (
          combat_style_id, code, name_zh, name_en, check_attribute,
          narrative_attack_zh, narrative_attack_en,
          narrative_success_zh, narrative_success_en,
          narrative_fail_zh, narrative_fail_en
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `, [
        styleId, code, b.name_zh, b.name_en, b.check_attribute || null,
        b.narrative_attack_zh || null, b.narrative_attack_en || null,
        b.narrative_success_zh || null, b.narrative_success_en || null,
        b.narrative_fail_zh || null, b.narrative_fail_en || null,
      ]);

      await client.query('COMMIT');
      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      await client.query('ROLLBACK');
      request.log.error(error, 'POST style-card error');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: 'Style card code conflict, please retry' });
      return reply.status(500).send({ success: false, error: 'Failed to create style card' });
    } finally {
      client.release();
    }
  });

  // ── PUT /api/style-cards/:id ── 更新風格卡
  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/style-cards/:id', async (request, reply) => {
    const { id } = request.params;
    const b = request.body;
    try {
      const result = await pool.query(`
        UPDATE combat_style_cards SET
          name_zh = $1, name_en = $2, check_attribute = $3,
          narrative_attack_zh = $4, narrative_attack_en = $5,
          narrative_success_zh = $6, narrative_success_en = $7,
          narrative_fail_zh = $8, narrative_fail_en = $9,
          updated_at = NOW()
        WHERE id = $10 RETURNING *
      `, [
        b.name_zh, b.name_en, b.check_attribute || null,
        b.narrative_attack_zh || null, b.narrative_attack_en || null,
        b.narrative_success_zh || null, b.narrative_success_en || null,
        b.narrative_fail_zh || null, b.narrative_fail_en || null,
        id,
      ]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Style card not found' });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT style-card error');
      return reply.status(500).send({ success: false, error: 'Failed to update style card' });
    }
  });

  // ── DELETE /api/style-cards/:id ── 刪除風格卡
  app.delete<{ Params: { id: string } }>('/api/style-cards/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const result = await pool.query('DELETE FROM combat_style_cards WHERE id = $1 RETURNING id, code', [id]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Style card not found' });
      return reply.send({ success: true, data: { deleted: result.rows[0] } });
    } catch (error) {
      request.log.error(error, 'DELETE style-card error');
      return reply.status(500).send({ success: false, error: 'Failed to delete style card' });
    }
  });
};

// ── Helper: 更新某個風格的 spec_count
async function updateStyleCounts(client: any, styleId: string) {
  await client.query(`
    UPDATE combat_styles SET
      spec_count = (SELECT COUNT(*) FROM specializations WHERE combat_style_id = $1)::int,
      updated_at = NOW()
    WHERE id = $1
  `, [styleId]);
}
