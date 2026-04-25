import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { requireAuth, requireAdminRole } from '../middleware/auth.js';

const TIER_MODES = ['scaling', 'fixed', 'choice'] as const;
const DESIGN_STATUSES = ['pending', 'partial', 'complete'] as const;

function getSV(level: number): number {
  if (level <= 2) return 1;
  if (level <= 4) return 2;
  if (level <= 6) return 3;
  if (level <= 8) return 5;
  return 8;
}

function validateAffixTiers(affix: { tier_mode: string }, tiers: Array<{ tier_label: string; affix_value: number | string; choice_payload: unknown }>) {
  const errors: string[] = [];
  const warnings: string[] = [];
  switch (affix.tier_mode) {
    case 'scaling': {
      if (tiers.length !== 3) errors.push(`scaling 模式需要 3 個 tier，目前 ${tiers.length}`);
      const labels = [...tiers.map((t) => t.tier_label)].sort();
      const expected = ['+1', '+2', '+3'];
      if (JSON.stringify(labels) !== JSON.stringify(expected)) {
        errors.push('scaling 模式的 tier_label 必須為 +1/+2/+3');
      }
      break;
    }
    case 'fixed':
      if (tiers.length !== 1) errors.push(`fixed 模式必須恰好 1 個 tier，目前 ${tiers.length}`);
      break;
    case 'choice':
      if (tiers.length < 2) errors.push(`choice 模式至少需要 2 個選項，目前 ${tiers.length}`);
      tiers.forEach((t) => {
        if (!t.choice_payload || (typeof t.choice_payload === 'object' && Object.keys(t.choice_payload as object).length === 0)) {
          warnings.push(`choice tier "${t.tier_label}" 缺少 choice_payload`);
        }
      });
      break;
  }
  tiers.forEach((t) => {
    const v = typeof t.affix_value === 'string' ? parseFloat(t.affix_value) : t.affix_value;
    if (!(v > 0)) errors.push(`tier "${t.tier_label}" 的 V 值必須 > 0（目前 ${t.affix_value}）`);
  });
  return { isValid: errors.length === 0, errors, warnings };
}

export const forgeCraftRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // ============================================================
  // 素材類別
  // ============================================================
  app.get('/api/materials/categories', async (_request, reply) => {
    try {
      const result = await pool.query('SELECT * FROM material_categories ORDER BY sort_order ASC');
      return reply.send({ success: true, data: result.rows });
    } catch (error) {
      _request.log.error(error, 'GET /api/materials/categories error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch categories' });
    }
  });

  // ============================================================
  // 素材：注意路由順序 — 特殊路徑必須在 /:id 之前
  // ============================================================
  app.get<{ Params: { monster_family_id: string } }>(
    '/api/materials/by-family/:monster_family_id',
    async (request, reply) => {
      try {
        const result = await pool.query(
          `SELECT * FROM material_definitions WHERE monster_family_id = $1 ORDER BY material_level ASC, sort_order ASC`,
          [request.params.monster_family_id]
        );
        return reply.send({ success: true, data: result.rows });
      } catch (error) {
        request.log.error(error, 'GET materials/by-family error');
        return reply.status(500).send({ success: false, error: 'Failed to fetch materials' });
      }
    }
  );

  app.get<{ Querystring: { category?: string; level?: string; search?: string } }>(
    '/api/materials',
    async (request, reply) => {
      const { category, level, search } = request.query;
      const conditions: string[] = [];
      const params: unknown[] = [];
      let pi = 1;
      if (category) { conditions.push(`category_code = $${pi++}`); params.push(category); }
      if (level) { conditions.push(`material_level = $${pi++}`); params.push(parseInt(level, 10)); }
      if (search) {
        conditions.push(`(name_zh ILIKE $${pi} OR name_en ILIKE $${pi})`);
        params.push(`%${search}%`);
        pi++;
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      try {
        const result = await pool.query(
          `SELECT * FROM material_definitions ${where} ORDER BY category_code, material_level, sort_order ASC`,
          params
        );
        return reply.send({ success: true, data: result.rows, total: result.rows.length });
      } catch (error) {
        request.log.error(error, 'GET /api/materials error');
        return reply.status(500).send({ success: false, error: 'Failed to fetch materials' });
      }
    }
  );

  app.get<{ Params: { id: string } }>('/api/materials/:id', async (request, reply) => {
    try {
      const result = await pool.query('SELECT * FROM material_definitions WHERE id = $1', [request.params.id]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Material not found' });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'GET material error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch material' });
    }
  });

  app.post<{ Body: Record<string, any> }>('/api/materials', async (request, reply) => {
    const b = request.body;
    if (!b.category_code || !b.material_level) {
      return reply.status(400).send({ success: false, error: 'category_code 與 material_level 為必填' });
    }
    try {
      const result = await pool.query(
        `INSERT INTO material_definitions (category_code, material_level, name_zh, name_en, monster_family_id, description, flavor_text, icon_url, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          b.category_code,
          b.material_level,
          b.name_zh || '',
          b.name_en || null,
          b.monster_family_id || null,
          b.description || null,
          b.flavor_text || null,
          b.icon_url || null,
          b.sort_order ?? 0,
        ]
      );
      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'POST material error');
      return reply.status(500).send({ success: false, error: 'Failed to create material' });
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, any> }>('/api/materials/:id', async (request, reply) => {
    const { id } = request.params;
    const b = request.body;
    const fields: string[] = [];
    const params: unknown[] = [];
    let pi = 1;
    for (const k of ['material_level', 'name_zh', 'name_en', 'monster_family_id', 'description', 'flavor_text', 'icon_url', 'sort_order']) {
      if (k in b) { fields.push(`${k} = $${pi++}`); params.push(b[k]); }
    }
    if (!fields.length) return reply.status(400).send({ success: false, error: '無可更新欄位' });
    fields.push(`updated_at = NOW()`);
    params.push(id);
    try {
      const result = await pool.query(`UPDATE material_definitions SET ${fields.join(', ')} WHERE id = $${pi} RETURNING *`, params);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Material not found' });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PATCH material error');
      return reply.status(500).send({ success: false, error: 'Failed to update material' });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/materials/:id', { preHandler: requireAdminRole }, async (request, reply) => {
    try {
      const refCheck = await pool.query(
        'SELECT 1 FROM crafting_recipe_materials WHERE specific_material_id = $1 LIMIT 1',
        [request.params.id]
      );
      if (refCheck.rows.length > 0) {
        return reply.status(409).send({ success: false, error: '此素材已被配方引用，無法刪除' });
      }
      const result = await pool.query('DELETE FROM material_definitions WHERE id = $1 RETURNING id', [request.params.id]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Material not found' });
      return reply.send({ success: true, data: { id: request.params.id } });
    } catch (error) {
      request.log.error(error, 'DELETE material error');
      return reply.status(500).send({ success: false, error: 'Failed to delete material' });
    }
  });

  // ============================================================
  // 鍛造詞條
  // ============================================================
  app.get<{ Querystring: { category?: string; status?: string; tier_mode?: string; search?: string } }>(
    '/api/affixes',
    async (request, reply) => {
      const { category, status, tier_mode, search } = request.query;
      const conditions: string[] = [];
      const params: unknown[] = [];
      let pi = 1;
      if (category) { conditions.push(`a.category_code = $${pi++}`); params.push(category); }
      if (status) { conditions.push(`a.design_status = $${pi++}`); params.push(status); }
      if (tier_mode) { conditions.push(`a.tier_mode = $${pi++}`); params.push(tier_mode); }
      if (search) {
        conditions.push(`(a.name_zh ILIKE $${pi} OR a.name_en ILIKE $${pi} OR a.code ILIKE $${pi})`);
        params.push(`%${search}%`);
        pi++;
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      try {
        const result = await pool.query(
          `SELECT a.*,
            COALESCE(json_agg(t.* ORDER BY t.tier_order) FILTER (WHERE t.id IS NOT NULL), '[]') AS tiers
           FROM forging_affixes a
           LEFT JOIN forging_affix_tiers t ON t.affix_id = a.id
           ${where}
           GROUP BY a.id
           ORDER BY a.category_code, a.sort_order, a.code`,
          params
        );
        return reply.send({ success: true, data: result.rows, total: result.rows.length });
      } catch (error) {
        request.log.error(error, 'GET /api/affixes error');
        return reply.status(500).send({ success: false, error: 'Failed to fetch affixes' });
      }
    }
  );

  app.get<{ Params: { id: string } }>('/api/affixes/:id', async (request, reply) => {
    try {
      const affix = await pool.query('SELECT * FROM forging_affixes WHERE id = $1', [request.params.id]);
      if (affix.rows.length === 0) return reply.status(404).send({ success: false, error: 'Affix not found' });
      const tiers = await pool.query('SELECT * FROM forging_affix_tiers WHERE affix_id = $1 ORDER BY tier_order', [request.params.id]);
      return reply.send({ success: true, data: { ...affix.rows[0], tiers: tiers.rows } });
    } catch (error) {
      request.log.error(error, 'GET affix error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch affix' });
    }
  });

  app.post<{ Body: Record<string, any> }>('/api/affixes', async (request, reply) => {
    const b = request.body;
    if (!b.code || !b.name_zh || !b.category_code || !b.effect_description_zh) {
      return reply.status(400).send({ success: false, error: 'code/name_zh/category_code/effect_description_zh 為必填' });
    }
    if (b.tier_mode && !TIER_MODES.includes(b.tier_mode)) {
      return reply.status(400).send({ success: false, error: `tier_mode 必須為 ${TIER_MODES.join('/')}` });
    }
    try {
      const result = await pool.query(
        `INSERT INTO forging_affixes (code, name_zh, name_en, category_code, effect_description_zh, effect_description_en, applicable_subtypes, tier_mode, design_status, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          b.code,
          b.name_zh,
          b.name_en || null,
          b.category_code,
          b.effect_description_zh,
          b.effect_description_en || null,
          JSON.stringify(b.applicable_subtypes || []),
          b.tier_mode || 'scaling',
          b.design_status || 'pending',
          b.notes || null,
          b.sort_order ?? 0,
        ]
      );
      return reply.status(201).send({ success: true, data: { ...result.rows[0], tiers: [] } });
    } catch (error: any) {
      request.log.error(error, 'POST affix error');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: '詞條 code 已存在' });
      return reply.status(500).send({ success: false, error: 'Failed to create affix' });
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, any> }>('/api/affixes/:id', async (request, reply) => {
    const { id } = request.params;
    const b = request.body;
    const fields: string[] = [];
    const params: unknown[] = [];
    let pi = 1;
    const simple = ['name_zh', 'name_en', 'category_code', 'effect_description_zh', 'effect_description_en', 'tier_mode', 'design_status', 'notes', 'sort_order'] as const;
    for (const k of simple) {
      if (k in b) { fields.push(`${k} = $${pi++}`); params.push(b[k]); }
    }
    if ('applicable_subtypes' in b) {
      fields.push(`applicable_subtypes = $${pi++}`);
      params.push(JSON.stringify(b.applicable_subtypes));
    }
    if (!fields.length) return reply.status(400).send({ success: false, error: '無可更新欄位' });
    fields.push(`updated_at = NOW()`);
    params.push(id);
    try {
      const result = await pool.query(`UPDATE forging_affixes SET ${fields.join(', ')} WHERE id = $${pi} RETURNING *`, params);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Affix not found' });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PATCH affix error');
      return reply.status(500).send({ success: false, error: 'Failed to update affix' });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/affixes/:id', { preHandler: requireAdminRole }, async (request, reply) => {
    try {
      const result = await pool.query('DELETE FROM forging_affixes WHERE id = $1 RETURNING id', [request.params.id]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Affix not found' });
      return reply.send({ success: true, data: { id: request.params.id } });
    } catch (error) {
      request.log.error(error, 'DELETE affix error');
      return reply.status(500).send({ success: false, error: 'Failed to delete affix' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/affixes/:id/validate', async (request, reply) => {
    try {
      const affix = await pool.query('SELECT * FROM forging_affixes WHERE id = $1', [request.params.id]);
      if (affix.rows.length === 0) return reply.status(404).send({ success: false, error: 'Affix not found' });
      const tiers = await pool.query('SELECT * FROM forging_affix_tiers WHERE affix_id = $1', [request.params.id]);
      const validation = validateAffixTiers(affix.rows[0], tiers.rows);
      const subtypes = affix.rows[0].applicable_subtypes;
      if (!Array.isArray(subtypes) || subtypes.length === 0) {
        validation.errors.push('applicable_subtypes 不可為空');
        validation.isValid = false;
      }
      return reply.send({ success: true, data: validation });
    } catch (error) {
      request.log.error(error, 'validate affix error');
      return reply.status(500).send({ success: false, error: 'Failed to validate affix' });
    }
  });

  // ── 詞條階級 tiers ────────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, any> }>('/api/affixes/:id/tiers', async (request, reply) => {
    const { id } = request.params;
    const b = request.body;
    if (!b.tier_label || b.affix_value === undefined) {
      return reply.status(400).send({ success: false, error: 'tier_label 與 affix_value 為必填' });
    }
    try {
      const result = await pool.query(
        `INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, effect_detail_en, choice_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          id,
          b.tier_label,
          b.tier_order ?? 0,
          b.affix_value,
          b.effect_detail_zh || null,
          b.effect_detail_en || null,
          b.choice_payload ? JSON.stringify(b.choice_payload) : null,
        ]
      );
      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      request.log.error(error, 'POST tier error');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: 'tier_label 已存在於此詞條' });
      return reply.status(500).send({ success: false, error: 'Failed to create tier' });
    }
  });

  app.patch<{ Params: { id: string; tier_id: string }; Body: Record<string, any> }>(
    '/api/affixes/:id/tiers/:tier_id',
    async (request, reply) => {
      const { tier_id } = request.params;
      const b = request.body;
      const fields: string[] = [];
      const params: unknown[] = [];
      let pi = 1;
      for (const k of ['tier_label', 'tier_order', 'affix_value', 'effect_detail_zh', 'effect_detail_en'] as const) {
        if (k in b) { fields.push(`${k} = $${pi++}`); params.push(b[k]); }
      }
      if ('choice_payload' in b) {
        fields.push(`choice_payload = $${pi++}`);
        params.push(b.choice_payload === null ? null : JSON.stringify(b.choice_payload));
      }
      if (!fields.length) return reply.status(400).send({ success: false, error: '無可更新欄位' });
      fields.push(`updated_at = NOW()`);
      params.push(tier_id);
      try {
        const result = await pool.query(`UPDATE forging_affix_tiers SET ${fields.join(', ')} WHERE id = $${pi} RETURNING *`, params);
        if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Tier not found' });
        return reply.send({ success: true, data: result.rows[0] });
      } catch (error) {
        request.log.error(error, 'PATCH tier error');
        return reply.status(500).send({ success: false, error: 'Failed to update tier' });
      }
    }
  );

  app.delete<{ Params: { id: string; tier_id: string } }>('/api/affixes/:id/tiers/:tier_id', { preHandler: requireAdminRole }, async (request, reply) => {
    try {
      const result = await pool.query('DELETE FROM forging_affix_tiers WHERE id = $1 RETURNING id', [request.params.tier_id]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Tier not found' });
      return reply.send({ success: true, data: { id: request.params.tier_id } });
    } catch (error) {
      request.log.error(error, 'DELETE tier error');
      return reply.status(500).send({ success: false, error: 'Failed to delete tier' });
    }
  });

  // ============================================================
  // 鍛造費用試算
  // ============================================================
  app.get<{ Querystring: { tier_id: string; material_level: string } }>(
    '/api/forging/preview',
    async (request, reply) => {
      const { tier_id, material_level } = request.query;
      if (!tier_id || !material_level) {
        return reply.status(400).send({ success: false, error: 'tier_id 與 material_level 為必填' });
      }
      try {
        const result = await pool.query(
          `SELECT * FROM preview_forging_cost($1::UUID, $2::INTEGER)`,
          [tier_id, parseInt(material_level, 10)]
        );
        if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Tier not found' });
        return reply.send({ success: true, data: result.rows[0] });
      } catch (error) {
        request.log.error(error, 'preview error');
        return reply.status(500).send({ success: false, error: 'Failed to preview' });
      }
    }
  );

  app.post<{ Body: { tier_ids: string[]; material_levels: number[] } }>(
    '/api/forging/batch-preview',
    async (request, reply) => {
      const { tier_ids, material_levels } = request.body;
      if (!Array.isArray(tier_ids) || !Array.isArray(material_levels) || tier_ids.length === 0 || material_levels.length === 0) {
        return reply.status(400).send({ success: false, error: 'tier_ids 與 material_levels 必須為非空陣列' });
      }
      try {
        const tiers = await pool.query(
          `SELECT fat.id, fat.tier_label, fat.affix_value, fa.name_zh AS affix_name, fa.code AS affix_code
           FROM forging_affix_tiers fat JOIN forging_affixes fa ON fa.id = fat.affix_id
           WHERE fat.id = ANY($1::UUID[])`,
          [tier_ids]
        );
        const matrix = tiers.rows.map((t) => ({
          tier_id: t.id,
          tier_label: t.tier_label,
          affix_name: t.affix_name,
          affix_code: t.affix_code,
          affix_value: t.affix_value,
          costs: material_levels.map((lv) => ({
            material_level: lv,
            sv: getSV(lv),
            required_quantity: Math.ceil(parseFloat(t.affix_value) / getSV(lv)),
          })),
        }));
        return reply.send({ success: true, data: { matrix, material_levels } });
      } catch (error) {
        request.log.error(error, 'batch-preview error');
        return reply.status(500).send({ success: false, error: 'Failed to batch preview' });
      }
    }
  );

  app.get('/api/forging/stats', async (_request, reply) => {
    try {
      const r1 = await pool.query(
        `SELECT category_code, COUNT(*)::INTEGER AS n FROM forging_affixes GROUP BY category_code`
      );
      const r2 = await pool.query(
        `SELECT design_status, COUNT(*)::INTEGER AS n FROM forging_affixes GROUP BY design_status`
      );
      const r3 = await pool.query(`SELECT COUNT(*)::INTEGER AS total FROM forging_affixes`);
      const r4 = await pool.query(`SELECT COUNT(*)::INTEGER AS total FROM forging_affix_tiers`);
      const byCategory = Object.fromEntries(r1.rows.map((r) => [r.category_code, r.n]));
      const byStatus = Object.fromEntries(r2.rows.map((r) => [r.design_status, r.n]));
      return reply.send({
        success: true,
        data: {
          totalAffixes: r3.rows[0].total,
          totalTiers: r4.rows[0].total,
          byCategory,
          byStatus,
        },
      });
    } catch (error) {
      _request.log.error(error, 'forging stats error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch stats' });
    }
  });

  // ============================================================
  // 製作配方
  // ============================================================
  app.get<{ Querystring: { unlock_type?: string; status?: string; search?: string } }>(
    '/api/recipes',
    async (request, reply) => {
      const { unlock_type, status, search } = request.query;
      const conditions: string[] = [];
      const params: unknown[] = [];
      let pi = 1;
      if (unlock_type) { conditions.push(`r.unlock_type = $${pi++}`); params.push(unlock_type); }
      if (status) { conditions.push(`r.design_status = $${pi++}`); params.push(status); }
      if (search) {
        conditions.push(`(r.name_zh ILIKE $${pi} OR r.name_en ILIKE $${pi} OR r.code ILIKE $${pi})`);
        params.push(`%${search}%`);
        pi++;
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      try {
        const result = await pool.query(
          `SELECT r.*,
            COALESCE(json_agg(m.* ORDER BY m.sort_order) FILTER (WHERE m.id IS NOT NULL), '[]') AS materials
           FROM crafting_recipes r
           LEFT JOIN crafting_recipe_materials m ON m.recipe_id = r.id
           ${where}
           GROUP BY r.id
           ORDER BY r.sort_order, r.code`,
          params
        );
        return reply.send({ success: true, data: result.rows, total: result.rows.length });
      } catch (error) {
        request.log.error(error, 'GET recipes error');
        return reply.status(500).send({ success: false, error: 'Failed to fetch recipes' });
      }
    }
  );

  app.get<{ Params: { id: string } }>('/api/recipes/:id', async (request, reply) => {
    try {
      const recipe = await pool.query('SELECT * FROM crafting_recipes WHERE id = $1', [request.params.id]);
      if (recipe.rows.length === 0) return reply.status(404).send({ success: false, error: 'Recipe not found' });
      const mats = await pool.query('SELECT * FROM crafting_recipe_materials WHERE recipe_id = $1 ORDER BY sort_order', [request.params.id]);
      return reply.send({ success: true, data: { ...recipe.rows[0], materials: mats.rows } });
    } catch (error) {
      request.log.error(error, 'GET recipe error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch recipe' });
    }
  });

  app.post<{ Body: Record<string, any> }>('/api/recipes', async (request, reply) => {
    const b = request.body;
    if (!b.code || !b.name_zh) {
      return reply.status(400).send({ success: false, error: 'code 與 name_zh 為必填' });
    }
    try {
      const result = await pool.query(
        `INSERT INTO crafting_recipes (code, name_zh, name_en, description, output_card_id, output_is_temporary, output_quantity, unlock_narrative, unlock_type, design_status, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          b.code,
          b.name_zh,
          b.name_en || null,
          b.description || null,
          b.output_card_id || null,
          b.output_is_temporary || false,
          b.output_quantity ?? 1,
          b.unlock_narrative || null,
          b.unlock_type || null,
          b.design_status || 'pending',
          b.notes || null,
          b.sort_order ?? 0,
        ]
      );
      return reply.status(201).send({ success: true, data: { ...result.rows[0], materials: [] } });
    } catch (error: any) {
      request.log.error(error, 'POST recipe error');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: '配方 code 已存在' });
      return reply.status(500).send({ success: false, error: 'Failed to create recipe' });
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, any> }>('/api/recipes/:id', async (request, reply) => {
    const { id } = request.params;
    const b = request.body;
    const fields: string[] = [];
    const params: unknown[] = [];
    let pi = 1;
    const simple = ['name_zh', 'name_en', 'description', 'output_card_id', 'output_is_temporary', 'output_quantity', 'unlock_narrative', 'unlock_type', 'design_status', 'notes', 'sort_order'] as const;
    for (const k of simple) {
      if (k in b) { fields.push(`${k} = $${pi++}`); params.push(b[k]); }
    }
    if (!fields.length) return reply.status(400).send({ success: false, error: '無可更新欄位' });
    fields.push(`updated_at = NOW()`);
    params.push(id);
    try {
      const result = await pool.query(`UPDATE crafting_recipes SET ${fields.join(', ')} WHERE id = $${pi} RETURNING *`, params);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Recipe not found' });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PATCH recipe error');
      return reply.status(500).send({ success: false, error: 'Failed to update recipe' });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/recipes/:id', { preHandler: requireAdminRole }, async (request, reply) => {
    try {
      const result = await pool.query('DELETE FROM crafting_recipes WHERE id = $1 RETURNING id', [request.params.id]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Recipe not found' });
      return reply.send({ success: true, data: { id: request.params.id } });
    } catch (error) {
      request.log.error(error, 'DELETE recipe error');
      return reply.status(500).send({ success: false, error: 'Failed to delete recipe' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/recipes/:id/validate', async (request, reply) => {
    try {
      const recipe = await pool.query('SELECT * FROM crafting_recipes WHERE id = $1', [request.params.id]);
      if (recipe.rows.length === 0) return reply.status(404).send({ success: false, error: 'Recipe not found' });
      const mats = await pool.query('SELECT * FROM crafting_recipe_materials WHERE recipe_id = $1', [request.params.id]);
      const r = recipe.rows[0];
      const errors: string[] = [];
      const warnings: string[] = [];
      if (!r.output_card_id) errors.push('尚未指定輸出卡片');
      if (!r.name_zh || !r.name_zh.trim()) errors.push('配方名稱為空');
      if (mats.rows.length === 0) errors.push('至少需要 1 個素材需求');
      if (!r.unlock_narrative) warnings.push('未填寫解鎖敘事');
      return reply.send({ success: true, data: { isValid: errors.length === 0, errors, warnings } });
    } catch (error) {
      request.log.error(error, 'validate recipe error');
      return reply.status(500).send({ success: false, error: 'Failed to validate recipe' });
    }
  });

  // ── 配方素材需求 ────────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, any> }>('/api/recipes/:id/materials', async (request, reply) => {
    const { id } = request.params;
    const b = request.body;
    const hasCategory = !!b.category_code;
    const hasSpecific = !!b.specific_material_id;
    if (hasCategory === hasSpecific) {
      return reply.status(400).send({ success: false, error: 'category_code 與 specific_material_id 必須擇一' });
    }
    if (!b.quantity || b.quantity < 1) {
      return reply.status(400).send({ success: false, error: 'quantity 必須 >= 1' });
    }
    try {
      const result = await pool.query(
        `INSERT INTO crafting_recipe_materials (recipe_id, category_code, specific_material_id, min_material_level, quantity, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [id, b.category_code || null, b.specific_material_id || null, b.min_material_level || null, b.quantity, b.sort_order ?? 0]
      );
      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'POST recipe material error');
      return reply.status(500).send({ success: false, error: 'Failed to create recipe material' });
    }
  });

  app.patch<{ Params: { id: string; mat_id: string }; Body: Record<string, any> }>(
    '/api/recipes/:id/materials/:mat_id',
    async (request, reply) => {
      const { mat_id } = request.params;
      const b = request.body;
      const fields: string[] = [];
      const params: unknown[] = [];
      let pi = 1;
      for (const k of ['category_code', 'specific_material_id', 'min_material_level', 'quantity', 'sort_order'] as const) {
        if (k in b) { fields.push(`${k} = $${pi++}`); params.push(b[k]); }
      }
      if (!fields.length) return reply.status(400).send({ success: false, error: '無可更新欄位' });
      params.push(mat_id);
      try {
        const result = await pool.query(
          `UPDATE crafting_recipe_materials SET ${fields.join(', ')} WHERE id = $${pi} RETURNING *`,
          params
        );
        if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Material requirement not found' });
        return reply.send({ success: true, data: result.rows[0] });
      } catch (error) {
        request.log.error(error, 'PATCH recipe material error');
        return reply.status(500).send({ success: false, error: 'Failed to update recipe material' });
      }
    }
  );

  app.delete<{ Params: { id: string; mat_id: string } }>(
    '/api/recipes/:id/materials/:mat_id', { preHandler: requireAdminRole },
    async (request, reply) => {
      try {
        const result = await pool.query(
          'DELETE FROM crafting_recipe_materials WHERE id = $1 RETURNING id',
          [request.params.mat_id]
        );
        if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Material requirement not found' });
        return reply.send({ success: true, data: { id: request.params.mat_id } });
      } catch (error) {
        request.log.error(error, 'DELETE recipe material error');
        return reply.status(500).send({ success: false, error: 'Failed to delete recipe material' });
      }
    }
  );

  app.get('/api/crafting/stats', async (_request, reply) => {
    try {
      const r1 = await pool.query(`SELECT unlock_type, COUNT(*)::INTEGER AS n FROM crafting_recipes GROUP BY unlock_type`);
      const r2 = await pool.query(`SELECT design_status, COUNT(*)::INTEGER AS n FROM crafting_recipes GROUP BY design_status`);
      const r3 = await pool.query(`SELECT output_is_temporary, COUNT(*)::INTEGER AS n FROM crafting_recipes GROUP BY output_is_temporary`);
      const r4 = await pool.query(`SELECT COUNT(*)::INTEGER AS total FROM crafting_recipes`);
      const byUnlockType = Object.fromEntries(r1.rows.map((r) => [r.unlock_type || 'unspecified', r.n]));
      const byStatus = Object.fromEntries(r2.rows.map((r) => [r.design_status, r.n]));
      const byTemporary = Object.fromEntries(r3.rows.map((r) => [r.output_is_temporary ? 'temporary' : 'regular', r.n]));
      return reply.send({
        success: true,
        data: {
          totalRecipes: r4.rows[0].total,
          byUnlockType,
          byStatus,
          temporaryCount: byTemporary.temporary ?? 0,
          regularCount: byTemporary.regular ?? 0,
        },
      });
    } catch (error) {
      _request.log.error(error, 'crafting stats error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch stats' });
    }
  });
};
