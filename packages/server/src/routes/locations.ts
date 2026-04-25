import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { requireAuth, requireAdminRole } from '../middleware/auth.js';

export const locationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // ════════════════════════════════════════════
  //  輔助：同步地點的計數欄位
  // ════════════════════════════════════════════
  async function syncLocationCounts(locationId: string) {
    await pool.query(`
      UPDATE locations SET
        hidden_info_count = (SELECT COUNT(*) FROM location_hidden_info WHERE location_id = $1),
        tag_count = (SELECT COUNT(*) FROM location_tag_map WHERE location_id = $1),
        updated_at = NOW()
      WHERE id = $1
    `, [locationId]);
  }

  async function syncTagUsageCount(tagId: string) {
    await pool.query(`
      UPDATE location_style_tags SET
        usage_count = (SELECT COUNT(*) FROM location_tag_map WHERE tag_id = $1),
        updated_at = NOW()
      WHERE id = $1
    `, [tagId]);
  }

  async function syncAllTagUsageCounts() {
    await pool.query(`
      UPDATE location_style_tags SET
        usage_count = (SELECT COUNT(*) FROM location_tag_map WHERE tag_id = location_style_tags.id)
    `);
  }

  // ════════════════════════════════════════════
  //  批次操作 — 必須在 /:id 之前定義
  // ════════════════════════════════════════════

  // ── GET /api/admin/locations/stats/overview ──
  app.get('/api/admin/locations/stats/overview', async (request, reply) => {
    try {
      const totalRes = await pool.query('SELECT COUNT(*)::int AS total FROM locations');
      const byStatusRes = await pool.query(`
        SELECT design_status, COUNT(*)::int AS count FROM locations GROUP BY design_status
      `);
      const byScaleRes = await pool.query(`
        SELECT COALESCE(scale_tag, 'unset') AS scale, COUNT(*)::int AS count FROM locations GROUP BY scale_tag
      `);
      const byTagCategoryRes = await pool.query(`
        SELECT lst.category, COUNT(DISTINCT ltm.location_id)::int AS count
        FROM location_style_tags lst
        LEFT JOIN location_tag_map ltm ON ltm.tag_id = lst.id
        GROUP BY lst.category
      `);
      const totalTagsRes = await pool.query('SELECT COUNT(*)::int AS total FROM location_style_tags');
      const totalHiddenInfoRes = await pool.query('SELECT COUNT(*)::int AS total FROM location_hidden_info');
      const noArtRes = await pool.query(`SELECT COUNT(*)::int AS count FROM locations WHERE art_type = 'none'`);
      const noHiddenRes = await pool.query(`
        SELECT COUNT(*)::int AS count FROM locations
        WHERE NOT EXISTS (SELECT 1 FROM location_hidden_info WHERE location_id = locations.id)
      `);
      const noTagRes = await pool.query(`
        SELECT COUNT(*)::int AS count FROM locations
        WHERE NOT EXISTS (SELECT 1 FROM location_tag_map WHERE location_id = locations.id)
      `);

      const byStatus: Record<string, number> = { draft: 0, review: 0, approved: 0 };
      for (const r of byStatusRes.rows as any[]) byStatus[r.design_status] = r.count;

      const byScale: Record<string, number> = { room: 0, block: 0, city: 0, country: 0, unset: 0 };
      for (const r of byScaleRes.rows as any[]) {
        const k = r.scale in byScale ? r.scale : 'unset';
        byScale[k] = (byScale[k] || 0) + r.count;
      }

      const byTagCategory: Record<string, number> = { indoor: 0, outdoor: 0, special: 0, custom: 0 };
      for (const r of byTagCategoryRes.rows as any[]) byTagCategory[r.category] = r.count;

      return reply.send({
        total_locations: (totalRes.rows[0] as any).total,
        by_status: byStatus,
        by_scale: byScale,
        by_tag_category: byTagCategory,
        total_tags: (totalTagsRes.rows[0] as any).total,
        total_hidden_info: (totalHiddenInfoRes.rows[0] as any).total,
        locations_without_art: (noArtRes.rows[0] as any).count,
        locations_without_hidden_info: (noHiddenRes.rows[0] as any).count,
        locations_without_tag: (noTagRes.rows[0] as any).count,
      });
    } catch (error) {
      request.log.error(error, 'GET locations stats error');
      return reply.status(500).send({ error: 'stats_failed' });
    }
  });

  // ════════════════════════════════════════════
  //  風格標籤管理
  // ════════════════════════════════════════════

  // ── GET /api/admin/locations/tags ──
  app.get('/api/admin/locations/tags', async (request, reply) => {
    try {
      const res = await pool.query(`
        SELECT * FROM location_style_tags ORDER BY category, sort_order, name_zh
      `);
      const tags: Record<string, any[]> = { indoor: [], outdoor: [], special: [], custom: [] };
      for (const t of res.rows as any[]) {
        if (!tags[t.category]) tags[t.category] = [];
        tags[t.category].push(t);
      }
      return reply.send({ tags, total: res.rows.length });
    } catch (error) {
      request.log.error(error, 'GET tags error');
      return reply.status(500).send({ error: 'fetch_tags_failed' });
    }
  });

  // ── POST /api/admin/locations/tags ──
  app.post('/api/admin/locations/tags', async (request, reply) => {
    try {
      const body = request.body as any;
      if (!body.code || !body.name_zh || !body.category) {
        return reply.status(400).send({ error: 'missing_required', message: 'code, name_zh, category 為必填' });
      }
      const result = await pool.query(`
        INSERT INTO location_style_tags (code, name_zh, name_en, category, description, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [body.code, body.name_zh, body.name_en || '', body.category, body.description || null, body.sort_order || 99]);
      return reply.status(201).send({ tag: result.rows[0] });
    } catch (error: any) {
      if (error?.code === '23505') {
        return reply.status(409).send({ error: 'code_duplicate', message: '代碼已存在' });
      }
      request.log.error(error, 'POST tag error');
      return reply.status(500).send({ error: 'create_tag_failed' });
    }
  });

  // ── PUT /api/admin/locations/tags/:tagId ──
  app.put<{ Params: { tagId: string } }>('/api/admin/locations/tags/:tagId', async (request, reply) => {
    try {
      const { tagId } = request.params;
      const body = request.body as any;
      const result = await pool.query(`
        UPDATE location_style_tags SET
          name_zh = COALESCE($2, name_zh),
          name_en = COALESCE($3, name_en),
          category = COALESCE($4, category),
          description = $5,
          sort_order = COALESCE($6, sort_order),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [tagId, body.name_zh, body.name_en, body.category, body.description, body.sort_order]);
      if (result.rows.length === 0) return reply.status(404).send({ error: 'tag_not_found' });
      return reply.send({ tag: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT tag error');
      return reply.status(500).send({ error: 'update_tag_failed' });
    }
  });

  // ── DELETE /api/admin/locations/tags/:tagId ──
  app.delete<{ Params: { tagId: string } }>('/api/admin/locations/tags/:tagId', { preHandler: requireAdminRole }, async (request, reply) => {
    try {
      const { tagId } = request.params;
      const usingRes = await pool.query(`
        SELECT l.id, l.name_zh
        FROM location_tag_map ltm
        JOIN locations l ON l.id = ltm.location_id
        WHERE ltm.tag_id = $1
        ORDER BY l.name_zh
      `, [tagId]);

      if (usingRes.rows.length > 0) {
        return reply.status(409).send({
          error: 'tag_in_use',
          message: `此標籤被 ${usingRes.rows.length} 個地點使用，請先移除這些地點的標籤再刪除。`,
          usage_count: usingRes.rows.length,
          using_locations: usingRes.rows,
        });
      }
      const result = await pool.query('DELETE FROM location_style_tags WHERE id = $1 RETURNING id', [tagId]);
      if (result.rows.length === 0) return reply.status(404).send({ error: 'tag_not_found' });
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, 'DELETE tag error');
      return reply.status(500).send({ error: 'delete_tag_failed' });
    }
  });

  // ── PUT /api/admin/locations/:id/tags ── 整組覆寫地點的標籤
  app.put<{ Params: { id: string } }>('/api/admin/locations/:id/tags', async (request, reply) => {
    const client = await pool.connect();
    try {
      const { id } = request.params;
      const { tag_ids } = request.body as { tag_ids: string[] };
      if (!Array.isArray(tag_ids)) {
        return reply.status(400).send({ error: 'invalid_body', message: 'tag_ids 必須是陣列' });
      }
      await client.query('BEGIN');
      const oldTagsRes = await client.query('SELECT tag_id FROM location_tag_map WHERE location_id = $1', [id]);
      const oldTagIds = (oldTagsRes.rows as any[]).map(r => r.tag_id);

      await client.query('DELETE FROM location_tag_map WHERE location_id = $1', [id]);
      for (const tagId of tag_ids) {
        await client.query(
          'INSERT INTO location_tag_map (location_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, tagId]
        );
      }
      await client.query('COMMIT');

      await syncLocationCounts(id);
      const allAffected = Array.from(new Set([...oldTagIds, ...tag_ids]));
      for (const tagId of allAffected) await syncTagUsageCount(tagId);

      return reply.send({ success: true, tag_count: tag_ids.length });
    } catch (error) {
      await client.query('ROLLBACK');
      request.log.error(error, 'PUT location tags error');
      return reply.status(500).send({ error: 'update_location_tags_failed' });
    } finally {
      client.release();
    }
  });

  // ════════════════════════════════════════════
  //  隱藏資訊管理（先定義帶獨立路徑的，避免被 /:id 攔截）
  // ════════════════════════════════════════════

  // ── PUT /api/admin/locations/hidden-info/:infoId ──
  app.put<{ Params: { infoId: string } }>('/api/admin/locations/hidden-info/:infoId', async (request, reply) => {
    try {
      const { infoId } = request.params;
      const body = request.body as any;

      // 揭露條件參數驗證
      if (body.reveal_condition_type === 'perception_threshold') {
        const t = body.reveal_condition_params?.threshold;
        if (typeof t !== 'number' || t < 1 || t > 10) {
          return reply.status(400).send({ error: 'invalid_threshold', message: '感知門檻必須為 1–10' });
        }
      }
      if (body.reveal_condition_type === 'investigation_count') {
        const c = body.reveal_condition_params?.count;
        if (typeof c !== 'number' || c < 1 || c > 10) {
          return reply.status(400).send({ error: 'invalid_count', message: '調查次數必須為 1–10' });
        }
      }

      const result = await pool.query(`
        UPDATE location_hidden_info SET
          title_zh = $2,
          title_en = $3,
          description_zh = COALESCE($4, description_zh),
          description_en = $5,
          reveal_condition_type = COALESCE($6, reveal_condition_type),
          reveal_condition_params = COALESCE($7, reveal_condition_params),
          reward_type = COALESCE($8, reward_type),
          reward_params = COALESCE($9, reward_params),
          sort_order = COALESCE($10, sort_order),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [infoId, body.title_zh, body.title_en, body.description_zh, body.description_en,
          body.reveal_condition_type,
          body.reveal_condition_params ? JSON.stringify(body.reveal_condition_params) : null,
          body.reward_type,
          body.reward_params ? JSON.stringify(body.reward_params) : null,
          body.sort_order]);
      if (result.rows.length === 0) return reply.status(404).send({ error: 'hidden_info_not_found' });
      return reply.send({ hidden_info: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT hidden-info error');
      return reply.status(500).send({ error: 'update_hidden_info_failed' });
    }
  });

  // ── DELETE /api/admin/locations/hidden-info/:infoId ──
  app.delete<{ Params: { infoId: string } }>('/api/admin/locations/hidden-info/:infoId', { preHandler: requireAdminRole }, async (request, reply) => {
    try {
      const { infoId } = request.params;
      const lookupRes = await pool.query('SELECT location_id FROM location_hidden_info WHERE id = $1', [infoId]);
      if (lookupRes.rows.length === 0) return reply.status(404).send({ error: 'hidden_info_not_found' });
      const locationId = (lookupRes.rows[0] as any).location_id;
      await pool.query('DELETE FROM location_hidden_info WHERE id = $1', [infoId]);
      await syncLocationCounts(locationId);
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, 'DELETE hidden-info error');
      return reply.status(500).send({ error: 'delete_hidden_info_failed' });
    }
  });

  // ── POST /api/admin/locations/:id/hidden-info ──
  app.post<{ Params: { id: string } }>('/api/admin/locations/:id/hidden-info', async (request, reply) => {
    try {
      const { id } = request.params;
      const body = request.body as any;

      // 驗證
      if (body.reveal_condition_type === 'perception_threshold') {
        const t = body.reveal_condition_params?.threshold;
        if (typeof t !== 'number' || t < 1 || t > 10) {
          return reply.status(400).send({ error: 'invalid_threshold', message: '感知門檻必須為 1–10' });
        }
      }
      if (body.reveal_condition_type === 'investigation_count') {
        const c = body.reveal_condition_params?.count;
        if (typeof c !== 'number' || c < 1 || c > 10) {
          return reply.status(400).send({ error: 'invalid_count', message: '調查次數必須為 1–10' });
        }
      }

      const orderRes = await pool.query(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM location_hidden_info WHERE location_id = $1',
        [id]
      );
      const sortOrder = (orderRes.rows[0] as any).next_order;

      const result = await pool.query(`
        INSERT INTO location_hidden_info (
          location_id, title_zh, title_en, description_zh, description_en,
          reveal_condition_type, reveal_condition_params, reward_type, reward_params, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `, [id, body.title_zh || null, body.title_en || null,
          body.description_zh || '', body.description_en || null,
          body.reveal_condition_type || 'perception_threshold',
          JSON.stringify(body.reveal_condition_params || { threshold: 3 }),
          body.reward_type || 'narrative_only',
          JSON.stringify(body.reward_params || {}),
          sortOrder]);
      await syncLocationCounts(id);
      return reply.status(201).send({ hidden_info: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'POST hidden-info error');
      return reply.status(500).send({ error: 'create_hidden_info_failed' });
    }
  });

  // ── PUT /api/admin/locations/:id/hidden-info/reorder ──
  app.put<{ Params: { id: string } }>('/api/admin/locations/:id/hidden-info/reorder', async (request, reply) => {
    const client = await pool.connect();
    try {
      const { id } = request.params;
      const { order } = request.body as { order: string[] };
      if (!Array.isArray(order)) {
        return reply.status(400).send({ error: 'invalid_body', message: 'order 必須是 id 陣列' });
      }
      await client.query('BEGIN');
      for (let i = 0; i < order.length; i++) {
        await client.query(
          'UPDATE location_hidden_info SET sort_order = $2 WHERE id = $1 AND location_id = $3',
          [order[i], i, id]
        );
      }
      await client.query('COMMIT');
      return reply.send({ success: true });
    } catch (error) {
      await client.query('ROLLBACK');
      request.log.error(error, 'PUT hidden-info reorder error');
      return reply.status(500).send({ error: 'reorder_failed' });
    } finally {
      client.release();
    }
  });

  // ════════════════════════════════════════════
  //  SVG 直接儲存（生成由前端呼叫 Gemini）
  // ════════════════════════════════════════════

  // ── PUT /api/admin/locations/:id/svg ──
  app.put<{ Params: { id: string } }>('/api/admin/locations/:id/svg', async (request, reply) => {
    try {
      const { id } = request.params;
      const { svg_code, art_type } = request.body as { svg_code: string | null; art_type?: string };
      const validArtTypes = ['none', 'image_url', 'svg_generated', 'svg_custom'];
      const finalArtType = art_type && validArtTypes.includes(art_type) ? art_type : 'svg_custom';

      const result = await pool.query(`
        UPDATE locations SET
          svg_code = $2,
          art_type = $3,
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, code, name_zh, art_type, svg_code, art_url
      `, [id, svg_code, finalArtType]);
      if (result.rows.length === 0) return reply.status(404).send({ error: 'location_not_found' });
      return reply.send({ location: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT location svg error');
      return reply.status(500).send({ error: 'update_svg_failed' });
    }
  });

  // ════════════════════════════════════════════
  //  地點 CRUD
  // ════════════════════════════════════════════

  // ── GET /api/admin/locations ── 列表（含篩選）
  app.get('/api/admin/locations', async (request, reply) => {
    try {
      const q = request.query as any;
      const conditions: string[] = [];
      const params: any[] = [];

      if (q.scale_tag) {
        params.push(q.scale_tag);
        conditions.push(`l.scale_tag = $${params.length}`);
      }
      if (q.design_status) {
        params.push(q.design_status);
        conditions.push(`l.design_status = $${params.length}`);
      }
      if (q.search) {
        params.push(`%${q.search}%`);
        const idx = params.length;
        conditions.push(`(l.name_zh ILIKE $${idx} OR l.name_en ILIKE $${idx} OR l.description_zh ILIKE $${idx})`);
      }
      if (q.style_tag_code) {
        params.push(q.style_tag_code);
        conditions.push(`EXISTS (
          SELECT 1 FROM location_tag_map ltm
          JOIN location_style_tags lst ON lst.id = ltm.tag_id
          WHERE ltm.location_id = l.id AND lst.code = $${params.length}
        )`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `SELECT l.* FROM locations l ${where} ORDER BY l.updated_at DESC`;
      const res = await pool.query(sql, params);

      // 為每個地點補上 tags 簡要清單
      const locationIds = (res.rows as any[]).map(r => r.id);
      const tagsByLoc: Record<string, any[]> = {};
      if (locationIds.length > 0) {
        const tagsRes = await pool.query(`
          SELECT ltm.location_id, lst.id, lst.code, lst.name_zh, lst.category
          FROM location_tag_map ltm
          JOIN location_style_tags lst ON lst.id = ltm.tag_id
          WHERE ltm.location_id = ANY($1)
          ORDER BY lst.sort_order
        `, [locationIds]);
        for (const t of tagsRes.rows as any[]) {
          if (!tagsByLoc[t.location_id]) tagsByLoc[t.location_id] = [];
          tagsByLoc[t.location_id].push({ id: t.id, code: t.code, name_zh: t.name_zh, category: t.category });
        }
      }

      const data = (res.rows as any[]).map(r => ({ ...r, tags: tagsByLoc[r.id] || [] }));
      return reply.send({ locations: data, total: data.length });
    } catch (error) {
      request.log.error(error, 'GET locations error');
      return reply.status(500).send({ error: 'fetch_locations_failed' });
    }
  });

  // ── POST /api/admin/locations ── 新增
  app.post('/api/admin/locations', async (request, reply) => {
    try {
      const body = request.body as any;
      if (!body.code || !body.name_zh) {
        return reply.status(400).send({ error: 'missing_required', message: 'code 與 name_zh 為必填' });
      }
      const result = await pool.query(`
        INSERT INTO locations (
          code, name_zh, name_en, description_zh, description_en,
          scale_tag, shroud, clues_base, clues_per_player,
          travel_cost, travel_cost_type, art_type, design_status, design_notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *
      `, [
        body.code, body.name_zh, body.name_en || '',
        body.description_zh || null, body.description_en || null,
        body.scale_tag || null,
        body.shroud ?? 2, body.clues_base ?? 1, body.clues_per_player ?? true,
        body.travel_cost ?? 1, body.travel_cost_type || 'action_point',
        body.art_type || 'none',
        body.design_status || 'draft',
        body.design_notes || null
      ]);
      return reply.status(201).send({ location: result.rows[0] });
    } catch (error: any) {
      if (error?.code === '23505') {
        return reply.status(409).send({ error: 'code_duplicate', message: '代碼已存在' });
      }
      request.log.error(error, 'POST location error');
      return reply.status(500).send({ error: 'create_location_failed' });
    }
  });

  // ── GET /api/admin/locations/:id ── 取得單一（含完整資料）
  app.get<{ Params: { id: string } }>('/api/admin/locations/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const locRes = await pool.query('SELECT * FROM locations WHERE id = $1', [id]);
      if (locRes.rows.length === 0) return reply.status(404).send({ error: 'location_not_found' });
      const location: any = locRes.rows[0];

      const tagsRes = await pool.query(`
        SELECT lst.id, lst.code, lst.name_zh, lst.name_en, lst.category
        FROM location_tag_map ltm
        JOIN location_style_tags lst ON lst.id = ltm.tag_id
        WHERE ltm.location_id = $1
        ORDER BY lst.sort_order
      `, [id]);

      const hiddenRes = await pool.query(
        'SELECT * FROM location_hidden_info WHERE location_id = $1 ORDER BY sort_order, created_at',
        [id]
      );

      return reply.send({
        location: {
          ...location,
          tags: tagsRes.rows,
          hidden_info: hiddenRes.rows,
        },
      });
    } catch (error) {
      request.log.error(error, 'GET location detail error');
      return reply.status(500).send({ error: 'fetch_location_failed' });
    }
  });

  // ── PUT /api/admin/locations/:id ── 更新基本資訊
  app.put<{ Params: { id: string } }>('/api/admin/locations/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const body = request.body as any;

      // 若想改為 review/approved，檢查至少一個標籤
      if (body.design_status === 'review' || body.design_status === 'approved') {
        const tagCheck = await pool.query(
          'SELECT COUNT(*)::int AS c FROM location_tag_map WHERE location_id = $1',
          [id]
        );
        if (((tagCheck.rows[0] as any).c || 0) === 0) {
          return reply.status(400).send({
            error: 'tag_required',
            message: '狀態改為 review/approved 前需至少一個風格標籤',
          });
        }
      }

      const result = await pool.query(`
        UPDATE locations SET
          name_zh = COALESCE($2, name_zh),
          name_en = COALESCE($3, name_en),
          description_zh = $4,
          description_en = $5,
          scale_tag = $6,
          shroud = COALESCE($7, shroud),
          clues_base = COALESCE($8, clues_base),
          clues_per_player = COALESCE($9, clues_per_player),
          travel_cost = COALESCE($10, travel_cost),
          travel_cost_type = COALESCE($11, travel_cost_type),
          art_type = COALESCE($12, art_type),
          art_url = $13,
          design_status = COALESCE($14, design_status),
          design_notes = $15,
          discoverable_card_ids = COALESCE($16, discoverable_card_ids),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [
        id, body.name_zh, body.name_en, body.description_zh, body.description_en,
        body.scale_tag, body.shroud, body.clues_base, body.clues_per_player,
        body.travel_cost, body.travel_cost_type, body.art_type, body.art_url,
        body.design_status, body.design_notes, body.discoverable_card_ids,
      ]);
      if (result.rows.length === 0) return reply.status(404).send({ error: 'location_not_found' });
      return reply.send({ location: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT location error');
      return reply.status(500).send({ error: 'update_location_failed' });
    }
  });

  // ── DELETE /api/admin/locations/:id ──
  app.delete<{ Params: { id: string }; Querystring: { force?: string } }>('/api/admin/locations/:id', { preHandler: requireAdminRole }, async (request, reply) => {
    try {
      const { id } = request.params;
      const force = request.query.force === 'true';

      const locRes = await pool.query('SELECT id, name_zh, usage_count FROM locations WHERE id = $1', [id]);
      if (locRes.rows.length === 0) return reply.status(404).send({ error: 'location_not_found' });
      const loc: any = locRes.rows[0];

      if (loc.usage_count > 0 && !force) {
        return reply.status(409).send({
          error: 'in_use',
          message: `此地點被 ${loc.usage_count} 個關卡使用，刪除將導致關卡引用失效。`,
          usage_count: loc.usage_count,
        });
      }

      // 收集會被影響的 tag_id 之後同步計數
      const tagsRes = await pool.query('SELECT tag_id FROM location_tag_map WHERE location_id = $1', [id]);
      const affectedTagIds = (tagsRes.rows as any[]).map(r => r.tag_id);

      await pool.query('DELETE FROM locations WHERE id = $1', [id]);
      for (const tagId of affectedTagIds) await syncTagUsageCount(tagId);
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, 'DELETE location error');
      return reply.status(500).send({ error: 'delete_location_failed' });
    }
  });

  // ── POST /api/admin/locations/:id/duplicate ──
  app.post<{ Params: { id: string } }>('/api/admin/locations/:id/duplicate', async (request, reply) => {
    const client = await pool.connect();
    try {
      const { id } = request.params;
      const srcRes = await client.query('SELECT * FROM locations WHERE id = $1', [id]);
      if (srcRes.rows.length === 0) return reply.status(404).send({ error: 'location_not_found' });
      const src: any = srcRes.rows[0];

      // 找一個可用的 code suffix
      let suffix = 1;
      let newCode = `${src.code}_copy`;
      while (true) {
        const exists = await client.query('SELECT 1 FROM locations WHERE code = $1', [newCode]);
        if (exists.rows.length === 0) break;
        suffix++;
        newCode = `${src.code}_copy${suffix}`;
      }

      await client.query('BEGIN');
      const newRes = await client.query(`
        INSERT INTO locations (
          code, name_zh, name_en, description_zh, description_en,
          art_url, svg_code, art_type, scale_tag,
          shroud, clues_base, clues_per_player, travel_cost, travel_cost_type,
          discoverable_card_ids, design_notes, design_status
        )
        SELECT $1, name_zh || ' (副本)', name_en, description_zh, description_en,
               art_url, svg_code, art_type, scale_tag,
               shroud, clues_base, clues_per_player, travel_cost, travel_cost_type,
               discoverable_card_ids, design_notes, 'draft'
        FROM locations WHERE id = $2
        RETURNING *
      `, [newCode, id]);
      const newLoc: any = newRes.rows[0];

      // 複製標籤
      await client.query(`
        INSERT INTO location_tag_map (location_id, tag_id)
        SELECT $1, tag_id FROM location_tag_map WHERE location_id = $2
      `, [newLoc.id, id]);

      // 複製隱藏資訊
      await client.query(`
        INSERT INTO location_hidden_info (
          location_id, title_zh, title_en, description_zh, description_en,
          reveal_condition_type, reveal_condition_params,
          reward_type, reward_params, sort_order)
        SELECT $1, title_zh, title_en, description_zh, description_en,
          reveal_condition_type, reveal_condition_params,
          reward_type, reward_params, sort_order
        FROM location_hidden_info WHERE location_id = $2
      `, [newLoc.id, id]);

      await client.query('COMMIT');

      await syncLocationCounts(newLoc.id);
      const tagIds = await pool.query('SELECT DISTINCT tag_id FROM location_tag_map WHERE location_id = $1', [newLoc.id]);
      for (const r of tagIds.rows as any[]) await syncTagUsageCount(r.tag_id);

      return reply.status(201).send({ location: { ...newLoc, code: newCode } });
    } catch (error) {
      await client.query('ROLLBACK');
      request.log.error(error, 'POST duplicate location error');
      return reply.status(500).send({ error: 'duplicate_location_failed' });
    } finally {
      client.release();
    }
  });
};
