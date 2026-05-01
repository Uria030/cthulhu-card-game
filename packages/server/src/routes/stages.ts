// MOD-07 關卡編輯器 — 後端 routes
import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { requireAuth, requireAdminRole } from '../middleware/auth.js';
import {
  validateStageReferences,
  resolveReturnStage,
  validateLocationCodes,
  validateMonsterFamilyCodes,
  validateMonsterVariantIds,
  validateMythosCardIds,
  validateEncounterCardIds,
  validateStageFlagCodes,
  extractReferencedCodes,
  extractFlagCodesFromSets,
} from '../utils/stage-validators.js';
import { generateRandomDungeon } from '../services/random-dungeon-generator.js';

const VALID_STAGE_TYPES = new Set(['main', 'side', 'side_return', 'side_random']);
const VALID_DESIGN_STATUS = new Set(['draft', 'review', 'published']);
const VALID_DIFFICULTY = new Set(['easy', 'standard', 'hard', 'expert']);
const VALID_TIERS = new Set(['minion', 'threat', 'elite', 'boss', 'titan']);
const VALID_ROLES = new Set(['primary', 'secondary']);
const CODE_RE = /^[a-z0-9_]{3,64}$/;

function isUuid(s: unknown): boolean {
  return typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

async function loadFullStage(stageId: string): Promise<any | null> {
  const sRes = await pool.query('SELECT * FROM stages WHERE id = $1', [stageId]);
  if (sRes.rows.length === 0) return null;
  const stage = sRes.rows[0];

  const [scRes, acRes, agRes, encRes, mythRes, chaosRes, mpRes, rgRes, chInfoRes] =
    await Promise.all([
      pool.query(
        `SELECT * FROM scenarios WHERE stage_id = $1 ORDER BY scenario_order`,
        [stageId],
      ),
      pool.query(
        `SELECT * FROM stage_act_cards WHERE stage_id = $1 ORDER BY card_order`,
        [stageId],
      ),
      pool.query(
        `SELECT * FROM stage_agenda_cards WHERE stage_id = $1 ORDER BY card_order`,
        [stageId],
      ),
      pool.query(
        `SELECT ep.*, ec.name_zh AS card_name_zh, ec.encounter_type AS card_type
           FROM stage_encounter_pool ep
           LEFT JOIN encounter_cards ec ON ec.id = ep.encounter_card_id
          WHERE ep.stage_id = $1`,
        [stageId],
      ),
      pool.query(
        `SELECT mp.*, mc.name_zh AS card_name_zh, mc.card_category AS card_type
           FROM stage_mythos_pool mp
           LEFT JOIN mythos_cards mc ON mc.id = mp.mythos_card_id
          WHERE mp.stage_id = $1`,
        [stageId],
      ),
      pool.query(`SELECT * FROM stage_chaos_bag WHERE stage_id = $1`, [stageId]),
      pool.query(
        `SELECT mp.*, mf.name_zh AS family_name_zh
           FROM stage_monster_pool mp
           LEFT JOIN monster_families mf ON mf.code = mp.family_code
          WHERE mp.stage_id = $1`,
        [stageId],
      ),
      pool.query(
        `SELECT * FROM random_dungeon_generators WHERE stage_id = $1`,
        [stageId],
      ),
      stage.chapter_id
        ? pool.query(
            `SELECT chapter_number, name_zh AS chapter_name, campaign_id
               FROM chapters WHERE id = $1`,
            [stage.chapter_id],
          )
        : Promise.resolve({ rows: [] }),
    ]);

  const chInfo = chInfoRes.rows[0] || {};

  return {
    ...stage,
    chapter_number: chInfo.chapter_number ?? null,
    chapter_name: chInfo.chapter_name ?? null,
    campaign_id: chInfo.campaign_id ?? null,
    scenarios: scRes.rows,
    act_cards: acRes.rows,
    agenda_cards: agRes.rows,
    encounter_pool: encRes.rows,
    mythos_pool: mythRes.rows,
    chaos_bag: chaosRes.rows[0] || null,
    monster_pool: mpRes.rows,
    random_generator: rgRes.rows[0] || null,
  };
}

function formatValidationError(missing: Record<string, string[]>) {
  return {
    success: false,
    error: '驗證失敗',
    details: {
      missing_flags: missing.flags || [],
      missing_locations: missing.locations || [],
      missing_families: missing.families || [],
      missing_boss_ids: missing.boss_ids || [],
      missing_mythos_cards: missing.mythos_cards || [],
      missing_encounter_cards: missing.encounter_cards || [],
    },
  };
}

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────

export const stageRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // ═══════════════════════════════════════════
  // Stage CRUD
  // ═══════════════════════════════════════════

  app.get<{
    Querystring: {
      chapter_id?: string;
      stage_type?: string;
      status?: string;
      search?: string;
    };
  }>('/api/stages', async (request, reply) => {
    const { chapter_id, stage_type, status, search } = request.query;
    const conds: string[] = [];
    const vals: any[] = [];
    let pi = 1;
    if (chapter_id) {
      conds.push(`s.chapter_id = $${pi++}`);
      vals.push(chapter_id);
    }
    if (stage_type && VALID_STAGE_TYPES.has(stage_type)) {
      conds.push(`s.stage_type = $${pi++}`);
      vals.push(stage_type);
    }
    if (status && VALID_DESIGN_STATUS.has(status)) {
      conds.push(`s.design_status = $${pi++}`);
      vals.push(status);
    }
    if (search) {
      conds.push(`(s.name_zh ILIKE $${pi} OR s.code ILIKE $${pi})`);
      vals.push(`%${search}%`);
      pi += 1;
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    try {
      const res = await pool.query(
        `SELECT s.id, s.code, s.name_zh, s.name_en, s.stage_type,
                s.chapter_id, s.design_status, s.version,
                s.return_parent_id, s.return_stage_number,
                s.created_at, s.updated_at,
                ch.chapter_number, ch.name_zh AS chapter_name,
                (SELECT COUNT(*) FROM scenarios WHERE stage_id = s.id)::int AS scenario_count,
                (SELECT COUNT(*) FROM stage_act_cards WHERE stage_id = s.id)::int AS act_card_count,
                (SELECT COUNT(*) FROM stage_agenda_cards WHERE stage_id = s.id)::int AS agenda_card_count
           FROM stages s
           LEFT JOIN chapters ch ON ch.id = s.chapter_id
           ${where}
           ORDER BY s.created_at DESC`,
        vals,
      );
      return reply.send({ success: true, data: res.rows });
    } catch (error) {
      request.log.error(error, '列出關卡失敗');
      return reply.status(500).send({ success: false, error: '列出關卡失敗' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/stages/:id', async (request, reply) => {
    try {
      const stage = await loadFullStage(request.params.id);
      if (!stage) return reply.status(404).send({ success: false, error: '關卡不存在' });
      return reply.send({ success: true, data: stage });
    } catch (error) {
      request.log.error(error, '取得關卡失敗');
      return reply.status(500).send({ success: false, error: '取得關卡失敗' });
    }
  });

  app.get<{ Params: { id: string } }>(
    '/api/stages/:id/resolved',
    async (request, reply) => {
      try {
        const stage = await loadFullStage(request.params.id);
        if (!stage) return reply.status(404).send({ success: false, error: '關卡不存在' });
        if (stage.stage_type !== 'side_return' || !stage.return_parent_id) {
          return reply.send({ success: true, data: stage });
        }
        const parent = await loadFullStage(stage.return_parent_id);
        if (!parent) {
          return reply.status(400).send({
            success: false,
            error: '找不到原始支線',
          });
        }
        const resolved = resolveReturnStage(stage, parent);
        return reply.send({ success: true, data: resolved });
      } catch (error) {
        request.log.error(error, '合併重返版失敗');
        return reply.status(500).send({ success: false, error: '合併重返版失敗' });
      }
    },
  );

  app.get<{ Params: { chapter_id: string } }>(
    '/api/stages/by-chapter/:chapter_id',
    async (request, reply) => {
      try {
        const res = await pool.query(
          `SELECT * FROM stages WHERE chapter_id = $1 ORDER BY created_at`,
          [request.params.chapter_id],
        );
        return reply.send({ success: true, data: res.rows });
      } catch (error) {
        request.log.error(error, '列出章節關卡失敗');
        return reply.status(500).send({ success: false, error: '列出章節關卡失敗' });
      }
    },
  );

  app.post<{ Body: Record<string, any> }>('/api/stages', async (request, reply) => {
    const b = request.body || {};
    if (!b.code || !CODE_RE.test(b.code)) {
      return reply
        .status(400)
        .send({ success: false, error: '關卡代碼格式錯誤（3–64 字元小寫英數底線）' });
    }
    if (!b.name_zh) {
      return reply.status(400).send({ success: false, error: '中文名稱為必填' });
    }
    if (!VALID_STAGE_TYPES.has(b.stage_type)) {
      return reply.status(400).send({ success: false, error: '關卡類型不合法' });
    }

    // 各類型專屬校驗
    if (b.stage_type === 'main') {
      if (!b.chapter_id) {
        return reply
          .status(400)
          .send({ success: false, error: '主線關卡必須指定 chapter_id' });
      }
    }
    if (b.stage_type === 'side') {
      if (Array.isArray(b.completion_flags) && b.completion_flags.length > 0) {
        return reply
          .status(400)
          .send({ success: false, error: '支線關卡不可設定 completion_flags' });
      }
    }
    if (b.stage_type === 'side_return') {
      if (!b.return_parent_id || !isUuid(b.return_parent_id)) {
        return reply
          .status(400)
          .send({ success: false, error: '重返版必須指定 return_parent_id' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 重返版：檢查 parent 存在且不是另一個重返版
      if (b.stage_type === 'side_return') {
        const pRes = await client.query(
          `SELECT stage_type FROM stages WHERE id = $1`,
          [b.return_parent_id],
        );
        if (pRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ success: false, error: '原始支線不存在' });
        }
        if (pRes.rows[0].stage_type === 'side_return') {
          await client.query('ROLLBACK');
          return reply
            .status(400)
            .send({ success: false, error: '重返版不能指向另一個重返版' });
        }
      }

      const sRes = await client.query(
        `INSERT INTO stages (chapter_id, code, name_zh, name_en, stage_type, narrative,
                              entry_condition, completion_flags, scaling_rules,
                              return_parent_id, return_overrides, return_stage_number,
                              side_signature_card_id, design_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12,$13,$14)
         RETURNING *`,
        [
          b.stage_type === 'main' ? b.chapter_id : null,
          b.code,
          b.name_zh,
          b.name_en || '',
          b.stage_type,
          b.narrative || '',
          b.entry_condition ? JSON.stringify(b.entry_condition) : null,
          JSON.stringify(b.completion_flags || []),
          JSON.stringify(b.scaling_rules || {}),
          b.stage_type === 'side_return' ? b.return_parent_id : null,
          JSON.stringify(b.return_overrides || {}),
          b.return_stage_number || null,
          b.side_signature_card_id || null,
          'draft',
        ],
      );
      const stage = sRes.rows[0];

      // 預設混沌袋:主線關卡從所屬 campaign 繼承 initial_chaos_bag,其餘走 'standard'
      let inheritedPreset = b.scaling_rules?.difficulty_preset || 'standard';
      let inheritedNumber: any = {};
      let inheritedScenario: any = {};
      let inheritedMythos: any = {};
      if (b.stage_type === 'main' && b.chapter_id) {
        const campRes = await client.query(
          `SELECT c.difficulty_tier, c.initial_chaos_bag
             FROM chapters ch
             JOIN campaigns c ON c.id = ch.campaign_id
             WHERE ch.id = $1`,
          [b.chapter_id],
        );
        if (campRes.rows.length > 0) {
          const camp = campRes.rows[0];
          if (camp.difficulty_tier && VALID_DIFFICULTY.has(camp.difficulty_tier)) {
            inheritedPreset = camp.difficulty_tier;
          }
          const bag = camp.initial_chaos_bag || {};
          inheritedNumber = bag.number_markers || {};
          inheritedScenario = bag.scenario_markers || {};
          inheritedMythos = bag.mythos_markers || {};
        }
      }
      await client.query(
        `INSERT INTO stage_chaos_bag (stage_id, difficulty_preset,
                                       number_markers, scenario_markers, mythos_markers)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
        [
          stage.id,
          VALID_DIFFICULTY.has(inheritedPreset) ? inheritedPreset : 'standard',
          JSON.stringify(inheritedNumber),
          JSON.stringify(inheritedScenario),
          JSON.stringify(inheritedMythos),
        ],
      );

      // 隨機地城：建立空 generator
      if (b.stage_type === 'side_random') {
        await client.query(
          `INSERT INTO random_dungeon_generators (stage_id) VALUES ($1)`,
          [stage.id],
        );
      }

      await client.query('COMMIT');

      const full = await loadFullStage(stage.id);
      return reply.status(201).send({ success: true, data: full });
    } catch (error: any) {
      await client.query('ROLLBACK');
      request.log.error(error, '建立關卡失敗');
      if (error.code === '23505') {
        return reply.status(409).send({ success: false, error: '關卡代碼已存在' });
      }
      return reply.status(500).send({ success: false, error: '建立關卡失敗' });
    } finally {
      client.release();
    }
  });

  app.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/stages/:id',
    async (request, reply) => {
      const { id } = request.params;
      const b = request.body || {};
      const sets: string[] = [];
      const vals: any[] = [];
      let pi = 1;
      const push = (col: string, val: any, json = false) => {
        if (val === undefined) return;
        if (json) {
          sets.push(`${col} = $${pi++}::jsonb`);
          vals.push(val === null ? null : JSON.stringify(val));
        } else {
          sets.push(`${col} = $${pi++}`);
          vals.push(val);
        }
      };

      push('name_zh', b.name_zh);
      push('name_en', b.name_en);
      push('narrative', b.narrative);
      push('chapter_id', b.chapter_id);
      if (b.entry_condition !== undefined) push('entry_condition', b.entry_condition, true);
      if (b.completion_flags !== undefined) push('completion_flags', b.completion_flags, true);
      if (b.scaling_rules !== undefined) push('scaling_rules', b.scaling_rules, true);
      if (b.return_overrides !== undefined) push('return_overrides', b.return_overrides, true);
      push('return_stage_number', b.return_stage_number);
      push('side_signature_card_id', b.side_signature_card_id);
      if (b.design_status !== undefined) {
        if (!VALID_DESIGN_STATUS.has(b.design_status)) {
          return reply.status(400).send({ success: false, error: '設計狀態不合法' });
        }
        push('design_status', b.design_status);
      }

      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: '沒有可更新的欄位' });
      }

      sets.push(`version = version + 1`);
      sets.push(`updated_at = NOW()`);
      vals.push(id);

      try {
        const res = await pool.query(
          `UPDATE stages SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`,
          vals,
        );
        if (res.rows.length === 0) {
          return reply.status(404).send({ success: false, error: '關卡不存在' });
        }
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, '更新關卡失敗');
        return reply.status(500).send({ success: false, error: '更新關卡失敗' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/stages/:id', { preHandler: requireAdminRole }, async (request, reply) => {
    const { id } = request.params;
    try {
      const dep = await pool.query(
        `SELECT id, code, name_zh FROM stages
          WHERE return_parent_id = $1`,
        [id],
      );
      if (dep.rows.length > 0) {
        return reply.status(400).send({
          success: false,
          error: '有重返版依賴此關卡，無法刪除',
          dependent_returns: dep.rows,
        });
      }
      const res = await pool.query(`DELETE FROM stages WHERE id = $1 RETURNING id`, [id]);
      if (res.rows.length === 0) {
        return reply.status(404).send({ success: false, error: '關卡不存在' });
      }
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, '刪除關卡失敗');
      return reply.status(500).send({ success: false, error: '刪除關卡失敗' });
    }
  });

  // ═══════════════════════════════════════════
  // Scenarios
  // ═══════════════════════════════════════════

  app.get<{ Params: { stageId: string } }>(
    '/api/stages/:stageId/scenarios',
    async (request, reply) => {
      try {
        const res = await pool.query(
          `SELECT * FROM scenarios WHERE stage_id = $1 ORDER BY scenario_order`,
          [request.params.stageId],
        );
        return reply.send({ success: true, data: res.rows });
      } catch (error) {
        request.log.error(error, '列出場景失敗');
        return reply.status(500).send({ success: false, error: '列出場景失敗' });
      }
    },
  );

  app.post<{ Params: { stageId: string }; Body: Record<string, any> }>(
    '/api/stages/:stageId/scenarios',
    async (request, reply) => {
      const { stageId } = request.params;
      const b = request.body || {};
      try {
        let order = b.scenario_order;
        if (!order) {
          const mRes = await pool.query(
            `SELECT COALESCE(MAX(scenario_order), 0) AS m FROM scenarios WHERE stage_id = $1`,
            [stageId],
          );
          order = (mRes.rows[0].m || 0) + 1;
        }
        const res = await pool.query(
          `INSERT INTO scenarios
             (stage_id, scenario_order, name_zh, name_en, narrative,
              initial_location_codes, initial_connections,
              investigator_spawn_location, initial_environment, initial_enemies)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10::jsonb)
           RETURNING *`,
          [
            stageId,
            order,
            b.name_zh || '',
            b.name_en || '',
            b.narrative || '',
            b.initial_location_codes || [],
            JSON.stringify(b.initial_connections || []),
            b.investigator_spawn_location || null,
            JSON.stringify(b.initial_environment || {}),
            JSON.stringify(b.initial_enemies || []),
          ],
        );
        return reply.status(201).send({ success: true, data: res.rows[0] });
      } catch (error: any) {
        request.log.error(error, '建立場景失敗');
        if (error.code === '23505') {
          return reply.status(409).send({ success: false, error: '場景順序衝突' });
        }
        return reply.status(500).send({ success: false, error: '建立場景失敗' });
      }
    },
  );

  app.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/scenarios/:id',
    async (request, reply) => {
      const { id } = request.params;
      const b = request.body || {};

      // 校驗引用的地點
      const locCodes: string[] = [
        ...(b.initial_location_codes || []),
        ...(b.investigator_spawn_location ? [b.investigator_spawn_location] : []),
      ];
      for (const conn of b.initial_connections || []) {
        if (conn.from) locCodes.push(conn.from);
        if (conn.to) locCodes.push(conn.to);
      }
      for (const e of b.initial_enemies || []) {
        if (e.location_code) locCodes.push(e.location_code);
      }
      const locV = await validateLocationCodes(locCodes);

      const families = (b.initial_enemies || [])
        .map((e: any) => e.family_code)
        .filter(Boolean);
      const famV = await validateMonsterFamilyCodes(families);

      if (!locV.valid || !famV.valid) {
        return reply.status(400).send(
          formatValidationError({
            flags: [],
            locations: locV.missing,
            families: famV.missing,
            boss_ids: [],
            mythos_cards: [],
            encounter_cards: [],
          }),
        );
      }

      const sets: string[] = [];
      const vals: any[] = [];
      let pi = 1;
      const push = (col: string, val: any, json = false) => {
        if (val === undefined) return;
        if (json) {
          sets.push(`${col} = $${pi++}::jsonb`);
          vals.push(JSON.stringify(val));
        } else {
          sets.push(`${col} = $${pi++}`);
          vals.push(val);
        }
      };
      push('name_zh', b.name_zh);
      push('name_en', b.name_en);
      push('narrative', b.narrative);
      if (b.initial_location_codes !== undefined) {
        sets.push(`initial_location_codes = $${pi++}::varchar[]`);
        vals.push(b.initial_location_codes);
      }
      if (b.initial_connections !== undefined)
        push('initial_connections', b.initial_connections, true);
      push('investigator_spawn_location', b.investigator_spawn_location);
      if (b.initial_environment !== undefined)
        push('initial_environment', b.initial_environment, true);
      if (b.initial_enemies !== undefined) push('initial_enemies', b.initial_enemies, true);

      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: '沒有可更新的欄位' });
      }
      sets.push(`updated_at = NOW()`);
      vals.push(id);

      try {
        const res = await pool.query(
          `UPDATE scenarios SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`,
          vals,
        );
        if (res.rows.length === 0) {
          return reply.status(404).send({ success: false, error: '場景不存在' });
        }
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, '更新場景失敗');
        return reply.status(500).send({ success: false, error: '更新場景失敗' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/scenarios/:id', { preHandler: requireAdminRole }, async (request, reply) => {
    const { id } = request.params;
    try {
      const r = await pool.query(
        `SELECT scenario_order, stage_id FROM scenarios WHERE id = $1`,
        [id],
      );
      if (r.rows.length === 0) {
        return reply.status(404).send({ success: false, error: '場景不存在' });
      }
      if (r.rows[0].scenario_order === 1) {
        return reply
          .status(400)
          .send({ success: false, error: '不能刪除起始場景（scenario_order = 1）' });
      }
      await pool.query(`DELETE FROM scenarios WHERE id = $1`, [id]);
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, '刪除場景失敗');
      return reply.status(500).send({ success: false, error: '刪除場景失敗' });
    }
  });

  app.post<{ Params: { id: string }; Body: { new_order: number } }>(
    '/api/scenarios/:id/reorder',
    async (request, reply) => {
      const { id } = request.params;
      const { new_order } = request.body || ({} as any);
      if (!Number.isInteger(new_order) || new_order < 1) {
        return reply.status(400).send({ success: false, error: 'new_order 必須是正整數' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await client.query(
          `SELECT stage_id, scenario_order FROM scenarios WHERE id = $1`,
          [id],
        );
        if (r.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ success: false, error: '場景不存在' });
        }
        const { stage_id, scenario_order: oldOrder } = r.rows[0];

        // 先將目標位置的衝突記錄挪到 old 位置
        const swap = await client.query(
          `SELECT id FROM scenarios WHERE stage_id = $1 AND scenario_order = $2`,
          [stage_id, new_order],
        );
        if (swap.rows.length > 0 && swap.rows[0].id !== id) {
          await client.query(
            `UPDATE scenarios SET scenario_order = -1 WHERE id = $1`,
            [swap.rows[0].id],
          );
          await client.query(
            `UPDATE scenarios SET scenario_order = $1 WHERE id = $2`,
            [new_order, id],
          );
          await client.query(
            `UPDATE scenarios SET scenario_order = $1 WHERE id = $2`,
            [oldOrder, swap.rows[0].id],
          );
        } else {
          await client.query(
            `UPDATE scenarios SET scenario_order = $1 WHERE id = $2`,
            [new_order, id],
          );
        }
        await client.query('COMMIT');
        return reply.send({ success: true });
      } catch (error) {
        await client.query('ROLLBACK');
        request.log.error(error, '調整場景順序失敗');
        return reply.status(500).send({ success: false, error: '調整順序失敗' });
      } finally {
        client.release();
      }
    },
  );

  // ═══════════════════════════════════════════
  // Act cards
  // ═══════════════════════════════════════════

  app.get<{ Params: { stageId: string } }>(
    '/api/stages/:stageId/act-cards',
    async (request, reply) => {
      try {
        const res = await pool.query(
          `SELECT * FROM stage_act_cards WHERE stage_id = $1 ORDER BY card_order`,
          [request.params.stageId],
        );
        return reply.send({ success: true, data: res.rows });
      } catch (error) {
        request.log.error(error, '列出目標卡失敗');
        return reply.status(500).send({ success: false, error: '列出目標卡失敗' });
      }
    },
  );

  app.post<{ Params: { stageId: string }; Body: Record<string, any> }>(
    '/api/stages/:stageId/act-cards',
    async (request, reply) => {
      const { stageId } = request.params;
      const b = request.body || {};
      try {
        let order = b.card_order;
        if (!order) {
          const mRes = await pool.query(
            `SELECT COALESCE(MAX(card_order), 0) AS m FROM stage_act_cards WHERE stage_id = $1`,
            [stageId],
          );
          order = (mRes.rows[0].m || 0) + 1;
        }
        const res = await pool.query(
          `INSERT INTO stage_act_cards
             (stage_id, card_order, name_zh, name_en,
              front_narrative, front_objective_types, front_advance_condition, front_scaling,
              back_narrative, back_flag_sets, back_rewards, back_map_operations, back_resolution_code)
           VALUES ($1,$2,$3,$4,$5,$6::varchar[],$7::jsonb,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13)
           RETURNING *`,
          [
            stageId,
            order,
            b.name_zh || '',
            b.name_en || '',
            b.front_narrative || '',
            b.front_objective_types || [],
            JSON.stringify(b.front_advance_condition || {}),
            JSON.stringify(b.front_scaling || {}),
            b.back_narrative || '',
            JSON.stringify(b.back_flag_sets || []),
            JSON.stringify(b.back_rewards || {}),
            JSON.stringify(b.back_map_operations || []),
            b.back_resolution_code || null,
          ],
        );
        return reply.status(201).send({ success: true, data: res.rows[0] });
      } catch (error: any) {
        request.log.error(error, '建立目標卡失敗');
        if (error.code === '23505') {
          return reply.status(409).send({ success: false, error: '卡序衝突' });
        }
        return reply.status(500).send({ success: false, error: '建立目標卡失敗' });
      }
    },
  );

  app.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/act-cards/:id',
    async (request, reply) => {
      const { id } = request.params;
      const b = request.body || {};

      // 取得所屬 stage 做校驗
      const ctxRes = await pool.query(
        `SELECT ac.stage_id, s.stage_type
           FROM stage_act_cards ac
           JOIN stages s ON s.id = ac.stage_id
          WHERE ac.id = $1`,
        [id],
      );
      if (ctxRes.rows.length === 0) {
        return reply.status(404).send({ success: false, error: '目標卡不存在' });
      }
      const { stage_id, stage_type } = ctxRes.rows[0];

      // 校驗
      const flagCodes = extractFlagCodesFromSets(b.back_flag_sets);
      const ops = b.back_map_operations || [];
      const refs = extractReferencedCodes(ops);
      const [locV, famV] = await Promise.all([
        validateLocationCodes(refs.locations),
        validateMonsterFamilyCodes(refs.families),
      ]);
      let flagMissing: string[] = [];
      if (stage_type === 'main' && flagCodes.length > 0) {
        const f = await validateStageFlagCodes(stage_id, flagCodes);
        flagMissing = f.missing;
      }
      if (!locV.valid || !famV.valid || flagMissing.length > 0) {
        return reply.status(400).send(
          formatValidationError({
            flags: flagMissing,
            locations: locV.missing,
            families: famV.missing,
            boss_ids: [],
            mythos_cards: [],
            encounter_cards: [],
          }),
        );
      }

      const sets: string[] = [];
      const vals: any[] = [];
      let pi = 1;
      const push = (col: string, val: any, json = false, arr = false) => {
        if (val === undefined) return;
        if (arr) {
          sets.push(`${col} = $${pi++}::varchar[]`);
          vals.push(val);
        } else if (json) {
          sets.push(`${col} = $${pi++}::jsonb`);
          vals.push(JSON.stringify(val));
        } else {
          sets.push(`${col} = $${pi++}`);
          vals.push(val);
        }
      };
      push('name_zh', b.name_zh);
      push('name_en', b.name_en);
      push('front_narrative', b.front_narrative);
      if (b.front_objective_types !== undefined)
        push('front_objective_types', b.front_objective_types, false, true);
      if (b.front_advance_condition !== undefined)
        push('front_advance_condition', b.front_advance_condition, true);
      if (b.front_scaling !== undefined) push('front_scaling', b.front_scaling, true);
      push('back_narrative', b.back_narrative);
      if (b.back_flag_sets !== undefined) push('back_flag_sets', b.back_flag_sets, true);
      if (b.back_rewards !== undefined) push('back_rewards', b.back_rewards, true);
      if (b.back_map_operations !== undefined)
        push('back_map_operations', b.back_map_operations, true);
      push('back_resolution_code', b.back_resolution_code);

      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: '沒有可更新的欄位' });
      }
      sets.push(`updated_at = NOW()`);
      vals.push(id);
      try {
        const res = await pool.query(
          `UPDATE stage_act_cards SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`,
          vals,
        );
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, '更新目標卡失敗');
        return reply.status(500).send({ success: false, error: '更新目標卡失敗' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/act-cards/:id', { preHandler: requireAdminRole },
    async (request, reply) => {
      try {
        const res = await pool.query(
          `DELETE FROM stage_act_cards WHERE id = $1 RETURNING id`,
          [request.params.id],
        );
        if (res.rows.length === 0) {
          return reply.status(404).send({ success: false, error: '目標卡不存在' });
        }
        return reply.send({ success: true });
      } catch (error) {
        request.log.error(error, '刪除目標卡失敗');
        return reply.status(500).send({ success: false, error: '刪除目標卡失敗' });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { new_order: number } }>(
    '/api/act-cards/:id/reorder',
    async (request, reply) => {
      return reorderGeneric(
        pool,
        'stage_act_cards',
        request.params.id,
        request.body?.new_order,
        reply,
      );
    },
  );

  // ═══════════════════════════════════════════
  // Agenda cards
  // ═══════════════════════════════════════════

  app.get<{ Params: { stageId: string } }>(
    '/api/stages/:stageId/agenda-cards',
    async (request, reply) => {
      try {
        const res = await pool.query(
          `SELECT * FROM stage_agenda_cards WHERE stage_id = $1 ORDER BY card_order`,
          [request.params.stageId],
        );
        return reply.send({ success: true, data: res.rows });
      } catch (error) {
        request.log.error(error, '列出議案卡失敗');
        return reply.status(500).send({ success: false, error: '列出議案卡失敗' });
      }
    },
  );

  app.post<{ Params: { stageId: string }; Body: Record<string, any> }>(
    '/api/stages/:stageId/agenda-cards',
    async (request, reply) => {
      const { stageId } = request.params;
      const b = request.body || {};
      try {
        let order = b.card_order;
        if (!order) {
          const mRes = await pool.query(
            `SELECT COALESCE(MAX(card_order), 0) AS m FROM stage_agenda_cards WHERE stage_id = $1`,
            [stageId],
          );
          order = (mRes.rows[0].m || 0) + 1;
        }
        const res = await pool.query(
          `INSERT INTO stage_agenda_cards
             (stage_id, card_order, name_zh, name_en,
              front_narrative, front_doom_threshold,
              back_narrative, back_flag_sets, back_penalties, back_map_operations, back_resolution_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11)
           RETURNING *`,
          [
            stageId,
            order,
            b.name_zh || '',
            b.name_en || '',
            b.front_narrative || '',
            b.front_doom_threshold ?? 3,
            b.back_narrative || '',
            JSON.stringify(b.back_flag_sets || []),
            JSON.stringify(b.back_penalties || []),
            JSON.stringify(b.back_map_operations || []),
            b.back_resolution_code || null,
          ],
        );
        return reply.status(201).send({ success: true, data: res.rows[0] });
      } catch (error: any) {
        request.log.error(error, '建立議案卡失敗');
        if (error.code === '23505') {
          return reply.status(409).send({ success: false, error: '卡序衝突' });
        }
        return reply.status(500).send({ success: false, error: '建立議案卡失敗' });
      }
    },
  );

  app.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/agenda-cards/:id',
    async (request, reply) => {
      const { id } = request.params;
      const b = request.body || {};

      const ctxRes = await pool.query(
        `SELECT ag.stage_id, s.stage_type
           FROM stage_agenda_cards ag
           JOIN stages s ON s.id = ag.stage_id
          WHERE ag.id = $1`,
        [id],
      );
      if (ctxRes.rows.length === 0) {
        return reply.status(404).send({ success: false, error: '議案卡不存在' });
      }
      const { stage_id, stage_type } = ctxRes.rows[0];

      const flagCodes = extractFlagCodesFromSets(b.back_flag_sets);
      const refs = extractReferencedCodes(b.back_map_operations || []);
      for (const p of b.back_penalties || []) {
        for (const sp of p.spawn_monsters || []) {
          if (sp.family_code) refs.families.push(sp.family_code);
          if (sp.location_code) refs.locations.push(sp.location_code);
        }
      }
      const [locV, famV] = await Promise.all([
        validateLocationCodes(refs.locations),
        validateMonsterFamilyCodes(refs.families),
      ]);
      let flagMissing: string[] = [];
      if (stage_type === 'main' && flagCodes.length > 0) {
        const f = await validateStageFlagCodes(stage_id, flagCodes);
        flagMissing = f.missing;
      }
      if (!locV.valid || !famV.valid || flagMissing.length > 0) {
        return reply.status(400).send(
          formatValidationError({
            flags: flagMissing,
            locations: locV.missing,
            families: famV.missing,
            boss_ids: [],
            mythos_cards: [],
            encounter_cards: [],
          }),
        );
      }

      const sets: string[] = [];
      const vals: any[] = [];
      let pi = 1;
      const push = (col: string, val: any, json = false) => {
        if (val === undefined) return;
        if (json) {
          sets.push(`${col} = $${pi++}::jsonb`);
          vals.push(JSON.stringify(val));
        } else {
          sets.push(`${col} = $${pi++}`);
          vals.push(val);
        }
      };
      push('name_zh', b.name_zh);
      push('name_en', b.name_en);
      push('front_narrative', b.front_narrative);
      push('front_doom_threshold', b.front_doom_threshold);
      push('back_narrative', b.back_narrative);
      if (b.back_flag_sets !== undefined) push('back_flag_sets', b.back_flag_sets, true);
      if (b.back_penalties !== undefined) push('back_penalties', b.back_penalties, true);
      if (b.back_map_operations !== undefined)
        push('back_map_operations', b.back_map_operations, true);
      push('back_resolution_code', b.back_resolution_code);

      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: '沒有可更新的欄位' });
      }
      sets.push(`updated_at = NOW()`);
      vals.push(id);
      try {
        const res = await pool.query(
          `UPDATE stage_agenda_cards SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`,
          vals,
        );
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, '更新議案卡失敗');
        return reply.status(500).send({ success: false, error: '更新議案卡失敗' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/agenda-cards/:id', { preHandler: requireAdminRole },
    async (request, reply) => {
      try {
        const res = await pool.query(
          `DELETE FROM stage_agenda_cards WHERE id = $1 RETURNING id`,
          [request.params.id],
        );
        if (res.rows.length === 0) {
          return reply.status(404).send({ success: false, error: '議案卡不存在' });
        }
        return reply.send({ success: true });
      } catch (error) {
        request.log.error(error, '刪除議案卡失敗');
        return reply.status(500).send({ success: false, error: '刪除議案卡失敗' });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { new_order: number } }>(
    '/api/agenda-cards/:id/reorder',
    async (request, reply) => {
      return reorderGeneric(
        pool,
        'stage_agenda_cards',
        request.params.id,
        request.body?.new_order,
        reply,
      );
    },
  );

  // ═══════════════════════════════════════════
  // Encounter pool
  // ═══════════════════════════════════════════

  app.get<{ Params: { stageId: string } }>(
    '/api/stages/:stageId/encounter-pool',
    async (request, reply) => {
      try {
        const res = await pool.query(
          `SELECT ep.*, ec.name_zh AS card_name_zh, ec.encounter_type AS card_type
             FROM stage_encounter_pool ep
             LEFT JOIN encounter_cards ec ON ec.id = ep.encounter_card_id
            WHERE ep.stage_id = $1`,
          [request.params.stageId],
        );
        return reply.send({ success: true, data: res.rows });
      } catch (error) {
        request.log.error(error, '列出遭遇卡池失敗');
        return reply.status(500).send({ success: false, error: '列出遭遇卡池失敗' });
      }
    },
  );

  app.post<{
    Params: { stageId: string };
    Body: { encounter_card_id: string; weight?: number };
  }>('/api/stages/:stageId/encounter-pool', async (request, reply) => {
    const { stageId } = request.params;
    const { encounter_card_id, weight } = request.body || ({} as any);
    if (!isUuid(encounter_card_id)) {
      return reply
        .status(400)
        .send({ success: false, error: 'encounter_card_id 格式錯誤' });
    }
    const v = await validateEncounterCardIds([encounter_card_id]);
    if (!v.valid) {
      return reply.status(400).send(
        formatValidationError({
          flags: [],
          locations: [],
          families: [],
          boss_ids: [],
          mythos_cards: [],
          encounter_cards: v.missing,
        }),
      );
    }
    try {
      const res = await pool.query(
        `INSERT INTO stage_encounter_pool (stage_id, encounter_card_id, weight)
         VALUES ($1, $2, $3) RETURNING *`,
        [stageId, encounter_card_id, weight && weight > 0 ? weight : 1],
      );
      return reply.status(201).send({ success: true, data: res.rows[0] });
    } catch (error: any) {
      request.log.error(error, '加入遭遇卡失敗');
      if (error.code === '23505') {
        return reply.status(409).send({ success: false, error: '此遭遇卡已在池中' });
      }
      return reply.status(500).send({ success: false, error: '加入遭遇卡失敗' });
    }
  });

  app.put<{ Params: { id: string }; Body: { weight: number } }>(
    '/api/encounter-pool/:id',
    async (request, reply) => {
      const { id } = request.params;
      const { weight } = request.body || ({} as any);
      if (!Number.isInteger(weight) || weight < 1) {
        return reply.status(400).send({ success: false, error: 'weight 必須是正整數' });
      }
      try {
        const res = await pool.query(
          `UPDATE stage_encounter_pool SET weight = $1 WHERE id = $2 RETURNING *`,
          [weight, id],
        );
        if (res.rows.length === 0) {
          return reply.status(404).send({ success: false, error: '不存在' });
        }
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, '更新權重失敗');
        return reply.status(500).send({ success: false, error: '更新權重失敗' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/encounter-pool/:id', { preHandler: requireAdminRole },
    async (request, reply) => {
      try {
        await pool.query(`DELETE FROM stage_encounter_pool WHERE id = $1`, [
          request.params.id,
        ]);
        return reply.send({ success: true });
      } catch (error) {
        request.log.error(error, '移除遭遇卡失敗');
        return reply.status(500).send({ success: false, error: '移除遭遇卡失敗' });
      }
    },
  );

  // ═══════════════════════════════════════════
  // Mythos pool
  // ═══════════════════════════════════════════

  app.get<{ Params: { stageId: string } }>(
    '/api/stages/:stageId/mythos-pool',
    async (request, reply) => {
      try {
        const res = await pool.query(
          `SELECT mp.*, mc.name_zh AS card_name_zh, mc.card_category AS card_type
             FROM stage_mythos_pool mp
             LEFT JOIN mythos_cards mc ON mc.id = mp.mythos_card_id
            WHERE mp.stage_id = $1`,
          [request.params.stageId],
        );
        return reply.send({ success: true, data: res.rows });
      } catch (error) {
        request.log.error(error, '列出神話卡池失敗');
        return reply.status(500).send({ success: false, error: '列出神話卡池失敗' });
      }
    },
  );

  app.post<{
    Params: { stageId: string };
    Body: { mythos_card_id: string; weight?: number };
  }>('/api/stages/:stageId/mythos-pool', async (request, reply) => {
    const { stageId } = request.params;
    const { mythos_card_id, weight } = request.body || ({} as any);
    if (!isUuid(mythos_card_id)) {
      return reply
        .status(400)
        .send({ success: false, error: 'mythos_card_id 格式錯誤' });
    }
    const v = await validateMythosCardIds([mythos_card_id]);
    if (!v.valid) {
      return reply.status(400).send(
        formatValidationError({
          flags: [],
          locations: [],
          families: [],
          boss_ids: [],
          mythos_cards: v.missing,
          encounter_cards: [],
        }),
      );
    }
    try {
      const res = await pool.query(
        `INSERT INTO stage_mythos_pool (stage_id, mythos_card_id, weight)
         VALUES ($1, $2, $3) RETURNING *`,
        [stageId, mythos_card_id, weight && weight > 0 ? weight : 1],
      );
      return reply.status(201).send({ success: true, data: res.rows[0] });
    } catch (error: any) {
      request.log.error(error, '加入神話卡失敗');
      if (error.code === '23505') {
        return reply.status(409).send({ success: false, error: '此神話卡已在池中' });
      }
      return reply.status(500).send({ success: false, error: '加入神話卡失敗' });
    }
  });

  app.put<{ Params: { id: string }; Body: { weight: number } }>(
    '/api/mythos-pool/:id',
    async (request, reply) => {
      const { id } = request.params;
      const { weight } = request.body || ({} as any);
      if (!Number.isInteger(weight) || weight < 1) {
        return reply.status(400).send({ success: false, error: 'weight 必須是正整數' });
      }
      try {
        const res = await pool.query(
          `UPDATE stage_mythos_pool SET weight = $1 WHERE id = $2 RETURNING *`,
          [weight, id],
        );
        if (res.rows.length === 0) {
          return reply.status(404).send({ success: false, error: '不存在' });
        }
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, '更新權重失敗');
        return reply.status(500).send({ success: false, error: '更新權重失敗' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/mythos-pool/:id', { preHandler: requireAdminRole },
    async (request, reply) => {
      try {
        await pool.query(`DELETE FROM stage_mythos_pool WHERE id = $1`, [
          request.params.id,
        ]);
        return reply.send({ success: true });
      } catch (error) {
        request.log.error(error, '移除神話卡失敗');
        return reply.status(500).send({ success: false, error: '移除神話卡失敗' });
      }
    },
  );

  // ═══════════════════════════════════════════
  // Chaos bag
  // ═══════════════════════════════════════════

  app.get<{ Params: { stageId: string } }>(
    '/api/stages/:stageId/chaos-bag',
    async (request, reply) => {
      try {
        const res = await pool.query(
          `SELECT * FROM stage_chaos_bag WHERE stage_id = $1`,
          [request.params.stageId],
        );
        if (res.rows.length === 0) {
          return reply.send({
            success: true,
            data: {
              stage_id: request.params.stageId,
              difficulty_preset: 'standard',
              number_markers: {},
              scenario_markers: {},
              mythos_markers: {},
              dynamic_markers: { bless: 0, curse: 0 },
            },
          });
        }
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, '取得混沌袋失敗');
        return reply.status(500).send({ success: false, error: '取得混沌袋失敗' });
      }
    },
  );

  app.put<{ Params: { stageId: string }; Body: Record<string, any> }>(
    '/api/stages/:stageId/chaos-bag',
    async (request, reply) => {
      const { stageId } = request.params;
      const b = request.body || {};
      const preset = VALID_DIFFICULTY.has(b.difficulty_preset)
        ? b.difficulty_preset
        : 'standard';
      try {
        const res = await pool.query(
          `INSERT INTO stage_chaos_bag (stage_id, difficulty_preset,
                                        number_markers, scenario_markers,
                                        mythos_markers, dynamic_markers)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb)
           ON CONFLICT (stage_id) DO UPDATE
             SET difficulty_preset = EXCLUDED.difficulty_preset,
                 number_markers = EXCLUDED.number_markers,
                 scenario_markers = EXCLUDED.scenario_markers,
                 mythos_markers = EXCLUDED.mythos_markers,
                 dynamic_markers = EXCLUDED.dynamic_markers
           RETURNING *`,
          [
            stageId,
            preset,
            JSON.stringify(b.number_markers || {}),
            JSON.stringify(b.scenario_markers || {}),
            JSON.stringify(b.mythos_markers || {}),
            JSON.stringify(b.dynamic_markers || { bless: 0, curse: 0 }),
          ],
        );
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, '儲存混沌袋失敗');
        return reply.status(500).send({ success: false, error: '儲存混沌袋失敗' });
      }
    },
  );

  // POST /api/stages/:stageId/chaos-bag/reset-from-campaign
  // 從關卡所屬戰役的 initial_chaos_bag 重置(只適用 main stage)
  app.post<{ Params: { stageId: string } }>(
    '/api/stages/:stageId/chaos-bag/reset-from-campaign',
    async (request, reply) => {
      const { stageId } = request.params;
      try {
        const campRes = await pool.query(
          `SELECT c.difficulty_tier, c.initial_chaos_bag, s.stage_type
             FROM stages s
             LEFT JOIN chapters ch ON ch.id = s.chapter_id
             LEFT JOIN campaigns c ON c.id = ch.campaign_id
             WHERE s.id = $1`,
          [stageId],
        );
        if (campRes.rows.length === 0) {
          return reply.status(404).send({ success: false, error: '關卡不存在' });
        }
        const row = campRes.rows[0];
        if (row.stage_type !== 'main' || !row.initial_chaos_bag) {
          return reply.status(400).send({
            success: false,
            error: '此關卡不屬於戰役主線,無法從戰役繼承',
          });
        }
        const bag = row.initial_chaos_bag;
        const preset = VALID_DIFFICULTY.has(row.difficulty_tier) ? row.difficulty_tier : 'standard';
        const upRes = await pool.query(
          `INSERT INTO stage_chaos_bag (stage_id, difficulty_preset,
                                        number_markers, scenario_markers,
                                        mythos_markers, dynamic_markers)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb)
           ON CONFLICT (stage_id) DO UPDATE
             SET difficulty_preset = EXCLUDED.difficulty_preset,
                 number_markers = EXCLUDED.number_markers,
                 scenario_markers = EXCLUDED.scenario_markers,
                 mythos_markers = EXCLUDED.mythos_markers,
                 dynamic_markers = EXCLUDED.dynamic_markers
           RETURNING *`,
          [
            stageId,
            preset,
            JSON.stringify(bag.number_markers || {}),
            JSON.stringify(bag.scenario_markers || {}),
            JSON.stringify(bag.mythos_markers || {}),
            JSON.stringify({ bless: 0, curse: 0 }),
          ],
        );
        return reply.send({ success: true, data: upRes.rows[0] });
      } catch (error) {
        request.log.error(error, '從戰役重置混沌袋失敗');
        return reply.status(500).send({ success: false, error: '從戰役重置混沌袋失敗' });
      }
    },
  );

  // ═══════════════════════════════════════════
  // Monster pool
  // ═══════════════════════════════════════════

  app.get<{ Params: { stageId: string } }>(
    '/api/stages/:stageId/monster-pool',
    async (request, reply) => {
      try {
        const res = await pool.query(
          `SELECT mp.*, mf.name_zh AS family_name_zh
             FROM stage_monster_pool mp
             LEFT JOIN monster_families mf ON mf.code = mp.family_code
            WHERE mp.stage_id = $1`,
          [request.params.stageId],
        );
        return reply.send({ success: true, data: res.rows });
      } catch (error) {
        request.log.error(error, '列出家族池失敗');
        return reply.status(500).send({ success: false, error: '列出家族池失敗' });
      }
    },
  );

  app.post<{ Params: { stageId: string }; Body: Record<string, any> }>(
    '/api/stages/:stageId/monster-pool',
    async (request, reply) => {
      const { stageId } = request.params;
      const b = request.body || {};
      if (!b.family_code) {
        return reply.status(400).send({ success: false, error: 'family_code 為必填' });
      }
      if (!VALID_ROLES.has(b.role)) {
        return reply.status(400).send({ success: false, error: 'role 不合法' });
      }
      const tiers: string[] = Array.isArray(b.allowed_tiers) ? b.allowed_tiers : [];
      for (const t of tiers) {
        if (!VALID_TIERS.has(t)) {
          return reply.status(400).send({ success: false, error: `位階 ${t} 不合法` });
        }
      }
      const bossIds: string[] = Array.isArray(b.fixed_boss_ids) ? b.fixed_boss_ids : [];

      const [famV, bossV] = await Promise.all([
        validateMonsterFamilyCodes([b.family_code]),
        validateMonsterVariantIds(bossIds),
      ]);
      if (!famV.valid || !bossV.valid) {
        return reply.status(400).send(
          formatValidationError({
            flags: [],
            locations: [],
            families: famV.missing,
            boss_ids: bossV.missing,
            mythos_cards: [],
            encounter_cards: [],
          }),
        );
      }

      try {
        const res = await pool.query(
          `INSERT INTO stage_monster_pool
             (stage_id, family_code, role, allowed_tiers, fixed_boss_ids)
           VALUES ($1, $2, $3, $4::varchar[], $5::uuid[])
           RETURNING *`,
          [stageId, b.family_code, b.role, tiers, bossIds],
        );
        return reply.status(201).send({ success: true, data: res.rows[0] });
      } catch (error: any) {
        request.log.error(error, '加入家族失敗');
        if (error.code === '23505') {
          return reply.status(409).send({ success: false, error: '此家族已在池中' });
        }
        return reply.status(500).send({ success: false, error: '加入家族失敗' });
      }
    },
  );

  app.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/monster-pool/:id',
    async (request, reply) => {
      const { id } = request.params;
      const b = request.body || {};

      const sets: string[] = [];
      const vals: any[] = [];
      let pi = 1;
      if (b.role !== undefined) {
        if (!VALID_ROLES.has(b.role)) {
          return reply.status(400).send({ success: false, error: 'role 不合法' });
        }
        sets.push(`role = $${pi++}`);
        vals.push(b.role);
      }
      if (b.allowed_tiers !== undefined) {
        for (const t of b.allowed_tiers) {
          if (!VALID_TIERS.has(t)) {
            return reply.status(400).send({ success: false, error: `位階 ${t} 不合法` });
          }
        }
        sets.push(`allowed_tiers = $${pi++}::varchar[]`);
        vals.push(b.allowed_tiers);
      }
      if (b.fixed_boss_ids !== undefined) {
        const bossV = await validateMonsterVariantIds(b.fixed_boss_ids);
        if (!bossV.valid) {
          return reply.status(400).send(
            formatValidationError({
              flags: [],
              locations: [],
              families: [],
              boss_ids: bossV.missing,
              mythos_cards: [],
              encounter_cards: [],
            }),
          );
        }
        sets.push(`fixed_boss_ids = $${pi++}::uuid[]`);
        vals.push(b.fixed_boss_ids);
      }
      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: '沒有可更新的欄位' });
      }
      vals.push(id);
      try {
        const res = await pool.query(
          `UPDATE stage_monster_pool SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`,
          vals,
        );
        if (res.rows.length === 0) {
          return reply.status(404).send({ success: false, error: '不存在' });
        }
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, '更新家族失敗');
        return reply.status(500).send({ success: false, error: '更新家族失敗' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/monster-pool/:id', { preHandler: requireAdminRole },
    async (request, reply) => {
      try {
        await pool.query(`DELETE FROM stage_monster_pool WHERE id = $1`, [
          request.params.id,
        ]);
        return reply.send({ success: true });
      } catch (error) {
        request.log.error(error, '移除家族失敗');
        return reply.status(500).send({ success: false, error: '移除家族失敗' });
      }
    },
  );

  // ═══════════════════════════════════════════
  // Random dungeon generator
  // ═══════════════════════════════════════════

  app.get<{ Params: { stageId: string } }>(
    '/api/stages/:stageId/random-generator',
    async (request, reply) => {
      try {
        const res = await pool.query(
          `SELECT * FROM random_dungeon_generators WHERE stage_id = $1`,
          [request.params.stageId],
        );
        if (res.rows.length === 0) {
          return reply.status(404).send({ success: false, error: '產生器不存在' });
        }
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, '取得產生器失敗');
        return reply.status(500).send({ success: false, error: '取得產生器失敗' });
      }
    },
  );

  app.put<{ Params: { stageId: string }; Body: Record<string, any> }>(
    '/api/stages/:stageId/random-generator',
    async (request, reply) => {
      const { stageId } = request.params;
      const b = request.body || {};
      try {
        const res = await pool.query(
          `INSERT INTO random_dungeon_generators
             (stage_id, location_pool, topology_rules, act_template_pool, agenda_template_pool,
              monster_rules, chaos_bag_rules, mythos_pool_rules, encounter_pool_rules,
              victory_conditions, reward_rules)
           VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb,
                   $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb,
                   $10::jsonb, $11::jsonb)
           ON CONFLICT (stage_id) DO UPDATE
             SET location_pool = EXCLUDED.location_pool,
                 topology_rules = EXCLUDED.topology_rules,
                 act_template_pool = EXCLUDED.act_template_pool,
                 agenda_template_pool = EXCLUDED.agenda_template_pool,
                 monster_rules = EXCLUDED.monster_rules,
                 chaos_bag_rules = EXCLUDED.chaos_bag_rules,
                 mythos_pool_rules = EXCLUDED.mythos_pool_rules,
                 encounter_pool_rules = EXCLUDED.encounter_pool_rules,
                 victory_conditions = EXCLUDED.victory_conditions,
                 reward_rules = EXCLUDED.reward_rules
           RETURNING *`,
          [
            stageId,
            JSON.stringify(b.location_pool || []),
            JSON.stringify(b.topology_rules || {}),
            JSON.stringify(b.act_template_pool || {}),
            JSON.stringify(b.agenda_template_pool || {}),
            JSON.stringify(b.monster_rules || {}),
            JSON.stringify(b.chaos_bag_rules || {}),
            JSON.stringify(b.mythos_pool_rules || {}),
            JSON.stringify(b.encounter_pool_rules || {}),
            JSON.stringify(b.victory_conditions || []),
            JSON.stringify(b.reward_rules || {}),
          ],
        );
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, '儲存產生器失敗');
        return reply.status(500).send({ success: false, error: '儲存產生器失敗' });
      }
    },
  );

  app.post<{ Params: { stageId: string }; Body: { seed?: string } }>(
    '/api/stages/:stageId/random-generator/generate',
    async (request, reply) => {
      const { stageId } = request.params;
      const { seed } = request.body || {};
      const sRes = await pool.query(
        `SELECT stage_type FROM stages WHERE id = $1`,
        [stageId],
      );
      if (sRes.rows.length === 0) {
        return reply.status(404).send({ success: false, error: '關卡不存在' });
      }
      if (sRes.rows[0].stage_type !== 'side_random') {
        return reply
          .status(400)
          .send({ success: false, error: '此關卡非隨機地城類型' });
      }

      const client = await pool.connect();
      try {
        const finalSeed = seed || Math.random().toString(36).substring(2, 12);
        const result = await generateRandomDungeon(stageId, finalSeed, client);
        await client.query(
          `UPDATE random_dungeon_generators SET seed_verified_at = NOW() WHERE stage_id = $1`,
          [stageId],
        );
        return reply.send({ success: true, data: result });
      } catch (error: any) {
        request.log.error(error, '隨機地城產生失敗');
        return reply
          .status(500)
          .send({ success: false, error: error.message || '產生失敗' });
      } finally {
        client.release();
      }
    },
  );

  // ═══════════════════════════════════════════
  // References check + export
  // ═══════════════════════════════════════════

  app.get<{ Params: { id: string } }>(
    '/api/stages/:id/references-check',
    async (request, reply) => {
      try {
        const full = await loadFullStage(request.params.id);
        if (!full) return reply.status(404).send({ success: false, error: '關卡不存在' });
        const v = await validateStageReferences(full);
        return reply.send({ success: true, data: { valid: v.valid, missing: v.missing } });
      } catch (error) {
        request.log.error(error, '引用檢查失敗');
        return reply.status(500).send({ success: false, error: '引用檢查失敗' });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/stages/:id/export',
    async (request, reply) => {
      try {
        const full = await loadFullStage(request.params.id);
        if (!full) return reply.status(404).send({ success: false, error: '關卡不存在' });
        reply.header(
          'Content-Disposition',
          `attachment; filename="stage_${full.code}.json"`,
        );
        return reply.send({
          format_version: '1.0',
          exported_at: new Date().toISOString(),
          stage: full,
        });
      } catch (error) {
        request.log.error(error, '匯出關卡失敗');
        return reply.status(500).send({ success: false, error: '匯出關卡失敗' });
      }
    },
  );
};

// ──────────────────────────────────────────────
// Reorder helper（內部）
// ──────────────────────────────────────────────
async function reorderGeneric(
  pg: typeof pool,
  table: string,
  id: string,
  newOrder: number,
  reply: any,
): Promise<any> {
  if (!Number.isInteger(newOrder) || newOrder < 1) {
    return reply.status(400).send({ success: false, error: 'new_order 必須是正整數' });
  }
  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT stage_id, card_order FROM ${table} WHERE id = $1`,
      [id],
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply.status(404).send({ success: false, error: '不存在' });
    }
    const { stage_id, card_order: oldOrder } = r.rows[0];
    const swap = await client.query(
      `SELECT id FROM ${table} WHERE stage_id = $1 AND card_order = $2`,
      [stage_id, newOrder],
    );
    if (swap.rows.length > 0 && swap.rows[0].id !== id) {
      await client.query(`UPDATE ${table} SET card_order = -1 WHERE id = $1`, [
        swap.rows[0].id,
      ]);
      await client.query(`UPDATE ${table} SET card_order = $1 WHERE id = $2`, [
        newOrder,
        id,
      ]);
      await client.query(`UPDATE ${table} SET card_order = $1 WHERE id = $2`, [
        oldOrder,
        swap.rows[0].id,
      ]);
    } else {
      await client.query(`UPDATE ${table} SET card_order = $1 WHERE id = $2`, [
        newOrder,
        id,
      ]);
    }
    await client.query('COMMIT');
    return reply.send({ success: true });
  } catch (error: any) {
    await client.query('ROLLBACK');
    return reply.status(500).send({ success: false, error: '調整順序失敗' });
  } finally {
    client.release();
  }
}
