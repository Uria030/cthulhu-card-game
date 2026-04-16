import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

export const keeperRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // ════════════════════════════════════════════
  //  Helpers
  // ════════════════════════════════════════════
  async function syncMythosEffectCount(cardId: string) {
    await pool.query(
      `UPDATE mythos_cards SET
        effect_count = (SELECT COUNT(*) FROM mythos_card_effects WHERE mythos_card_id = $1),
        updated_at = NOW()
       WHERE id = $1`,
      [cardId]
    );
  }

  async function syncEncounterCounts(cardId: string) {
    await pool.query(
      `UPDATE encounter_cards SET
        option_count = (SELECT COUNT(*) FROM encounter_card_options WHERE encounter_card_id = $1),
        tag_count = (SELECT COUNT(*) FROM encounter_card_tag_map WHERE encounter_card_id = $1),
        updated_at = NOW()
       WHERE id = $1`,
      [cardId]
    );
  }

  // ════════════════════════════════════════════
  //  批次操作 — 必須在 /:id 之前
  // ════════════════════════════════════════════

  // ── GET /api/admin/keeper/stats/overview ──
  app.get('/api/admin/keeper/stats/overview', async (request, reply) => {
    try {
      const mTotal = await pool.query('SELECT COUNT(*)::int AS total FROM mythos_cards');
      const mByCat = await pool.query('SELECT card_category, COUNT(*)::int AS c FROM mythos_cards GROUP BY card_category');
      const mByInt = await pool.query('SELECT intensity_tag, COUNT(*)::int AS c FROM mythos_cards GROUP BY intensity_tag');
      const mByTim = await pool.query('SELECT activation_timing, COUNT(*)::int AS c FROM mythos_cards GROUP BY activation_timing');
      const mByStatus = await pool.query('SELECT design_status, COUNT(*)::int AS c FROM mythos_cards GROUP BY design_status');

      const eTotal = await pool.query('SELECT COUNT(*)::int AS total FROM encounter_cards');
      const eByType = await pool.query('SELECT encounter_type, COUNT(*)::int AS c FROM encounter_cards GROUP BY encounter_type');
      const eByStatus = await pool.query('SELECT design_status, COUNT(*)::int AS c FROM encounter_cards GROUP BY design_status');
      const eTagCov = await pool.query(`
        SELECT lst.code, COUNT(DISTINCT ectm.encounter_card_id)::int AS c
        FROM location_style_tags lst
        LEFT JOIN encounter_card_tag_map ectm ON ectm.tag_id = lst.id
        GROUP BY lst.code
      `);
      const mNoFlavor = await pool.query(`SELECT COUNT(*)::int AS c FROM mythos_cards WHERE flavor_text_zh IS NULL OR flavor_text_zh = ''`);
      const eNoOption = await pool.query(`
        SELECT COUNT(*)::int AS c FROM encounter_cards
        WHERE (SELECT COUNT(*) FROM encounter_card_options WHERE encounter_card_id = encounter_cards.id) < 2
      `);

      const buildMap = (rows: any[], keyName: string, defaults: string[]) => {
        const map: Record<string, number> = {};
        for (const k of defaults) map[k] = 0;
        for (const r of rows) map[r[keyName]] = r.c;
        return map;
      };

      return reply.send({
        mythos_cards: {
          total: (mTotal.rows[0] as any).total,
          by_category: buildMap(mByCat.rows as any[], 'card_category',
            ['summon','environment','status','global','agenda','chaos_bag','encounter','cancel','narrative','general']),
          by_intensity: buildMap(mByInt.rows as any[], 'intensity_tag', ['small','medium','large','epic']),
          by_timing: buildMap(mByTim.rows as any[], 'activation_timing',
            ['investigator_phase_reaction','keeper_phase','both']),
          by_status: buildMap(mByStatus.rows as any[], 'design_status', ['draft','review','approved']),
          missing_flavor: (mNoFlavor.rows[0] as any).c,
        },
        encounter_cards: {
          total: (eTotal.rows[0] as any).total,
          by_type: buildMap(eByType.rows as any[], 'encounter_type',
            ['thriller','choice','trade','puzzle','social','discovery']),
          by_status: buildMap(eByStatus.rows as any[], 'design_status', ['draft','review','approved']),
          tag_coverage: Object.fromEntries((eTagCov.rows as any[]).map(r => [r.code, r.c])),
          insufficient_options: (eNoOption.rows[0] as any).c,
        },
      });
    } catch (error) {
      request.log.error(error, 'GET keeper stats error');
      return reply.status(500).send({ error: 'stats_failed' });
    }
  });

  // ════════════════════════════════════════════
  //  平衡設定
  // ════════════════════════════════════════════

  // ── GET /api/admin/keeper/balance ──
  app.get('/api/admin/keeper/balance', async (request, reply) => {
    try {
      const res = await pool.query(`
        SELECT * FROM game_balance_settings
        ORDER BY setting_group, sort_order, setting_key
      `);
      const grouped: Record<string, any[]> = {};
      for (const r of res.rows as any[]) {
        if (!grouped[r.setting_group]) grouped[r.setting_group] = [];
        grouped[r.setting_group].push(r);
      }
      return reply.send({ groups: grouped, total: res.rows.length });
    } catch (error) {
      request.log.error(error, 'GET balance error');
      return reply.status(500).send({ error: 'fetch_balance_failed' });
    }
  });

  // ── GET /api/admin/keeper/balance/simulate (POST) ──
  app.post('/api/admin/keeper/balance/simulate', async (request, reply) => {
    try {
      const { difficulty, player_count, rounds } = request.body as { difficulty: number; player_count: number; rounds: number };
      if (![1,2,3,4,5].includes(difficulty)) {
        return reply.status(400).send({ error: 'invalid_difficulty', message: '難度必須為 1-5' });
      }
      if (player_count < 1 || player_count > 4) {
        return reply.status(400).send({ error: 'invalid_player_count', message: '人數必須為 1-4' });
      }
      const r = Math.max(1, Math.min(20, rounds || 5));

      const baseRes = await pool.query(`SELECT value FROM game_balance_settings WHERE setting_key = $1`,
        [`keeper_action_base_difficulty_${difficulty}`]);
      const perPlayerRes = await pool.query(`SELECT value FROM game_balance_settings WHERE setting_key = 'keeper_action_per_player'`);
      const accumRes = await pool.query(`SELECT value FROM game_balance_settings WHERE setting_key = 'keeper_action_accumulation'`);
      const maxAccumRes = await pool.query(`SELECT value FROM game_balance_settings WHERE setting_key = 'keeper_action_max_accumulation'`);

      const basePoints = (baseRes.rows[0] as any)?.value?.value ?? 0;
      const perPlayer = (perPlayerRes.rows[0] as any)?.value?.value ?? 0;
      const accumulation = (accumRes.rows[0] as any)?.value?.value ?? false;
      const maxAccum = (maxAccumRes.rows[0] as any)?.value?.value ?? 0;

      const playerBonus = perPlayer * Math.max(0, player_count - 1);
      const perRoundTotal = basePoints + playerBonus;

      const accumulatedAfterRounds: number[] = [];
      let acc = 0;
      for (let i = 1; i <= r; i++) {
        if (accumulation) {
          acc += perRoundTotal;
          if (maxAccum > 0 && acc > maxAccum) acc = maxAccum;
        } else {
          acc = perRoundTotal;
        }
        accumulatedAfterRounds.push(acc);
      }

      return reply.send({
        base_points: basePoints,
        player_bonus: playerBonus,
        per_round_total: perRoundTotal,
        accumulation_enabled: accumulation,
        max_accumulation: maxAccum,
        accumulated_after_rounds: accumulatedAfterRounds,
        formula_text: `基礎 ${basePoints} 點 + 人數加成 ${playerBonus} 點 = 每回合 ${perRoundTotal} 點`,
      });
    } catch (error) {
      request.log.error(error, 'POST balance simulate error');
      return reply.status(500).send({ error: 'simulate_failed' });
    }
  });

  // ── GET /api/admin/keeper/balance/:setting_key ──
  app.get<{ Params: { setting_key: string } }>('/api/admin/keeper/balance/:setting_key', async (request, reply) => {
    try {
      const res = await pool.query(`SELECT * FROM game_balance_settings WHERE setting_key = $1`, [request.params.setting_key]);
      if (res.rows.length === 0) return reply.status(404).send({ error: 'setting_not_found' });
      return reply.send({ setting: res.rows[0] });
    } catch (error) {
      request.log.error(error, 'GET balance setting error');
      return reply.status(500).send({ error: 'fetch_setting_failed' });
    }
  });

  // ── PUT /api/admin/keeper/balance/:setting_key ──
  app.put<{ Params: { setting_key: string } }>('/api/admin/keeper/balance/:setting_key', async (request, reply) => {
    try {
      const { setting_key } = request.params;
      const { value } = request.body as { value: any };
      if (value === undefined) return reply.status(400).send({ error: 'missing_value' });
      const result = await pool.query(`
        UPDATE game_balance_settings SET value = $2, updated_at = NOW()
        WHERE setting_key = $1 AND is_editable = TRUE
        RETURNING *
      `, [setting_key, JSON.stringify(value)]);
      if (result.rows.length === 0) return reply.status(404).send({ error: 'setting_not_found_or_locked' });
      return reply.send({ setting: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT balance setting error');
      return reply.status(500).send({ error: 'update_setting_failed' });
    }
  });

  // ════════════════════════════════════════════
  //  神話卡動作管理
  // ════════════════════════════════════════════

  // ── PUT /api/admin/keeper/mythos-effects/:effect_id ──
  app.put<{ Params: { effect_id: string } }>('/api/admin/keeper/mythos-effects/:effect_id', async (request, reply) => {
    try {
      const { effect_id } = request.params;
      const body = request.body as any;
      const result = await pool.query(`
        UPDATE mythos_card_effects SET
          action_code = COALESCE($2, action_code),
          action_params = COALESCE($3, action_params),
          description_zh = $4,
          description_en = $5,
          sort_order = COALESCE($6, sort_order),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [effect_id, body.action_code,
          body.action_params ? JSON.stringify(body.action_params) : null,
          body.description_zh, body.description_en, body.sort_order]);
      if (result.rows.length === 0) return reply.status(404).send({ error: 'effect_not_found' });
      return reply.send({ effect: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT mythos-effect error');
      return reply.status(500).send({ error: 'update_effect_failed' });
    }
  });

  // ── DELETE /api/admin/keeper/mythos-effects/:effect_id ──
  app.delete<{ Params: { effect_id: string } }>('/api/admin/keeper/mythos-effects/:effect_id', async (request, reply) => {
    try {
      const { effect_id } = request.params;
      const lookup = await pool.query('SELECT mythos_card_id FROM mythos_card_effects WHERE id = $1', [effect_id]);
      if (lookup.rows.length === 0) return reply.status(404).send({ error: 'effect_not_found' });
      const cardId = (lookup.rows[0] as any).mythos_card_id;
      await pool.query('DELETE FROM mythos_card_effects WHERE id = $1', [effect_id]);
      await syncMythosEffectCount(cardId);
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, 'DELETE mythos-effect error');
      return reply.status(500).send({ error: 'delete_effect_failed' });
    }
  });

  // ── POST /api/admin/keeper/mythos-cards/:id/effects ──
  app.post<{ Params: { id: string } }>('/api/admin/keeper/mythos-cards/:id/effects', async (request, reply) => {
    try {
      const { id } = request.params;
      const body = request.body as any;
      if (!body.action_code) return reply.status(400).send({ error: 'missing_action_code' });

      const orderRes = await pool.query(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM mythos_card_effects WHERE mythos_card_id = $1',
        [id]
      );
      const sortOrder = (orderRes.rows[0] as any).next;

      const result = await pool.query(`
        INSERT INTO mythos_card_effects (mythos_card_id, action_code, action_params, description_zh, description_en, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [id, body.action_code, JSON.stringify(body.action_params || {}),
          body.description_zh || null, body.description_en || null, sortOrder]);
      await syncMythosEffectCount(id);
      return reply.status(201).send({ effect: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'POST mythos effect error');
      return reply.status(500).send({ error: 'create_effect_failed' });
    }
  });

  // ── PUT /api/admin/keeper/mythos-cards/:id/effects/reorder ──
  app.put<{ Params: { id: string } }>('/api/admin/keeper/mythos-cards/:id/effects/reorder', async (request, reply) => {
    const client = await pool.connect();
    try {
      const { id } = request.params;
      const { order } = request.body as { order: string[] };
      if (!Array.isArray(order)) return reply.status(400).send({ error: 'invalid_body' });
      await client.query('BEGIN');
      for (let i = 0; i < order.length; i++) {
        await client.query(
          'UPDATE mythos_card_effects SET sort_order = $2 WHERE id = $1 AND mythos_card_id = $3',
          [order[i], i, id]
        );
      }
      await client.query('COMMIT');
      return reply.send({ success: true });
    } catch (error) {
      await client.query('ROLLBACK');
      request.log.error(error, 'PUT effects reorder error');
      return reply.status(500).send({ error: 'reorder_failed' });
    } finally {
      client.release();
    }
  });

  // ════════════════════════════════════════════
  //  神話卡 CRUD
  // ════════════════════════════════════════════

  // ── GET /api/admin/keeper/mythos-cards ──
  app.get('/api/admin/keeper/mythos-cards', async (request, reply) => {
    try {
      const q = request.query as any;
      const conditions: string[] = [];
      const params: any[] = [];
      if (q.card_category) { params.push(q.card_category); conditions.push(`card_category = $${params.length}`); }
      if (q.activation_timing) { params.push(q.activation_timing); conditions.push(`activation_timing = $${params.length}`); }
      if (q.intensity_tag) { params.push(q.intensity_tag); conditions.push(`intensity_tag = $${params.length}`); }
      if (q.design_status) { params.push(q.design_status); conditions.push(`design_status = $${params.length}`); }
      if (q.action_cost_min) { params.push(parseInt(q.action_cost_min)); conditions.push(`action_cost >= $${params.length}`); }
      if (q.action_cost_max) { params.push(parseInt(q.action_cost_max)); conditions.push(`action_cost <= $${params.length}`); }
      if (q.search) {
        params.push(`%${q.search}%`);
        const idx = params.length;
        conditions.push(`(name_zh ILIKE $${idx} OR name_en ILIKE $${idx} OR description_zh ILIKE $${idx})`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `SELECT * FROM mythos_cards ${where} ORDER BY action_cost, name_zh`;
      const res = await pool.query(sql, params);
      return reply.send({ mythos_cards: res.rows, total: res.rows.length });
    } catch (error) {
      request.log.error(error, 'GET mythos-cards error');
      return reply.status(500).send({ error: 'fetch_mythos_failed' });
    }
  });

  // ── POST /api/admin/keeper/mythos-cards ──
  app.post('/api/admin/keeper/mythos-cards', async (request, reply) => {
    try {
      const body = request.body as any;
      if (!body.code || !body.name_zh) return reply.status(400).send({ error: 'missing_required' });
      const result = await pool.query(`
        INSERT INTO mythos_cards (code, name_zh, name_en, description_zh, description_en,
          action_cost, activation_timing, card_category, intensity_tag, response_trigger,
          flavor_text_zh, flavor_text_en, art_url, design_notes, design_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *
      `, [
        body.code, body.name_zh, body.name_en || '',
        body.description_zh || null, body.description_en || null,
        body.action_cost ?? 1, body.activation_timing || 'keeper_phase',
        body.card_category || 'general', body.intensity_tag || 'small',
        body.response_trigger || null,
        body.flavor_text_zh || null, body.flavor_text_en || null,
        body.art_url || null, body.design_notes || null,
        body.design_status || 'draft',
      ]);
      return reply.status(201).send({ mythos_card: result.rows[0] });
    } catch (error: any) {
      if (error?.code === '23505') return reply.status(409).send({ error: 'code_duplicate', message: '代碼已存在' });
      request.log.error(error, 'POST mythos-card error');
      return reply.status(500).send({ error: 'create_mythos_failed' });
    }
  });

  // ── GET /api/admin/keeper/mythos-cards/:id ──
  app.get<{ Params: { id: string } }>('/api/admin/keeper/mythos-cards/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const cardRes = await pool.query('SELECT * FROM mythos_cards WHERE id = $1', [id]);
      if (cardRes.rows.length === 0) return reply.status(404).send({ error: 'mythos_card_not_found' });
      const effectsRes = await pool.query(
        'SELECT * FROM mythos_card_effects WHERE mythos_card_id = $1 ORDER BY sort_order, created_at',
        [id]
      );
      return reply.send({ mythos_card: { ...(cardRes.rows[0] as any), effects: effectsRes.rows } });
    } catch (error) {
      request.log.error(error, 'GET mythos-card detail error');
      return reply.status(500).send({ error: 'fetch_mythos_failed' });
    }
  });

  // ── PUT /api/admin/keeper/mythos-cards/:id ──
  app.put<{ Params: { id: string } }>('/api/admin/keeper/mythos-cards/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const body = request.body as any;

      // 響應類驗證：cancel 類型或 reaction 時機必須有 response_trigger（review/approved 時才檢查）
      if (body.design_status === 'review' || body.design_status === 'approved') {
        if ((body.card_category === 'cancel' || body.activation_timing === 'investigator_phase_reaction') && !body.response_trigger) {
          return reply.status(400).send({
            error: 'response_trigger_required',
            message: '響應類神話卡需設定 response_trigger 才能進入 review/approved'
          });
        }
      }

      const result = await pool.query(`
        UPDATE mythos_cards SET
          name_zh = COALESCE($2, name_zh),
          name_en = COALESCE($3, name_en),
          description_zh = $4,
          description_en = $5,
          action_cost = COALESCE($6, action_cost),
          activation_timing = COALESCE($7, activation_timing),
          card_category = COALESCE($8, card_category),
          intensity_tag = COALESCE($9, intensity_tag),
          response_trigger = $10,
          flavor_text_zh = $11,
          flavor_text_en = $12,
          art_url = $13,
          design_notes = $14,
          design_status = COALESCE($15, design_status),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id, body.name_zh, body.name_en, body.description_zh, body.description_en,
          body.action_cost, body.activation_timing, body.card_category, body.intensity_tag,
          body.response_trigger, body.flavor_text_zh, body.flavor_text_en,
          body.art_url, body.design_notes, body.design_status]);
      if (result.rows.length === 0) return reply.status(404).send({ error: 'mythos_card_not_found' });
      return reply.send({ mythos_card: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT mythos-card error');
      return reply.status(500).send({ error: 'update_mythos_failed' });
    }
  });

  // ── DELETE /api/admin/keeper/mythos-cards/:id ──
  app.delete<{ Params: { id: string } }>('/api/admin/keeper/mythos-cards/:id', async (request, reply) => {
    try {
      const result = await pool.query('DELETE FROM mythos_cards WHERE id = $1 RETURNING id', [request.params.id]);
      if (result.rows.length === 0) return reply.status(404).send({ error: 'mythos_card_not_found' });
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, 'DELETE mythos-card error');
      return reply.status(500).send({ error: 'delete_mythos_failed' });
    }
  });

  // ── POST /api/admin/keeper/mythos-cards/:id/duplicate ──
  app.post<{ Params: { id: string } }>('/api/admin/keeper/mythos-cards/:id/duplicate', async (request, reply) => {
    const client = await pool.connect();
    try {
      const { id } = request.params;
      const srcRes = await client.query('SELECT * FROM mythos_cards WHERE id = $1', [id]);
      if (srcRes.rows.length === 0) return reply.status(404).send({ error: 'mythos_card_not_found' });
      const src: any = srcRes.rows[0];

      let suffix = 1;
      let newCode = `${src.code}_copy`;
      while (true) {
        const exists = await client.query('SELECT 1 FROM mythos_cards WHERE code = $1', [newCode]);
        if (exists.rows.length === 0) break;
        suffix++;
        newCode = `${src.code}_copy${suffix}`;
      }

      await client.query('BEGIN');
      const newRes = await client.query(`
        INSERT INTO mythos_cards (code, name_zh, name_en, description_zh, description_en,
          action_cost, activation_timing, card_category, intensity_tag, response_trigger,
          flavor_text_zh, flavor_text_en, art_url, design_notes, design_status)
        SELECT $1, name_zh || ' (副本)', name_en, description_zh, description_en,
          action_cost, activation_timing, card_category, intensity_tag, response_trigger,
          flavor_text_zh, flavor_text_en, art_url, design_notes, 'draft'
        FROM mythos_cards WHERE id = $2
        RETURNING *
      `, [newCode, id]);
      const newId = (newRes.rows[0] as any).id;

      await client.query(`
        INSERT INTO mythos_card_effects (mythos_card_id, action_code, action_params, sort_order, description_zh, description_en)
        SELECT $1, action_code, action_params, sort_order, description_zh, description_en
        FROM mythos_card_effects WHERE mythos_card_id = $2
      `, [newId, id]);

      await client.query('COMMIT');
      await syncMythosEffectCount(newId);
      return reply.status(201).send({ mythos_card: newRes.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      request.log.error(error, 'POST duplicate mythos error');
      return reply.status(500).send({ error: 'duplicate_mythos_failed' });
    } finally {
      client.release();
    }
  });

  // ════════════════════════════════════════════
  //  遭遇卡選項管理
  // ════════════════════════════════════════════

  // ── PUT /api/admin/keeper/encounter-options/:option_id ──
  app.put<{ Params: { option_id: string } }>('/api/admin/keeper/encounter-options/:option_id', async (request, reply) => {
    try {
      const { option_id } = request.params;
      const body = request.body as any;

      // 檢定欄位驗證
      if (body.requires_check === true) {
        if (!body.check_attribute || body.check_dc == null) {
          return reply.status(400).send({
            error: 'check_fields_required',
            message: '需檢定的選項必須設定屬性與 DC'
          });
        }
      }

      const result = await pool.query(`
        UPDATE encounter_card_options SET
          option_text_zh = COALESCE($2, option_text_zh),
          option_text_en = $3,
          requires_check = COALESCE($4, requires_check),
          check_attribute = $5,
          check_dc = $6,
          success_narrative_zh = $7,
          success_narrative_en = $8,
          success_effects = COALESCE($9, success_effects),
          failure_narrative_zh = $10,
          failure_narrative_en = $11,
          failure_effects = COALESCE($12, failure_effects),
          no_check_narrative_zh = $13,
          no_check_narrative_en = $14,
          no_check_effects = COALESCE($15, no_check_effects),
          sort_order = COALESCE($16, sort_order),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [option_id, body.option_text_zh, body.option_text_en,
          body.requires_check, body.check_attribute, body.check_dc,
          body.success_narrative_zh, body.success_narrative_en,
          body.success_effects ? JSON.stringify(body.success_effects) : null,
          body.failure_narrative_zh, body.failure_narrative_en,
          body.failure_effects ? JSON.stringify(body.failure_effects) : null,
          body.no_check_narrative_zh, body.no_check_narrative_en,
          body.no_check_effects ? JSON.stringify(body.no_check_effects) : null,
          body.sort_order]);
      if (result.rows.length === 0) return reply.status(404).send({ error: 'option_not_found' });
      return reply.send({ option: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT encounter-option error');
      return reply.status(500).send({ error: 'update_option_failed' });
    }
  });

  // ── DELETE /api/admin/keeper/encounter-options/:option_id ──
  app.delete<{ Params: { option_id: string } }>('/api/admin/keeper/encounter-options/:option_id', async (request, reply) => {
    try {
      const { option_id } = request.params;
      const lookup = await pool.query('SELECT encounter_card_id FROM encounter_card_options WHERE id = $1', [option_id]);
      if (lookup.rows.length === 0) return reply.status(404).send({ error: 'option_not_found' });
      const cardId = (lookup.rows[0] as any).encounter_card_id;

      // 至少要保留 2 個選項
      const countRes = await pool.query('SELECT COUNT(*)::int AS c FROM encounter_card_options WHERE encounter_card_id = $1', [cardId]);
      if (((countRes.rows[0] as any).c) <= 2) {
        return reply.status(400).send({
          error: 'min_options',
          message: '遭遇卡必須保留至少 2 個選項'
        });
      }

      await pool.query('DELETE FROM encounter_card_options WHERE id = $1', [option_id]);
      await syncEncounterCounts(cardId);
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, 'DELETE encounter-option error');
      return reply.status(500).send({ error: 'delete_option_failed' });
    }
  });

  // ── POST /api/admin/keeper/encounter-cards/:id/options ──
  app.post<{ Params: { id: string } }>('/api/admin/keeper/encounter-cards/:id/options', async (request, reply) => {
    try {
      const { id } = request.params;
      const body = request.body as any;

      const countRes = await pool.query('SELECT COUNT(*)::int AS c FROM encounter_card_options WHERE encounter_card_id = $1', [id]);
      const c = (countRes.rows[0] as any).c;
      if (c >= 3) {
        return reply.status(400).send({ error: 'max_options', message: '遭遇卡最多 3 個選項' });
      }

      // 自動分配 label A/B/C
      const usedLabelsRes = await pool.query(
        `SELECT option_label FROM encounter_card_options WHERE encounter_card_id = $1`, [id]
      );
      const used = new Set((usedLabelsRes.rows as any[]).map(r => r.option_label));
      const label = ['A','B','C'].find(l => !used.has(l)) || 'A';

      const result = await pool.query(`
        INSERT INTO encounter_card_options (
          encounter_card_id, option_label, option_text_zh, option_text_en,
          requires_check, check_attribute, check_dc,
          success_narrative_zh, success_narrative_en, success_effects,
          failure_narrative_zh, failure_narrative_en, failure_effects,
          no_check_narrative_zh, no_check_narrative_en, no_check_effects,
          sort_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING *
      `, [id, label, body.option_text_zh || '', body.option_text_en || null,
          body.requires_check ?? true,
          body.check_attribute || null, body.check_dc || null,
          body.success_narrative_zh || null, body.success_narrative_en || null,
          JSON.stringify(body.success_effects || []),
          body.failure_narrative_zh || null, body.failure_narrative_en || null,
          JSON.stringify(body.failure_effects || []),
          body.no_check_narrative_zh || null, body.no_check_narrative_en || null,
          JSON.stringify(body.no_check_effects || []),
          c]);
      await syncEncounterCounts(id);
      return reply.status(201).send({ option: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'POST encounter-option error');
      return reply.status(500).send({ error: 'create_option_failed' });
    }
  });

  // ════════════════════════════════════════════
  //  遭遇卡標籤
  // ════════════════════════════════════════════

  // ── PUT /api/admin/keeper/encounter-cards/:id/tags ──
  app.put<{ Params: { id: string } }>('/api/admin/keeper/encounter-cards/:id/tags', async (request, reply) => {
    const client = await pool.connect();
    try {
      const { id } = request.params;
      const { tag_ids } = request.body as { tag_ids: string[] };
      if (!Array.isArray(tag_ids)) return reply.status(400).send({ error: 'invalid_body' });
      await client.query('BEGIN');
      await client.query('DELETE FROM encounter_card_tag_map WHERE encounter_card_id = $1', [id]);
      for (const tid of tag_ids) {
        await client.query(
          'INSERT INTO encounter_card_tag_map (encounter_card_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, tid]
        );
      }
      await client.query('COMMIT');
      await syncEncounterCounts(id);
      return reply.send({ success: true, tag_count: tag_ids.length });
    } catch (error) {
      await client.query('ROLLBACK');
      request.log.error(error, 'PUT encounter tags error');
      return reply.status(500).send({ error: 'update_encounter_tags_failed' });
    } finally {
      client.release();
    }
  });

  // ════════════════════════════════════════════
  //  遭遇卡 CRUD
  // ════════════════════════════════════════════

  // ── GET /api/admin/keeper/encounter-cards ──
  app.get('/api/admin/keeper/encounter-cards', async (request, reply) => {
    try {
      const q = request.query as any;
      const conditions: string[] = [];
      const params: any[] = [];
      if (q.encounter_type) { params.push(q.encounter_type); conditions.push(`ec.encounter_type = $${params.length}`); }
      if (q.design_status) { params.push(q.design_status); conditions.push(`ec.design_status = $${params.length}`); }
      if (q.search) {
        params.push(`%${q.search}%`);
        const idx = params.length;
        conditions.push(`(ec.name_zh ILIKE $${idx} OR ec.name_en ILIKE $${idx} OR ec.scenario_text_zh ILIKE $${idx})`);
      }
      if (q.style_tag_code) {
        params.push(q.style_tag_code);
        conditions.push(`EXISTS (
          SELECT 1 FROM encounter_card_tag_map ectm
          JOIN location_style_tags lst ON lst.id = ectm.tag_id
          WHERE ectm.encounter_card_id = ec.id AND lst.code = $${params.length}
        )`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `SELECT ec.* FROM encounter_cards ec ${where} ORDER BY ec.updated_at DESC`;
      const res = await pool.query(sql, params);

      // 補上 tags
      const cardIds = (res.rows as any[]).map(r => r.id);
      const tagsByCard: Record<string, any[]> = {};
      if (cardIds.length > 0) {
        const tagsRes = await pool.query(`
          SELECT ectm.encounter_card_id, lst.id, lst.code, lst.name_zh, lst.category
          FROM encounter_card_tag_map ectm
          JOIN location_style_tags lst ON lst.id = ectm.tag_id
          WHERE ectm.encounter_card_id = ANY($1)
        `, [cardIds]);
        for (const t of tagsRes.rows as any[]) {
          if (!tagsByCard[t.encounter_card_id]) tagsByCard[t.encounter_card_id] = [];
          tagsByCard[t.encounter_card_id].push({ id: t.id, code: t.code, name_zh: t.name_zh, category: t.category });
        }
      }
      const data = (res.rows as any[]).map(r => ({ ...r, tags: tagsByCard[r.id] || [] }));
      return reply.send({ encounter_cards: data, total: data.length });
    } catch (error) {
      request.log.error(error, 'GET encounter-cards error');
      return reply.status(500).send({ error: 'fetch_encounter_failed' });
    }
  });

  // ── POST /api/admin/keeper/encounter-cards ──
  app.post('/api/admin/keeper/encounter-cards', async (request, reply) => {
    const client = await pool.connect();
    try {
      const body = request.body as any;
      if (!body.code || !body.name_zh) return reply.status(400).send({ error: 'missing_required' });

      await client.query('BEGIN');
      const result = await client.query(`
        INSERT INTO encounter_cards (code, name_zh, name_en, scenario_text_zh, scenario_text_en,
          encounter_type, art_url, design_notes, design_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [body.code, body.name_zh, body.name_en || '',
          body.scenario_text_zh || '', body.scenario_text_en || null,
          body.encounter_type || 'choice',
          body.art_url || null, body.design_notes || null,
          body.design_status || 'draft']);
      const newId = (result.rows[0] as any).id;

      // 自動建立 2 個空選項
      await client.query(`
        INSERT INTO encounter_card_options (encounter_card_id, option_label, option_text_zh, requires_check, sort_order)
        VALUES ($1, 'A', '', TRUE, 0), ($1, 'B', '', TRUE, 1)
      `, [newId]);

      await client.query('COMMIT');
      await syncEncounterCounts(newId);
      return reply.status(201).send({ encounter_card: result.rows[0] });
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') return reply.status(409).send({ error: 'code_duplicate', message: '代碼已存在' });
      request.log.error(error, 'POST encounter-card error');
      return reply.status(500).send({ error: 'create_encounter_failed' });
    } finally {
      client.release();
    }
  });

  // ── GET /api/admin/keeper/encounter-cards/:id ──
  app.get<{ Params: { id: string } }>('/api/admin/keeper/encounter-cards/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const cardRes = await pool.query('SELECT * FROM encounter_cards WHERE id = $1', [id]);
      if (cardRes.rows.length === 0) return reply.status(404).send({ error: 'encounter_card_not_found' });

      const optionsRes = await pool.query(
        'SELECT * FROM encounter_card_options WHERE encounter_card_id = $1 ORDER BY sort_order, option_label',
        [id]
      );

      const tagsRes = await pool.query(`
        SELECT lst.id, lst.code, lst.name_zh, lst.name_en, lst.category
        FROM encounter_card_tag_map ectm
        JOIN location_style_tags lst ON lst.id = ectm.tag_id
        WHERE ectm.encounter_card_id = $1
        ORDER BY lst.sort_order
      `, [id]);

      return reply.send({
        encounter_card: {
          ...(cardRes.rows[0] as any),
          options: optionsRes.rows,
          tags: tagsRes.rows,
        },
      });
    } catch (error) {
      request.log.error(error, 'GET encounter-card detail error');
      return reply.status(500).send({ error: 'fetch_encounter_failed' });
    }
  });

  // ── PUT /api/admin/keeper/encounter-cards/:id ──
  app.put<{ Params: { id: string } }>('/api/admin/keeper/encounter-cards/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const body = request.body as any;

      // review/approved 檢查：至少 2 個選項 + 至少一個標籤
      if (body.design_status === 'review' || body.design_status === 'approved') {
        const optCount = await pool.query('SELECT COUNT(*)::int AS c FROM encounter_card_options WHERE encounter_card_id = $1', [id]);
        if (((optCount.rows[0] as any).c) < 2) {
          return reply.status(400).send({ error: 'min_options', message: '遭遇卡需至少 2 個選項才能進入 review/approved' });
        }
        const tagCount = await pool.query('SELECT COUNT(*)::int AS c FROM encounter_card_tag_map WHERE encounter_card_id = $1', [id]);
        if (((tagCount.rows[0] as any).c) === 0) {
          return reply.status(400).send({ error: 'tag_required', message: '遭遇卡需至少一個地點風格標籤才能進入 review/approved' });
        }
      }

      const result = await pool.query(`
        UPDATE encounter_cards SET
          name_zh = COALESCE($2, name_zh),
          name_en = COALESCE($3, name_en),
          scenario_text_zh = COALESCE($4, scenario_text_zh),
          scenario_text_en = $5,
          encounter_type = COALESCE($6, encounter_type),
          art_url = $7,
          design_notes = $8,
          design_status = COALESCE($9, design_status),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id, body.name_zh, body.name_en, body.scenario_text_zh, body.scenario_text_en,
          body.encounter_type, body.art_url, body.design_notes, body.design_status]);
      if (result.rows.length === 0) return reply.status(404).send({ error: 'encounter_card_not_found' });
      return reply.send({ encounter_card: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT encounter-card error');
      return reply.status(500).send({ error: 'update_encounter_failed' });
    }
  });

  // ── DELETE /api/admin/keeper/encounter-cards/:id ──
  app.delete<{ Params: { id: string } }>('/api/admin/keeper/encounter-cards/:id', async (request, reply) => {
    try {
      const result = await pool.query('DELETE FROM encounter_cards WHERE id = $1 RETURNING id', [request.params.id]);
      if (result.rows.length === 0) return reply.status(404).send({ error: 'encounter_card_not_found' });
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, 'DELETE encounter-card error');
      return reply.status(500).send({ error: 'delete_encounter_failed' });
    }
  });

  // ── POST /api/admin/keeper/encounter-cards/:id/duplicate ──
  app.post<{ Params: { id: string } }>('/api/admin/keeper/encounter-cards/:id/duplicate', async (request, reply) => {
    const client = await pool.connect();
    try {
      const { id } = request.params;
      const srcRes = await client.query('SELECT * FROM encounter_cards WHERE id = $1', [id]);
      if (srcRes.rows.length === 0) return reply.status(404).send({ error: 'encounter_card_not_found' });
      const src: any = srcRes.rows[0];

      let suffix = 1;
      let newCode = `${src.code}_copy`;
      while (true) {
        const exists = await client.query('SELECT 1 FROM encounter_cards WHERE code = $1', [newCode]);
        if (exists.rows.length === 0) break;
        suffix++;
        newCode = `${src.code}_copy${suffix}`;
      }

      await client.query('BEGIN');
      const newRes = await client.query(`
        INSERT INTO encounter_cards (code, name_zh, name_en, scenario_text_zh, scenario_text_en,
          encounter_type, art_url, design_notes, design_status)
        SELECT $1, name_zh || ' (副本)', name_en, scenario_text_zh, scenario_text_en,
          encounter_type, art_url, design_notes, 'draft'
        FROM encounter_cards WHERE id = $2
        RETURNING *
      `, [newCode, id]);
      const newId = (newRes.rows[0] as any).id;

      // 複製選項
      await client.query(`
        INSERT INTO encounter_card_options (encounter_card_id, option_label, option_text_zh, option_text_en,
          requires_check, check_attribute, check_dc,
          success_narrative_zh, success_narrative_en, success_effects,
          failure_narrative_zh, failure_narrative_en, failure_effects,
          no_check_narrative_zh, no_check_narrative_en, no_check_effects, sort_order)
        SELECT $1, option_label, option_text_zh, option_text_en,
          requires_check, check_attribute, check_dc,
          success_narrative_zh, success_narrative_en, success_effects,
          failure_narrative_zh, failure_narrative_en, failure_effects,
          no_check_narrative_zh, no_check_narrative_en, no_check_effects, sort_order
        FROM encounter_card_options WHERE encounter_card_id = $2
      `, [newId, id]);

      // 複製標籤
      await client.query(`
        INSERT INTO encounter_card_tag_map (encounter_card_id, tag_id)
        SELECT $1, tag_id FROM encounter_card_tag_map WHERE encounter_card_id = $2
      `, [newId, id]);

      await client.query('COMMIT');
      await syncEncounterCounts(newId);
      return reply.status(201).send({ encounter_card: newRes.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      request.log.error(error, 'POST duplicate encounter error');
      return reply.status(500).send({ error: 'duplicate_encounter_failed' });
    } finally {
      client.release();
    }
  });
};
