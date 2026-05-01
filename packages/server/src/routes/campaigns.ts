// MOD-06 戰役敘事設計器 — 後端 routes
// 實作 Part 1：§3 所有端點 + §4 跨模組校驗 + 建立戰役時自動產生十章骨架

import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { requireAuth, requireAdminRole } from '../middleware/auth.js';
import {
  validateFlagCodes,
  validateMonsterFamilyCodes,
  validateMythosCardCodes,
  validateTeamSpiritCodes,
  extractFlagCodesFromExpression,
  extractReferencedCodes,
} from '../utils/campaign-validators.js';

// ──────────────────────────────────────────────
// 常數與 helpers
// ──────────────────────────────────────────────

const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const VALID_DIFFICULTY = new Set(['easy', 'standard', 'hard', 'expert']);
const VALID_DESIGN_STATUS = new Set(['draft', 'review', 'published']);
const VALID_CAMPAIGN_TYPES = new Set(['main', 'side']);
const MIN_CHAPTER_COUNT = 1;
const MAX_CHAPTER_COUNT = 10;
const VALID_FLAG_CATEGORIES = new Set([
  'act', 'agenda', 'npc', 'item', 'location',
  'choice', 'outcome', 'time', 'hidden',
]);
const VALID_VISIBILITIES = new Set(['visible', 'conditional', 'hidden']);
const VALID_OUTCOME_CODES = new Set(['A', 'B', 'C', 'D', 'E']);
const VALID_INSERTION_POINTS = new Set(['prologue', 'epilogue']);

const CODE_RE = /^[a-z0-9_]{3,32}$/;
const FLAG_CODE_RE = /^[a-z_]+\.[a-z0-9_]+$/;

function makeChapterName(n: number): string {
  return `第${CHINESE_DIGITS[n] ?? n}章`;
}

// ──────────────────────────────────────────────
// 校驗彙整（for POST/PUT outcomes 與 interlude_events）
// ──────────────────────────────────────────────

async function collectAndValidateReferences(
  campaignId: string,
  opts: {
    condition_expression?: unknown;
    trigger_condition?: unknown;
    operations?: unknown[];
    flag_sets?: unknown[];
  },
): Promise<{ ok: true } | { ok: false; status: number; body: any }> {
  const flagsFromExprs = [
    ...extractFlagCodesFromExpression(opts.condition_expression),
    ...extractFlagCodesFromExpression(opts.trigger_condition),
  ];
  const refs = extractReferencedCodes(opts.operations, opts.flag_sets);
  const allFlags = [...new Set([...flagsFromExprs, ...refs.flags])];

  const [flagsV, familiesV, mythosV, spiritsV] = await Promise.all([
    validateFlagCodes(campaignId, allFlags),
    validateMonsterFamilyCodes(refs.families),
    validateMythosCardCodes(refs.mythos),
    validateTeamSpiritCodes(refs.spirits),
  ]);

  const anyMissing =
    flagsV.missing.length > 0 ||
    familiesV.missing.length > 0 ||
    mythosV.missing.length > 0 ||
    spiritsV.missing.length > 0;

  if (anyMissing) {
    return {
      ok: false,
      status: 400,
      body: {
        error: '驗證失敗',
        details: {
          missing_flags: flagsV.missing,
          missing_families: familiesV.missing,
          missing_mythos: mythosV.missing,
          missing_spirits: spiritsV.missing,
        },
      },
    };
  }
  return { ok: true };
}

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────

export const campaignRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // ═══════════════════════════════════════════
  // 戰役
  // ═══════════════════════════════════════════

  // GET /api/campaigns
  app.get<{ Querystring: { status?: string; search?: string } }>(
    '/api/campaigns',
    async (request, reply) => {
      const { status, search } = request.query;
      const conds: string[] = [];
      const vals: any[] = [];
      let pi = 1;
      if (status && VALID_DESIGN_STATUS.has(status)) {
        conds.push(`design_status = $${pi++}`);
        vals.push(status);
      }
      if (search) {
        conds.push(`(name_zh ILIKE $${pi} OR code ILIKE $${pi})`);
        vals.push(`%${search}%`);
        pi++;
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      try {
        const result = await pool.query(
          `SELECT c.id, c.code, c.name_zh, c.name_en, c.theme,
                  c.difficulty_tier, c.design_status, c.version,
                  c.created_at, c.updated_at,
                  (SELECT COUNT(*) FROM chapters ch WHERE ch.campaign_id = c.id)::int AS chapter_count
             FROM campaigns c
             ${where}
             ORDER BY c.created_at DESC`,
          vals,
        );
        return reply.send({ success: true, data: result.rows });
      } catch (error) {
        request.log.error(error, '列出戰役失敗');
        return reply.status(500).send({ success: false, error: '列出戰役失敗' });
      }
    },
  );

  // GET /api/campaigns/:id
  app.get<{ Params: { id: string } }>('/api/campaigns/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const cRes = await pool.query('SELECT * FROM campaigns WHERE id = $1', [id]);
      if (cRes.rows.length === 0) {
        return reply.status(404).send({ success: false, error: '戰役不存在' });
      }
      const chRes = await pool.query(
        `SELECT ch.*,
                (SELECT COUNT(*) FROM chapter_outcomes WHERE chapter_id = ch.id)::int AS outcome_count,
                (SELECT COUNT(*) FROM interlude_events WHERE chapter_id = ch.id)::int AS interlude_count
           FROM chapters ch
          WHERE ch.campaign_id = $1
          ORDER BY ch.chapter_number`,
        [id],
      );
      const flagCountRes = await pool.query(
        `SELECT COUNT(*)::int AS n FROM campaign_flags WHERE campaign_id = $1`,
        [id],
      );
      return reply.send({
        success: true,
        data: {
          ...cRes.rows[0],
          chapters: chRes.rows,
          flag_count: flagCountRes.rows[0].n,
        },
      });
    } catch (error) {
      request.log.error(error, '取得戰役失敗');
      return reply.status(500).send({ success: false, error: '取得戰役失敗' });
    }
  });

  // POST /api/campaigns ── 建立戰役 + 自動十章骨架（交易）
  app.post<{ Body: Record<string, any> }>('/api/campaigns', async (request, reply) => {
    const b = request.body || {};
    if (!b.code || !CODE_RE.test(b.code)) {
      return reply.status(400).send({ success: false, error: '戰役代碼格式錯誤（3–32 字元小寫英數底線）' });
    }
    if (!b.name_zh || typeof b.name_zh !== 'string' || b.name_zh.length === 0) {
      return reply.status(400).send({ success: false, error: '中文名稱為必填' });
    }
    const difficulty = VALID_DIFFICULTY.has(b.difficulty_tier) ? b.difficulty_tier : 'standard';
    const campaignType = VALID_CAMPAIGN_TYPES.has(b.campaign_type) ? b.campaign_type : 'main';
    let chapterCount: number;
    if (b.chapter_count !== undefined) {
      const n = Number(b.chapter_count);
      if (!Number.isInteger(n) || n < MIN_CHAPTER_COUNT || n > MAX_CHAPTER_COUNT) {
        return reply.status(400).send({
          success: false,
          error: `章節數必須是 ${MIN_CHAPTER_COUNT}-${MAX_CHAPTER_COUNT} 之間的整數`,
        });
      }
      chapterCount = n;
    } else {
      // 沒指定:主線預設 10、支線預設 1
      chapterCount = campaignType === 'side' ? 1 : 10;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const cRes = await client.query(
        `INSERT INTO campaigns (code, name_zh, name_en, theme, cover_narrative,
                                difficulty_tier, initial_chaos_bag, design_status,
                                campaign_type, chapter_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
         RETURNING *`,
        [
          b.code, b.name_zh, b.name_en || '', b.theme || '', b.cover_narrative || '',
          difficulty,
          JSON.stringify(b.initial_chaos_bag || {}),
          'draft',
          campaignType,
          chapterCount,
        ],
      );
      const campaign = cRes.rows[0];

      for (let n = 1; n <= chapterCount; n++) {
        await client.query(
          `INSERT INTO chapters (campaign_id, chapter_number, chapter_code, name_zh)
           VALUES ($1, $2, $3, $4)`,
          [campaign.id, n, `ch${n}`, makeChapterName(n)],
        );
      }

      await client.query('COMMIT');

      // 回傳完整資料（同 GET /:id 格式）
      const chRes = await pool.query(
        `SELECT ch.*, 0 AS outcome_count, 0 AS interlude_count
           FROM chapters ch WHERE ch.campaign_id = $1 ORDER BY ch.chapter_number`,
        [campaign.id],
      );
      return reply.status(201).send({
        success: true,
        data: { ...campaign, chapters: chRes.rows, flag_count: 0 },
      });
    } catch (error: any) {
      await client.query('ROLLBACK');
      request.log.error(error, '建立戰役失敗');
      if (error.code === '23505') {
        return reply.status(409).send({ success: false, error: '戰役代碼已存在' });
      }
      // 暫時回 detail 用於診斷 migration 028 是否生效
      return reply.status(500).send({
        success: false,
        error: '建立戰役失敗',
        detail: String(error?.message || error),
        sql_code: error?.code,
      });
    } finally {
      client.release();
    }
  });

  // PUT /api/campaigns/:id
  app.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/campaigns/:id',
    async (request, reply) => {
      const { id } = request.params;
      const b = request.body || {};
      const sets: string[] = [];
      const vals: any[] = [];
      let pi = 1;
      const pushSet = (col: string, val: any, json = false) => {
        if (val === undefined) return;
        if (json) {
          sets.push(`${col} = $${pi++}::jsonb`);
          vals.push(JSON.stringify(val));
        } else {
          sets.push(`${col} = $${pi++}`);
          vals.push(val);
        }
      };
      pushSet('name_zh', b.name_zh);
      pushSet('name_en', b.name_en);
      pushSet('theme', b.theme);
      pushSet('cover_narrative', b.cover_narrative);
      if (b.difficulty_tier !== undefined) {
        if (!VALID_DIFFICULTY.has(b.difficulty_tier)) {
          return reply.status(400).send({ success: false, error: '難度值不合法' });
        }
        pushSet('difficulty_tier', b.difficulty_tier);
      }
      if (b.initial_chaos_bag !== undefined) pushSet('initial_chaos_bag', b.initial_chaos_bag, true);
      if (b.design_status !== undefined) {
        if (!VALID_DESIGN_STATUS.has(b.design_status)) {
          return reply.status(400).send({ success: false, error: '設計狀態不合法' });
        }
        pushSet('design_status', b.design_status);
      }
      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: '沒有可更新的欄位' });
      }
      sets.push(`version = version + 1`);
      sets.push(`updated_at = NOW()`);
      vals.push(id);
      try {
        const res = await pool.query(
          `UPDATE campaigns SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`,
          vals,
        );
        if (res.rows.length === 0) {
          return reply.status(404).send({ success: false, error: '戰役不存在' });
        }
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, '更新戰役失敗');
        return reply.status(500).send({ success: false, error: '更新戰役失敗' });
      }
    },
  );

  // DELETE /api/campaigns/:id
  app.delete<{ Params: { id: string } }>('/api/campaigns/:id', { preHandler: requireAdminRole }, async (request, reply) => {
    const { id } = request.params;
    try {
      const res = await pool.query('DELETE FROM campaigns WHERE id = $1 RETURNING id', [id]);
      if (res.rows.length === 0) {
        return reply.status(404).send({ success: false, error: '戰役不存在' });
      }
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, '刪除戰役失敗');
      return reply.status(500).send({ success: false, error: '刪除戰役失敗' });
    }
  });

  // ═══════════════════════════════════════════
  // 章節
  // ═══════════════════════════════════════════

  // GET /api/campaigns/:id/chapters
  app.get<{ Params: { id: string } }>(
    '/api/campaigns/:id/chapters',
    async (request, reply) => {
      try {
        const res = await pool.query(
          `SELECT * FROM chapters WHERE campaign_id = $1 ORDER BY chapter_number`,
          [request.params.id],
        );
        return reply.send({ success: true, data: res.rows });
      } catch (error) {
        request.log.error(error, '列出章節失敗');
        return reply.status(500).send({ success: false, error: '列出章節失敗' });
      }
    },
  );

  // GET /api/chapters/:id ── 完整章節（含 outcomes / interlude / linked_stages 容錯）
  app.get<{ Params: { id: string } }>('/api/chapters/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const cRes = await pool.query('SELECT * FROM chapters WHERE id = $1', [id]);
      if (cRes.rows.length === 0) {
        return reply.status(404).send({ success: false, error: '章節不存在' });
      }
      const [oRes, iRes] = await Promise.all([
        pool.query(
          `SELECT * FROM chapter_outcomes WHERE chapter_id = $1 ORDER BY outcome_code`,
          [id],
        ),
        pool.query(
          `SELECT * FROM interlude_events WHERE chapter_id = $1
            ORDER BY CASE insertion_point WHEN 'prologue' THEN 0 ELSE 1 END, created_at`,
          [id],
        ),
      ]);

      // MOD-07 stages 表容錯（尚未建置時回空陣列）
      let linked_stages: any[] = [];
      try {
        const sRes = await pool.query(
          `SELECT id, code, name_zh, design_status FROM stages WHERE chapter_id = $1`,
          [id],
        );
        linked_stages = sRes.rows;
      } catch {
        linked_stages = [];
      }

      return reply.send({
        success: true,
        data: {
          ...cRes.rows[0],
          outcomes: oRes.rows,
          interlude_events: iRes.rows,
          linked_stages,
        },
      });
    } catch (error) {
      request.log.error(error, '取得章節失敗');
      return reply.status(500).send({ success: false, error: '取得章節失敗' });
    }
  });

  // PUT /api/chapters/:id
  app.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/chapters/:id',
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
          vals.push(JSON.stringify(val));
        } else {
          sets.push(`${col} = $${pi++}`);
          vals.push(val);
        }
      };
      push('chapter_code', b.chapter_code);
      push('name_zh', b.name_zh);
      push('name_en', b.name_en);
      push('narrative_intro', b.narrative_intro);
      if (b.narrative_choices !== undefined) push('narrative_choices', b.narrative_choices, true);
      if (b.design_status !== undefined) {
        if (!VALID_DESIGN_STATUS.has(b.design_status)) {
          return reply.status(400).send({ success: false, error: '設計狀態不合法' });
        }
        push('design_status', b.design_status);
      }
      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: '沒有可更新的欄位' });
      }
      sets.push(`updated_at = NOW()`);
      vals.push(id);
      try {
        const res = await pool.query(
          `UPDATE chapters SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`,
          vals,
        );
        if (res.rows.length === 0) {
          return reply.status(404).send({ success: false, error: '章節不存在' });
        }
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error: any) {
        request.log.error(error, '更新章節失敗');
        if (error.code === '23505') {
          return reply.status(409).send({ success: false, error: '章節縮寫衝突' });
        }
        return reply.status(500).send({ success: false, error: '更新章節失敗' });
      }
    },
  );

  // ═══════════════════════════════════════════
  // 章節結果分支
  // ═══════════════════════════════════════════

  // GET /api/chapters/:chapterId/outcomes
  app.get<{ Params: { chapterId: string } }>(
    '/api/chapters/:chapterId/outcomes',
    async (request, reply) => {
      try {
        const res = await pool.query(
          `SELECT * FROM chapter_outcomes WHERE chapter_id = $1 ORDER BY outcome_code`,
          [request.params.chapterId],
        );
        return reply.send({ success: true, data: res.rows });
      } catch (error) {
        request.log.error(error, '列出結果分支失敗');
        return reply.status(500).send({ success: false, error: '列出結果分支失敗' });
      }
    },
  );

  // 內部 helper：共用 POST/PUT 校驗與校驗章節歸屬
  async function fetchChapterAndCampaign(chapterId: string) {
    const res = await pool.query(
      `SELECT ch.*, ch.campaign_id FROM chapters ch WHERE ch.id = $1`,
      [chapterId],
    );
    return res.rows[0] || null;
  }

  // POST /api/chapters/:chapterId/outcomes
  app.post<{ Params: { chapterId: string }; Body: Record<string, any> }>(
    '/api/chapters/:chapterId/outcomes',
    async (request, reply) => {
      const { chapterId } = request.params;
      const b = request.body || {};
      if (!VALID_OUTCOME_CODES.has(b.outcome_code)) {
        return reply.status(400).send({ success: false, error: 'outcome_code 必須為 A–E 之一' });
      }
      const chapter = await fetchChapterAndCampaign(chapterId);
      if (!chapter) return reply.status(404).send({ success: false, error: '章節不存在' });

      const vr = await collectAndValidateReferences(chapter.campaign_id, {
        condition_expression: b.condition_expression,
        flag_sets: b.flag_sets,
      });
      if (!vr.ok) return reply.status(vr.status).send(vr.body);

      try {
        const res = await pool.query(
          `INSERT INTO chapter_outcomes
             (chapter_id, outcome_code, condition_expression, narrative_text,
              next_chapter_version, chaos_bag_changes, rewards, flag_sets)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
           RETURNING *`,
          [
            chapterId, b.outcome_code,
            JSON.stringify(b.condition_expression || {}),
            b.narrative_text || '',
            b.next_chapter_version || null,
            JSON.stringify(b.chaos_bag_changes || []),
            JSON.stringify(b.rewards || {}),
            JSON.stringify(b.flag_sets || []),
          ],
        );
        return reply.status(201).send({ success: true, data: res.rows[0] });
      } catch (error: any) {
        request.log.error(error, '建立結果分支失敗');
        if (error.code === '23505') {
          return reply.status(409).send({ success: false, error: '該章節已有相同 outcome_code' });
        }
        return reply.status(500).send({ success: false, error: '建立結果分支失敗' });
      }
    },
  );

  // PUT /api/outcomes/:id
  app.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/outcomes/:id',
    async (request, reply) => {
      const { id } = request.params;
      const b = request.body || {};
      const oRes = await pool.query(
        `SELECT o.*, ch.campaign_id FROM chapter_outcomes o
           JOIN chapters ch ON ch.id = o.chapter_id WHERE o.id = $1`,
        [id],
      );
      if (oRes.rows.length === 0) {
        return reply.status(404).send({ success: false, error: '結果分支不存在' });
      }
      const campaignId = oRes.rows[0].campaign_id;

      const vr = await collectAndValidateReferences(campaignId, {
        condition_expression: b.condition_expression,
        flag_sets: b.flag_sets,
      });
      if (!vr.ok) return reply.status(vr.status).send(vr.body);

      const sets: string[] = [];
      const vals: any[] = [];
      let pi = 1;
      const push = (col: string, val: any, json = false) => {
        if (val === undefined) return;
        if (json) { sets.push(`${col} = $${pi++}::jsonb`); vals.push(JSON.stringify(val)); }
        else { sets.push(`${col} = $${pi++}`); vals.push(val); }
      };
      if (b.outcome_code !== undefined) {
        if (!VALID_OUTCOME_CODES.has(b.outcome_code)) {
          return reply.status(400).send({ success: false, error: 'outcome_code 不合法' });
        }
        push('outcome_code', b.outcome_code);
      }
      if (b.condition_expression !== undefined) push('condition_expression', b.condition_expression, true);
      push('narrative_text', b.narrative_text);
      if (b.next_chapter_version !== undefined) push('next_chapter_version', b.next_chapter_version);
      if (b.chaos_bag_changes !== undefined) push('chaos_bag_changes', b.chaos_bag_changes, true);
      if (b.rewards !== undefined) push('rewards', b.rewards, true);
      if (b.flag_sets !== undefined) push('flag_sets', b.flag_sets, true);

      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: '沒有可更新的欄位' });
      }
      sets.push(`updated_at = NOW()`);
      vals.push(id);
      try {
        const res = await pool.query(
          `UPDATE chapter_outcomes SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`,
          vals,
        );
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, '更新結果分支失敗');
        return reply.status(500).send({ success: false, error: '更新結果分支失敗' });
      }
    },
  );

  // DELETE /api/outcomes/:id
  app.delete<{ Params: { id: string } }>('/api/outcomes/:id', { preHandler: requireAdminRole }, async (request, reply) => {
    try {
      const res = await pool.query(
        `DELETE FROM chapter_outcomes WHERE id = $1 RETURNING id`,
        [request.params.id],
      );
      if (res.rows.length === 0) {
        return reply.status(404).send({ success: false, error: '結果分支不存在' });
      }
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, '刪除結果分支失敗');
      return reply.status(500).send({ success: false, error: '刪除結果分支失敗' });
    }
  });

  // ═══════════════════════════════════════════
  // 旗標字典
  // ═══════════════════════════════════════════

  // GET /api/campaigns/:id/flags
  app.get<{ Params: { id: string }; Querystring: { category?: string; search?: string } }>(
    '/api/campaigns/:id/flags',
    async (request, reply) => {
      const { id } = request.params;
      const { category, search } = request.query;
      const conds: string[] = ['campaign_id = $1'];
      const vals: any[] = [id];
      let pi = 2;
      if (category && VALID_FLAG_CATEGORIES.has(category)) {
        conds.push(`category = $${pi++}`);
        vals.push(category);
      }
      if (search) {
        conds.push(`flag_code ILIKE $${pi}`);
        vals.push(`%${search}%`);
        pi++;
      }
      try {
        const res = await pool.query(
          `SELECT * FROM campaign_flags WHERE ${conds.join(' AND ')} ORDER BY flag_code`,
          vals,
        );
        return reply.send({ success: true, data: res.rows });
      } catch (error) {
        request.log.error(error, '列出旗標失敗');
        return reply.status(500).send({ success: false, error: '列出旗標失敗' });
      }
    },
  );

  // GET /api/flags/:id ── 含反向引用
  app.get<{ Params: { id: string } }>('/api/flags/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const fRes = await pool.query(
        `SELECT f.*, c.id AS cid FROM campaign_flags f
           JOIN campaigns c ON c.id = f.campaign_id
          WHERE f.id = $1`,
        [id],
      );
      if (fRes.rows.length === 0) {
        return reply.status(404).send({ success: false, error: '旗標不存在' });
      }
      const flag = fRes.rows[0];
      const codeStr = `%${flag.flag_code}%`;

      const [outcomesR, eventsR] = await Promise.all([
        pool.query(
          `SELECT o.id, o.outcome_code, o.chapter_id, ch.chapter_number, ch.chapter_code
             FROM chapter_outcomes o
             JOIN chapters ch ON ch.id = o.chapter_id
            WHERE ch.campaign_id = $1
              AND (o.condition_expression::text LIKE $2 OR o.flag_sets::text LIKE $2)`,
          [flag.cid, codeStr],
        ),
        pool.query(
          `SELECT i.id, i.event_code, i.name_zh, i.chapter_id, i.insertion_point
             FROM interlude_events i
             JOIN chapters ch ON ch.id = i.chapter_id
            WHERE ch.campaign_id = $1
              AND (i.trigger_condition::text LIKE $2 OR i.operations::text LIKE $2)`,
          [flag.cid, codeStr],
        ),
      ]);

      let stagesRefs: any[] = [];
      try {
        const sRes = await pool.query(
          `SELECT id, code, name_zh FROM stages
            WHERE (entry_condition::text LIKE $1 OR completion_flags::text LIKE $1)`,
          [codeStr],
        );
        stagesRefs = sRes.rows;
      } catch {
        stagesRefs = [];
      }

      return reply.send({
        success: true,
        data: {
          ...flag,
          cid: undefined,
          referenced_by_outcomes: outcomesR.rows,
          referenced_by_events: eventsR.rows,
          referenced_by_stages: stagesRefs,
        },
      });
    } catch (error) {
      request.log.error(error, '取得旗標失敗');
      return reply.status(500).send({ success: false, error: '取得旗標失敗' });
    }
  });

  // POST /api/campaigns/:id/flags
  app.post<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/campaigns/:id/flags',
    async (request, reply) => {
      const { id } = request.params;
      const b = request.body || {};
      if (!b.category || !VALID_FLAG_CATEGORIES.has(b.category)) {
        return reply.status(400).send({ success: false, error: '類別不合法' });
      }
      if (!b.flag_code || !FLAG_CODE_RE.test(b.flag_code)) {
        return reply.status(400).send({ success: false, error: '旗標代碼格式錯誤' });
      }
      const prefix = b.flag_code.split('.')[0];
      if (prefix !== b.category) {
        return reply.status(400).send({
          success: false,
          error: `旗標代碼前綴（${prefix}）必須與類別（${b.category}）一致`,
        });
      }
      if (b.visibility && !VALID_VISIBILITIES.has(b.visibility)) {
        return reply.status(400).send({ success: false, error: '可見性不合法' });
      }
      try {
        const res = await pool.query(
          `INSERT INTO campaign_flags
             (campaign_id, flag_code, category, description_zh, visibility, chapter_code)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            id, b.flag_code, b.category,
            b.description_zh || '',
            b.visibility || 'visible',
            b.chapter_code || null,
          ],
        );
        return reply.status(201).send({ success: true, data: res.rows[0] });
      } catch (error: any) {
        request.log.error(error, '建立旗標失敗');
        if (error.code === '23505') {
          return reply.status(409).send({ success: false, error: '旗標代碼已存在' });
        }
        return reply.status(500).send({ success: false, error: '建立旗標失敗' });
      }
    },
  );

  // PUT /api/flags/:id
  app.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/flags/:id',
    async (request, reply) => {
      const { id } = request.params;
      const b = request.body || {};
      // flag_code 不可改
      if (b.flag_code !== undefined) {
        return reply.status(400).send({
          success: false,
          error: 'flag_code 不可修改（會破壞引用完整性，請刪除後重建）',
        });
      }
      const sets: string[] = [];
      const vals: any[] = [];
      let pi = 1;
      if (b.category !== undefined) {
        if (!VALID_FLAG_CATEGORIES.has(b.category)) {
          return reply.status(400).send({ success: false, error: '類別不合法' });
        }
        sets.push(`category = $${pi++}`); vals.push(b.category);
      }
      if (b.description_zh !== undefined) { sets.push(`description_zh = $${pi++}`); vals.push(b.description_zh); }
      if (b.visibility !== undefined) {
        if (!VALID_VISIBILITIES.has(b.visibility)) {
          return reply.status(400).send({ success: false, error: '可見性不合法' });
        }
        sets.push(`visibility = $${pi++}`); vals.push(b.visibility);
      }
      if (b.chapter_code !== undefined) { sets.push(`chapter_code = $${pi++}`); vals.push(b.chapter_code); }
      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: '沒有可更新的欄位' });
      }
      sets.push(`updated_at = NOW()`);
      vals.push(id);
      try {
        const res = await pool.query(
          `UPDATE campaign_flags SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`,
          vals,
        );
        if (res.rows.length === 0) {
          return reply.status(404).send({ success: false, error: '旗標不存在' });
        }
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, '更新旗標失敗');
        return reply.status(500).send({ success: false, error: '更新旗標失敗' });
      }
    },
  );

  // DELETE /api/flags/:id ── 先檢查引用
  app.delete<{ Params: { id: string } }>('/api/flags/:id', { preHandler: requireAdminRole }, async (request, reply) => {
    const { id } = request.params;
    try {
      const fRes = await pool.query('SELECT * FROM campaign_flags WHERE id = $1', [id]);
      if (fRes.rows.length === 0) {
        return reply.status(404).send({ success: false, error: '旗標不存在' });
      }
      const flag = fRes.rows[0];
      const codeStr = `%${flag.flag_code}%`;

      const [oR, eR] = await Promise.all([
        pool.query(
          `SELECT o.id, o.outcome_code, ch.chapter_number FROM chapter_outcomes o
             JOIN chapters ch ON ch.id = o.chapter_id
            WHERE ch.campaign_id = $1
              AND (o.condition_expression::text LIKE $2 OR o.flag_sets::text LIKE $2)`,
          [flag.campaign_id, codeStr],
        ),
        pool.query(
          `SELECT i.id, i.event_code, i.name_zh FROM interlude_events i
             JOIN chapters ch ON ch.id = i.chapter_id
            WHERE ch.campaign_id = $1
              AND (i.trigger_condition::text LIKE $2 OR i.operations::text LIKE $2)`,
          [flag.campaign_id, codeStr],
        ),
      ]);
      const refs: any[] = [
        ...oR.rows.map((r) => ({ type: 'outcome', name: `第 ${r.chapter_number} 章 結果 ${r.outcome_code}` })),
        ...eR.rows.map((r) => ({ type: 'interlude', name: `${r.event_code}（${r.name_zh}）` })),
      ];
      if (refs.length > 0) {
        return reply.status(400).send({
          success: false,
          error: '旗標仍被引用，無法刪除',
          referenced_by: refs,
        });
      }
      await pool.query('DELETE FROM campaign_flags WHERE id = $1', [id]);
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, '刪除旗標失敗');
      return reply.status(500).send({ success: false, error: '刪除旗標失敗' });
    }
  });

  // ═══════════════════════════════════════════
  // 間章事件
  // ═══════════════════════════════════════════

  // GET /api/chapters/:chapterId/interlude-events
  app.get<{ Params: { chapterId: string } }>(
    '/api/chapters/:chapterId/interlude-events',
    async (request, reply) => {
      try {
        const res = await pool.query(
          `SELECT * FROM interlude_events WHERE chapter_id = $1
            ORDER BY CASE insertion_point WHEN 'prologue' THEN 0 ELSE 1 END, created_at`,
          [request.params.chapterId],
        );
        return reply.send({ success: true, data: res.rows });
      } catch (error) {
        request.log.error(error, '列出間章事件失敗');
        return reply.status(500).send({ success: false, error: '列出間章事件失敗' });
      }
    },
  );

  // POST /api/chapters/:chapterId/interlude-events
  app.post<{ Params: { chapterId: string }; Body: Record<string, any> }>(
    '/api/chapters/:chapterId/interlude-events',
    async (request, reply) => {
      const { chapterId } = request.params;
      const b = request.body || {};
      if (!b.event_code) return reply.status(400).send({ success: false, error: 'event_code 為必填' });
      if (!b.name_zh) return reply.status(400).send({ success: false, error: 'name_zh 為必填' });
      if (!VALID_INSERTION_POINTS.has(b.insertion_point)) {
        return reply.status(400).send({ success: false, error: 'insertion_point 必須為 prologue 或 epilogue' });
      }
      const chapter = await fetchChapterAndCampaign(chapterId);
      if (!chapter) return reply.status(404).send({ success: false, error: '章節不存在' });

      const vr = await collectAndValidateReferences(chapter.campaign_id, {
        trigger_condition: b.trigger_condition,
        operations: b.operations,
      });
      if (!vr.ok) return reply.status(vr.status).send(vr.body);

      try {
        const res = await pool.query(
          `INSERT INTO interlude_events
             (chapter_id, event_code, name_zh, name_en, insertion_point,
              trigger_condition, operations, narrative_text_zh, narrative_text_en, choices)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10::jsonb)
           RETURNING *`,
          [
            chapterId, b.event_code, b.name_zh, b.name_en || '',
            b.insertion_point,
            b.trigger_condition ? JSON.stringify(b.trigger_condition) : null,
            JSON.stringify(b.operations || []),
            b.narrative_text_zh || '', b.narrative_text_en || '',
            JSON.stringify(b.choices || []),
          ],
        );
        return reply.status(201).send({ success: true, data: res.rows[0] });
      } catch (error: any) {
        request.log.error(error, '建立間章事件失敗');
        if (error.code === '23505') {
          return reply.status(409).send({ success: false, error: '該章節已有相同 event_code' });
        }
        return reply.status(500).send({ success: false, error: '建立間章事件失敗' });
      }
    },
  );

  // PUT /api/interlude-events/:id
  app.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/interlude-events/:id',
    async (request, reply) => {
      const { id } = request.params;
      const b = request.body || {};
      const eRes = await pool.query(
        `SELECT i.*, ch.campaign_id FROM interlude_events i
           JOIN chapters ch ON ch.id = i.chapter_id WHERE i.id = $1`,
        [id],
      );
      if (eRes.rows.length === 0) {
        return reply.status(404).send({ success: false, error: '間章事件不存在' });
      }
      const campaignId = eRes.rows[0].campaign_id;

      const vr = await collectAndValidateReferences(campaignId, {
        trigger_condition: b.trigger_condition,
        operations: b.operations,
      });
      if (!vr.ok) return reply.status(vr.status).send(vr.body);

      const sets: string[] = [];
      const vals: any[] = [];
      let pi = 1;
      const push = (col: string, val: any, json = false) => {
        if (val === undefined) return;
        if (json) { sets.push(`${col} = $${pi++}::jsonb`); vals.push(val === null ? null : JSON.stringify(val)); }
        else { sets.push(`${col} = $${pi++}`); vals.push(val); }
      };
      push('event_code', b.event_code);
      push('name_zh', b.name_zh);
      push('name_en', b.name_en);
      if (b.insertion_point !== undefined) {
        if (!VALID_INSERTION_POINTS.has(b.insertion_point)) {
          return reply.status(400).send({ success: false, error: 'insertion_point 不合法' });
        }
        push('insertion_point', b.insertion_point);
      }
      if (b.trigger_condition !== undefined) {
        // trigger_condition 可以為 null（無條件觸發）
        if (b.trigger_condition === null) {
          sets.push(`trigger_condition = NULL`);
        } else {
          sets.push(`trigger_condition = $${pi++}::jsonb`);
          vals.push(JSON.stringify(b.trigger_condition));
        }
      }
      if (b.operations !== undefined) push('operations', b.operations, true);
      push('narrative_text_zh', b.narrative_text_zh);
      push('narrative_text_en', b.narrative_text_en);
      if (b.choices !== undefined) push('choices', b.choices, true);

      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: '沒有可更新的欄位' });
      }
      sets.push(`updated_at = NOW()`);
      vals.push(id);
      try {
        const res = await pool.query(
          `UPDATE interlude_events SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`,
          vals,
        );
        return reply.send({ success: true, data: res.rows[0] });
      } catch (error) {
        request.log.error(error, '更新間章事件失敗');
        return reply.status(500).send({ success: false, error: '更新間章事件失敗' });
      }
    },
  );

  // DELETE /api/interlude-events/:id
  app.delete<{ Params: { id: string } }>(
    '/api/interlude-events/:id', { preHandler: requireAdminRole },
    async (request, reply) => {
      try {
        const res = await pool.query(
          `DELETE FROM interlude_events WHERE id = $1 RETURNING id`,
          [request.params.id],
        );
        if (res.rows.length === 0) {
          return reply.status(404).send({ success: false, error: '間章事件不存在' });
        }
        return reply.send({ success: true });
      } catch (error) {
        request.log.error(error, '刪除間章事件失敗');
        return reply.status(500).send({ success: false, error: '刪除間章事件失敗' });
      }
    },
  );

  // ═══════════════════════════════════════════
  // 匯出 / 匯入
  // ═══════════════════════════════════════════

  // GET /api/campaigns/:id/export
  app.get<{ Params: { id: string } }>(
    '/api/campaigns/:id/export',
    async (request, reply) => {
      const { id } = request.params;
      try {
        const cRes = await pool.query('SELECT * FROM campaigns WHERE id = $1', [id]);
        if (cRes.rows.length === 0) {
          return reply.status(404).send({ success: false, error: '戰役不存在' });
        }
        const campaign = cRes.rows[0];

        const chRes = await pool.query(
          `SELECT * FROM chapters WHERE campaign_id = $1 ORDER BY chapter_number`,
          [id],
        );
        const chapterIds = chRes.rows.map((c) => c.id);

        const [oRes, fRes, iRes] = await Promise.all([
          chapterIds.length
            ? pool.query(
                `SELECT o.*, ch.chapter_code FROM chapter_outcomes o
                   JOIN chapters ch ON ch.id = o.chapter_id
                  WHERE o.chapter_id = ANY($1::uuid[])
                  ORDER BY ch.chapter_number, o.outcome_code`,
                [chapterIds],
              )
            : Promise.resolve({ rows: [] as any[] }),
          pool.query(
            `SELECT * FROM campaign_flags WHERE campaign_id = $1 ORDER BY flag_code`,
            [id],
          ),
          chapterIds.length
            ? pool.query(
                `SELECT i.*, ch.chapter_code FROM interlude_events i
                   JOIN chapters ch ON ch.id = i.chapter_id
                  WHERE i.chapter_id = ANY($1::uuid[])
                  ORDER BY ch.chapter_number,
                           CASE i.insertion_point WHEN 'prologue' THEN 0 ELSE 1 END,
                           i.created_at`,
                [chapterIds],
              )
            : Promise.resolve({ rows: [] as any[] }),
        ]);

        reply.header(
          'Content-Disposition',
          `attachment; filename="campaign_${campaign.code}.json"`,
        );
        return reply.send({
          format_version: '1.0',
          exported_at: new Date().toISOString(),
          campaign,
          chapters: chRes.rows,
          outcomes: oRes.rows,
          flags: fRes.rows,
          interludes: iRes.rows,
        });
      } catch (error) {
        request.log.error(error, '匯出戰役失敗');
        return reply.status(500).send({ success: false, error: '匯出戰役失敗' });
      }
    },
  );

  // POST /api/campaigns/import
  app.post<{ Body: Record<string, any> }>(
    '/api/campaigns/import',
    async (request, reply) => {
      const data = request.body || {};
      if (!data.campaign || !data.campaign.code || !data.campaign.name_zh) {
        return reply.status(400).send({ success: false, error: '匯入資料缺少 campaign.code 或 name_zh' });
      }
      if (!CODE_RE.test(data.campaign.code)) {
        return reply.status(400).send({ success: false, error: '戰役代碼格式錯誤' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 若代碼已存在先刪除（CASCADE 會清空子表）
        await client.query('DELETE FROM campaigns WHERE code = $1', [data.campaign.code]);

        const cRes = await client.query(
          `INSERT INTO campaigns (code, name_zh, name_en, theme, cover_narrative,
                                  difficulty_tier, initial_chaos_bag, design_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
           RETURNING *`,
          [
            data.campaign.code,
            data.campaign.name_zh,
            data.campaign.name_en || '',
            data.campaign.theme || '',
            data.campaign.cover_narrative || '',
            VALID_DIFFICULTY.has(data.campaign.difficulty_tier) ? data.campaign.difficulty_tier : 'standard',
            JSON.stringify(data.campaign.initial_chaos_bag || {}),
            VALID_DESIGN_STATUS.has(data.campaign.design_status) ? data.campaign.design_status : 'draft',
          ],
        );
        const newCampaignId = cRes.rows[0].id;

        // 插入章節（以 chapter_code 為 key 建對應表，供 outcomes / interludes 還原 chapter_id）
        const chapterIdByCode: Record<string, string> = {};
        const chaptersIn: any[] = Array.isArray(data.chapters) ? data.chapters : [];
        for (const ch of chaptersIn) {
          const chRes = await client.query(
            `INSERT INTO chapters (campaign_id, chapter_number, chapter_code, name_zh, name_en,
                                   narrative_intro, narrative_choices, design_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
             RETURNING id`,
            [
              newCampaignId,
              ch.chapter_number,
              ch.chapter_code,
              ch.name_zh || '',
              ch.name_en || '',
              ch.narrative_intro || '',
              JSON.stringify(ch.narrative_choices || []),
              VALID_DESIGN_STATUS.has(ch.design_status) ? ch.design_status : 'draft',
            ],
          );
          chapterIdByCode[ch.chapter_code] = chRes.rows[0].id;
        }

        // 旗標
        for (const f of (Array.isArray(data.flags) ? data.flags : [])) {
          if (!f.flag_code || !FLAG_CODE_RE.test(f.flag_code)) continue;
          if (!VALID_FLAG_CATEGORIES.has(f.category)) continue;
          await client.query(
            `INSERT INTO campaign_flags (campaign_id, flag_code, category, description_zh,
                                         visibility, chapter_code)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (campaign_id, flag_code) DO NOTHING`,
            [
              newCampaignId,
              f.flag_code,
              f.category,
              f.description_zh || '',
              VALID_VISIBILITIES.has(f.visibility) ? f.visibility : 'visible',
              f.chapter_code || null,
            ],
          );
        }

        // 結果分支
        for (const o of (Array.isArray(data.outcomes) ? data.outcomes : [])) {
          const chapterId = o.chapter_id && chaptersIn.some((ch) => ch.id === o.chapter_id)
            ? chapterIdByCode[chaptersIn.find((ch) => ch.id === o.chapter_id).chapter_code]
            : chapterIdByCode[o.chapter_code];
          if (!chapterId) continue;
          if (!VALID_OUTCOME_CODES.has(o.outcome_code)) continue;
          await client.query(
            `INSERT INTO chapter_outcomes (chapter_id, outcome_code, condition_expression,
                                           narrative_text, next_chapter_version,
                                           chaos_bag_changes, rewards, flag_sets)
             VALUES ($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)
             ON CONFLICT (chapter_id, outcome_code) DO NOTHING`,
            [
              chapterId,
              o.outcome_code,
              JSON.stringify(o.condition_expression || {}),
              o.narrative_text || '',
              o.next_chapter_version || null,
              JSON.stringify(o.chaos_bag_changes || []),
              JSON.stringify(o.rewards || {}),
              JSON.stringify(o.flag_sets || []),
            ],
          );
        }

        // 間章事件
        for (const e of (Array.isArray(data.interludes) ? data.interludes : [])) {
          const chapterId = e.chapter_id && chaptersIn.some((ch) => ch.id === e.chapter_id)
            ? chapterIdByCode[chaptersIn.find((ch) => ch.id === e.chapter_id).chapter_code]
            : chapterIdByCode[e.chapter_code];
          if (!chapterId) continue;
          if (!VALID_INSERTION_POINTS.has(e.insertion_point)) continue;
          await client.query(
            `INSERT INTO interlude_events (chapter_id, event_code, name_zh, name_en,
                                           insertion_point, trigger_condition, operations,
                                           narrative_text_zh, narrative_text_en, choices)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb)
             ON CONFLICT (chapter_id, event_code) DO NOTHING`,
            [
              chapterId,
              e.event_code,
              e.name_zh,
              e.name_en || '',
              e.insertion_point,
              e.trigger_condition ? JSON.stringify(e.trigger_condition) : null,
              JSON.stringify(e.operations || []),
              e.narrative_text_zh || '',
              e.narrative_text_en || '',
              JSON.stringify(e.choices || []),
            ],
          );
        }

        await client.query('COMMIT');
        return reply.status(201).send({
          success: true,
          data: { id: newCampaignId, code: data.campaign.code },
        });
      } catch (error) {
        await client.query('ROLLBACK');
        request.log.error(error, '匯入戰役失敗');
        return reply.status(500).send({ success: false, error: '匯入戰役失敗' });
      } finally {
        client.release();
      }
    },
  );
};
