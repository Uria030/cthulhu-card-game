import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const ATTR_KEYS = [
  'attr_strength','attr_agility','attr_constitution','attr_reflex',
  'attr_intellect','attr_willpower','attr_perception','attr_charisma'
];

const NARRATIVE_KEYS = [
  'name_zh','name_en','title_zh','title_en',
  'backstory','ability_text_zh','ability_text_en',
  'era_tags','portrait_url'
];

const MBTI_STRUCTURAL_KEYS = ['mbti_code','career_index','dominant_letter','faction_code'];

function sumAttrs(t: any): number {
  return ATTR_KEYS.reduce((a, k) => a + (Number(t[k]) || 0), 0);
}

async function computeIsCompleted(invId: string): Promise<boolean> {
  const invR = await pool.query('SELECT * FROM investigator_templates WHERE id=$1', [invId]);
  const t = invR.rows[0];
  if (!t) return false;
  if (!t.name_zh || !t.title_zh) return false;
  if (!t.backstory || (t.backstory as string).length < 50) return false;
  if (!t.ability_text_zh) return false;
  if (sumAttrs(t) !== 18) return false;
  if (!Array.isArray(t.proficiency_ids) || t.proficiency_ids.length < 1) return false;

  const sigR = await pool.query(
    'SELECT COUNT(*)::int AS c FROM investigator_signature_cards WHERE investigator_id=$1', [invId]
  );
  if ((sigR.rows[0] as any).c < 2) return false;

  const weakR = await pool.query(
    'SELECT COUNT(*)::int AS c FROM investigator_weaknesses WHERE investigator_id=$1', [invId]
  );
  if ((weakR.rows[0] as any).c < 1) return false;

  const deckR = await pool.query(
    'SELECT COALESCE(SUM(quantity),0)::int AS total FROM investigator_starting_deck WHERE investigator_id=$1', [invId]
  );
  const total = (deckR.rows[0] as any).total;
  if (total < 15 || total > 20) return false;

  return true;
}

async function refreshIsCompleted(invId: string) {
  const done = await computeIsCompleted(invId);
  await pool.query(
    'UPDATE investigator_templates SET is_completed=$1, updated_at=NOW() WHERE id=$2',
    [done, invId]
  );
  return done;
}

export const investigatorRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // ════════════════════════════════════════════
  //  批次/聚合操作 — 必須在 /:id 之前
  // ════════════════════════════════════════════

  // 預設矩陣
  app.get('/api/admin/investigators/preset-matrix', async (_req, reply) => {
    const r = await pool.query(`
      SELECT id, code, mbti_code, career_index, dominant_letter,
             name_zh, name_en, title_zh, is_completed, is_preset,
             total_value, value_grade
        FROM investigator_templates
       WHERE is_preset = TRUE
       ORDER BY mbti_code, career_index
    `);
    const matrix: Record<string, Record<number, any>> = {};
    for (const row of r.rows as any[]) {
      if (!matrix[row.mbti_code]) matrix[row.mbti_code] = {} as any;
      matrix[row.mbti_code][row.career_index] = row;
    }
    return reply.send(matrix);
  });

  // 整體統計
  app.get('/api/admin/investigators/stats', async (_req, reply) => {
    const total = await pool.query('SELECT COUNT(*)::int AS c FROM investigator_templates WHERE is_preset=TRUE');
    const completed = await pool.query('SELECT COUNT(*)::int AS c FROM investigator_templates WHERE is_preset=TRUE AND is_completed=TRUE');
    const byMbti = await pool.query(`
      SELECT mbti_code, COUNT(*)::int AS total, SUM(CASE WHEN is_completed THEN 1 ELSE 0 END)::int AS completed
        FROM investigator_templates WHERE is_preset=TRUE
        GROUP BY mbti_code ORDER BY mbti_code
    `);
    const byLetter = await pool.query(`
      SELECT dominant_letter, COUNT(*)::int AS c
        FROM investigator_templates WHERE is_preset=TRUE
        GROUP BY dominant_letter ORDER BY dominant_letter
    `);
    const eraRows = await pool.query(`
      SELECT era_tags FROM investigator_templates
       WHERE era_tags IS NOT NULL AND era_tags <> ''
    `);
    const eraMap: Record<string, number> = {};
    for (const row of eraRows.rows as any[]) {
      for (const tag of (row.era_tags as string).split(',').map(s => s.trim()).filter(Boolean)) {
        eraMap[tag] = (eraMap[tag] || 0) + 1;
      }
    }
    const totalC = (total.rows[0] as any).c;
    const completedC = (completed.rows[0] as any).c;
    return reply.send({
      total_presets: totalC,
      completed_presets: completedC,
      completion_rate: totalC > 0 ? completedC / totalC : 0,
      by_mbti: byMbti.rows,
      by_dominant_letter: byLetter.rows,
      by_era_tag: eraMap,
    });
  });

  // V 值矩陣（給平衡面板散佈圖）
  app.get('/api/admin/investigators/value-matrix', async (_req, reply) => {
    const r = await pool.query(`
      SELECT id, code, mbti_code, career_index, dominant_letter,
             name_zh, is_completed, is_preset,
             attribute_value, hp_value, san_value, baseline_value,
             proficiency_value, ability_text_value, ability_value,
             signature_total_value, weakness_value,
             total_value, value_grade
        FROM investigator_templates
       ORDER BY mbti_code, career_index
    `);
    return reply.send(r.rows);
  });

  // V 值統計（聚合）
  app.get('/api/admin/investigators/value-stats', async (_req, reply) => {
    const agg = await pool.query(`
      SELECT
        COUNT(*)::int AS total_templates,
        SUM(CASE WHEN is_completed THEN 1 ELSE 0 END)::int AS total_completed,
        AVG(total_value) FILTER (WHERE is_completed) AS mean_value,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_value) FILTER (WHERE is_completed) AS median_value,
        STDDEV(total_value) FILTER (WHERE is_completed) AS stddev_value
      FROM investigator_templates
    `);
    const letter = await pool.query(`
      SELECT dominant_letter,
             COUNT(*) FILTER (WHERE is_completed)::int AS count,
             AVG(total_value) FILTER (WHERE is_completed) AS mean,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_value) FILTER (WHERE is_completed) AS median
      FROM investigator_templates
      GROUP BY dominant_letter ORDER BY dominant_letter
    `);
    const warnings = await pool.query(`
      SELECT code, value_grade, total_value
        FROM investigator_templates
       WHERE value_grade IN ('overpowered','underpowered','above_average','below_average')
       ORDER BY value_grade, total_value DESC
    `);
    return reply.send({
      ...agg.rows[0],
      by_dominant_letter: letter.rows,
      warnings: warnings.rows,
    });
  });

  // 全庫 V 值重算
  app.post('/api/admin/investigators/recalculate-all', async (_req, reply) => {
    const r = await pool.query('SELECT recalculate_all_investigator_values() AS cnt');
    return reply.send({ recalculated: (r.rows[0] as any).cnt });
  });

  // V 值計算參數配置
  app.get('/api/admin/value-config', async (_req, reply) => {
    const r = await pool.query('SELECT key, value_numeric, value_text, description, updated_at FROM investigator_value_config ORDER BY key');
    return reply.send(r.rows);
  });

  app.patch('/api/admin/value-config', async (request, reply) => {
    const body = request.body as Record<string, number>;
    for (const [key, val] of Object.entries(body)) {
      await pool.query(
        'UPDATE investigator_value_config SET value_numeric=$1, updated_at=NOW() WHERE key=$2',
        [val, key]
      );
    }
    await pool.query('SELECT recalculate_all_investigator_values()');
    return reply.send({ ok: true });
  });

  // 陣營與 MBTI 查詢
  app.get('/api/admin/faction-attribute-map', async (_req, reply) => {
    const r = await pool.query('SELECT * FROM faction_attribute_map ORDER BY faction_code');
    return reply.send(r.rows);
  });

  // 取全部戰鬥熟練（跨 style 平鋪，供 MOD-11 下拉使用）
  app.get('/api/admin/proficiencies', async (_req, reply) => {
    const r = await pool.query(`
      SELECT cs.id, cs.code, cs.name_zh, cs.name_en, cs.attribute, cs.prof_bonus, cs.spec_bonus,
             cst.name_zh AS style_name_zh, cst.code AS style_code
        FROM combat_specializations cs
        LEFT JOIN combat_styles cst ON cst.id = cs.style_id
        ORDER BY cst.sort_order, cs.sort_order, cs.name_zh
    `);
    return reply.send(r.rows);
  });

  // ════════════════════════════════════════════
  //  列表
  // ════════════════════════════════════════════
  app.get('/api/admin/investigators', async (request, reply) => {
    const q = request.query as any;
    const where: string[] = [];
    const params: any[] = [];
    if (q.mbti) { params.push(q.mbti); where.push(`mbti_code = $${params.length}`); }
    if (typeof q.is_preset !== 'undefined') { params.push(q.is_preset === 'true' || q.is_preset === true); where.push(`is_preset = $${params.length}`); }
    if (typeof q.is_completed !== 'undefined') { params.push(q.is_completed === 'true' || q.is_completed === true); where.push(`is_completed = $${params.length}`); }
    if (q.dominant) { params.push(q.dominant); where.push(`dominant_letter = $${params.length}`); }
    if (q.search) {
      params.push(`%${q.search}%`);
      where.push(`(name_zh ILIKE $${params.length} OR title_zh ILIKE $${params.length} OR mbti_code ILIKE $${params.length})`);
    }
    const page = Math.max(parseInt(q.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(q.limit || '100', 10), 1), 200);
    const offset = (page - 1) * limit;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalR = await pool.query(`SELECT COUNT(*)::int AS c FROM investigator_templates ${whereSql}`, params);
    const rowsR = await pool.query(
      `SELECT id, code, mbti_code, career_index, dominant_letter, faction_code,
              name_zh, name_en, title_zh, era_tags, portrait_url,
              is_preset, is_completed, total_value, value_grade, updated_at
         FROM investigator_templates ${whereSql}
         ORDER BY mbti_code, career_index, name_zh
         LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    return reply.send({ total: (totalR.rows[0] as any).c, page, limit, items: rowsR.rows });
  });

  // 單一調查員（含簽名卡、弱點、起始牌組）
  app.get('/api/admin/investigators/:id', async (request, reply) => {
    const { id } = request.params as any;
    const invR = await pool.query('SELECT * FROM investigator_templates WHERE id=$1', [id]);
    if (invR.rowCount === 0) return reply.code(404).send({ error: 'not found' });
    const sigR = await pool.query(
      'SELECT * FROM investigator_signature_cards WHERE investigator_id=$1 ORDER BY card_order',
      [id]
    );
    const weakR = await pool.query(
      'SELECT * FROM investigator_weaknesses WHERE investigator_id=$1',
      [id]
    );
    const deckR = await pool.query(
      `SELECT d.*, cd.name_zh AS cd_name_zh, cd.cost AS cd_cost, cd.card_type AS cd_card_type, cd.faction AS cd_faction,
              sc.name_zh AS sc_name_zh, sc.cost AS sc_cost, sc.card_type AS sc_card_type,
              wk.name_zh AS wk_name_zh
         FROM investigator_starting_deck d
         LEFT JOIN card_definitions cd ON cd.id = d.card_definition_id
         LEFT JOIN investigator_signature_cards sc ON sc.id = d.signature_card_id
         LEFT JOIN investigator_weaknesses wk ON wk.id = d.weakness_id
         WHERE d.investigator_id=$1
         ORDER BY COALESCE(d.slot_order, 999), d.created_at`,
      [id]
    );
    return reply.send({
      ...invR.rows[0],
      signature_cards: sigR.rows,
      weakness: weakR.rows[0] || null,
      starting_deck: deckR.rows,
    });
  });

  // V 值拆解
  app.get('/api/admin/investigators/:id/value-breakdown', async (request, reply) => {
    const { id } = request.params as any;
    const r = await pool.query('SELECT * FROM investigator_templates WHERE id=$1', [id]);
    if (r.rowCount === 0) return reply.code(404).send({ error: 'not found' });
    const t = r.rows[0] as any;
    const sig = await pool.query(
      'SELECT id, card_order, name_zh, effect_value, value_breakdown, value_source FROM investigator_signature_cards WHERE investigator_id=$1 ORDER BY card_order',
      [id]
    );
    const weak = await pool.query(
      'SELECT effect_value, trigger_probability, expected_rounds, final_value FROM investigator_weaknesses WHERE investigator_id=$1',
      [id]
    );
    const z = await pool.query(`
      WITH s AS (
        SELECT AVG(total_value) AS mean, STDDEV(total_value) AS sd
        FROM investigator_templates WHERE is_completed = TRUE
      )
      SELECT CASE WHEN s.sd > 0 THEN (($1::decimal - s.mean) / s.sd) ELSE 0 END AS z_score
        FROM s
    `, [t.total_value]);
    return reply.send({
      total_value: Number(t.total_value),
      value_grade: t.value_grade,
      z_score: z.rows[0] ? Number((z.rows[0] as any).z_score) : 0,
      baseline: {
        attribute: Number(t.attribute_value),
        hp: Number(t.hp_value),
        san: Number(t.san_value),
        total: Number(t.baseline_value),
      },
      ability: {
        proficiency: Number(t.proficiency_value),
        ability_text: Number(t.ability_text_value),
        ability_text_source: t.ability_value_source,
        total: Number(t.ability_value),
      },
      signature: { total: Number(t.signature_total_value), cards: sig.rows },
      weakness: weak.rows[0] || null,
    });
  });

  app.post('/api/admin/investigators/:id/recalculate-value', async (request, reply) => {
    const { id } = request.params as any;
    await pool.query('SELECT calc_total_investigator_value($1)', [id]);
    const r = await pool.query('SELECT total_value, value_grade FROM investigator_templates WHERE id=$1', [id]);
    return reply.send(r.rows[0] || {});
  });

  // ════════════════════════════════════════════
  //  CRUD
  // ════════════════════════════════════════════
  app.post('/api/admin/investigators', async (request, reply) => {
    const b = request.body as any;
    const mbti = b.mbti_code || null;
    let attrs: Record<string, number> = {
      attr_strength: 1, attr_agility: 1, attr_constitution: 1, attr_reflex: 1,
      attr_intellect: 1, attr_willpower: 1, attr_perception: 1, attr_charisma: 1,
    };
    if (mbti && /^[EIST NFP JT]{4}$/i.test(mbti)) {
      // 若有 MBTI 讓 DB 函式算基礎配點（保留與 seed 一致邏輯）
      const base = await pool.query(`
        SELECT
          1 + CASE WHEN main_attr_is('strength',     $1) THEN 3 ELSE 0 END + sub_attr_count('strength',     $1) AS s,
          1 + CASE WHEN main_attr_is('agility',      $1) THEN 3 ELSE 0 END + sub_attr_count('agility',      $1) AS a,
          1 + CASE WHEN main_attr_is('constitution', $1) THEN 3 ELSE 0 END + sub_attr_count('constitution', $1) AS c,
          1 + CASE WHEN main_attr_is('reflex',       $1) THEN 3 ELSE 0 END + sub_attr_count('reflex',       $1) AS rf,
          1 + CASE WHEN main_attr_is('intellect',    $1) THEN 3 ELSE 0 END + sub_attr_count('intellect',    $1) AS i,
          1 + CASE WHEN main_attr_is('willpower',    $1) THEN 3 ELSE 0 END + sub_attr_count('willpower',    $1) AS w,
          1 + CASE WHEN main_attr_is('perception',   $1) THEN 3 ELSE 0 END + sub_attr_count('perception',   $1) AS p,
          1 + CASE WHEN main_attr_is('charisma',     $1) THEN 3 ELSE 0 END + sub_attr_count('charisma',     $1) AS ch
      `, [mbti.toUpperCase()]);
      const row = base.rows[0] as any;
      attrs = {
        attr_strength: row.s, attr_agility: row.a, attr_constitution: row.c, attr_reflex: row.rf,
        attr_intellect: row.i, attr_willpower: row.w, attr_perception: row.p, attr_charisma: row.ch,
      };
    }
    const code = b.code || (mbti ? `${mbti}-custom-${Date.now()}` : `custom-${Date.now()}`);
    const r = await pool.query(
      `INSERT INTO investigator_templates
       (code, faction_code, mbti_code, career_index, dominant_letter,
        name_zh, name_en, title_zh, title_en, backstory, ability_text_zh, ability_text_en,
        era_tags, portrait_url,
        attr_strength, attr_agility, attr_constitution, attr_reflex, attr_intellect, attr_willpower, attr_perception, attr_charisma,
        is_preset, is_completed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22, FALSE, FALSE)
       RETURNING *`,
      [
        code,
        b.faction_code || (mbti ? mbti[0] : null),
        mbti,
        b.career_index ?? null,
        b.dominant_letter ?? null,
        b.name_zh ?? null, b.name_en ?? null, b.title_zh ?? null, b.title_en ?? null,
        b.backstory ?? null, b.ability_text_zh ?? null, b.ability_text_en ?? null,
        b.era_tags ?? null, b.portrait_url ?? null,
        attrs.attr_strength, attrs.attr_agility, attrs.attr_constitution, attrs.attr_reflex,
        attrs.attr_intellect, attrs.attr_willpower, attrs.attr_perception, attrs.attr_charisma,
      ]
    );
    return reply.send(r.rows[0]);
  });

  app.patch('/api/admin/investigators/:id', async (request, reply) => {
    const { id } = request.params as any;
    const b = request.body as any;
    const invR = await pool.query('SELECT * FROM investigator_templates WHERE id=$1', [id]);
    if (invR.rowCount === 0) return reply.code(404).send({ error: 'not found' });
    const existing = invR.rows[0] as any;

    // 預設模板禁止改 MBTI 結構欄位
    const editable = existing.is_preset
      ? [...NARRATIVE_KEYS, ...ATTR_KEYS, 'proficiency_ids', 'ability_text_value', 'ability_value_source']
      : [...NARRATIVE_KEYS, ...ATTR_KEYS, 'proficiency_ids', 'ability_text_value', 'ability_value_source', ...MBTI_STRUCTURAL_KEYS];

    const sets: string[] = [];
    const params: any[] = [];
    for (const k of editable) {
      if (k in b) {
        params.push((b as any)[k]);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (sets.length === 0) return reply.send(existing);

    params.push(id);
    const r = await pool.query(
      `UPDATE investigator_templates SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length} RETURNING *`,
      params
    );
    // 重算 is_completed（可能因這次修改而達成/失去完成條件）
    await refreshIsCompleted(id);
    const fresh = await pool.query('SELECT * FROM investigator_templates WHERE id=$1', [id]);
    return reply.send(fresh.rows[0]);
  });

  app.delete('/api/admin/investigators/:id', async (request, reply) => {
    const { id } = request.params as any;
    const r = await pool.query('SELECT is_preset FROM investigator_templates WHERE id=$1', [id]);
    if (r.rowCount === 0) return reply.code(404).send({ error: 'not found' });
    if ((r.rows[0] as any).is_preset) {
      return reply.code(400).send({ error: 'preset templates cannot be deleted; use /clear instead' });
    }
    await pool.query('DELETE FROM investigator_templates WHERE id=$1', [id]);
    return reply.send({ ok: true });
  });

  // 清空預設模板回骨架狀態
  app.post('/api/admin/investigators/:id/clear', async (request, reply) => {
    const { id } = request.params as any;
    const r = await pool.query('SELECT mbti_code, is_preset FROM investigator_templates WHERE id=$1', [id]);
    if (r.rowCount === 0) return reply.code(404).send({ error: 'not found' });
    const row = r.rows[0] as any;
    if (!row.is_preset) return reply.code(400).send({ error: 'only preset templates can be cleared' });
    const mbti = row.mbti_code as string;

    // 重置屬性為基礎 14 點（v0.2 八屬性：8 基礎 + 主陣營 +3 + 三副陣營各 +1）
    const base = await pool.query(`
      SELECT
        1 + CASE WHEN main_attr_is('strength',     $1) THEN 3 ELSE 0 END + sub_attr_count('strength',     $1) AS s,
        1 + CASE WHEN main_attr_is('agility',      $1) THEN 3 ELSE 0 END + sub_attr_count('agility',      $1) AS a,
        1 + CASE WHEN main_attr_is('constitution', $1) THEN 3 ELSE 0 END + sub_attr_count('constitution', $1) AS c,
        1 + CASE WHEN main_attr_is('reflex',       $1) THEN 3 ELSE 0 END + sub_attr_count('reflex',       $1) AS rf,
        1 + CASE WHEN main_attr_is('intellect',    $1) THEN 3 ELSE 0 END + sub_attr_count('intellect',    $1) AS i,
        1 + CASE WHEN main_attr_is('willpower',    $1) THEN 3 ELSE 0 END + sub_attr_count('willpower',    $1) AS w,
        1 + CASE WHEN main_attr_is('perception',   $1) THEN 3 ELSE 0 END + sub_attr_count('perception',   $1) AS p,
        1 + CASE WHEN main_attr_is('charisma',     $1) THEN 3 ELSE 0 END + sub_attr_count('charisma',     $1) AS ch
    `, [mbti]);
    const b = base.rows[0] as any;

    await pool.query('DELETE FROM investigator_signature_cards WHERE investigator_id=$1', [id]);
    await pool.query('DELETE FROM investigator_weaknesses WHERE investigator_id=$1', [id]);
    await pool.query('DELETE FROM investigator_starting_deck WHERE investigator_id=$1', [id]);

    await pool.query(
      `UPDATE investigator_templates SET
         name_zh=NULL, name_en=NULL, title_zh=NULL, title_en=NULL,
         backstory=NULL, ability_text_zh=NULL, ability_text_en=NULL,
         era_tags=NULL, portrait_url=NULL,
         proficiency_ids='{}',
         attr_strength=$2, attr_agility=$3, attr_constitution=$4, attr_reflex=$5,
         attr_intellect=$6, attr_willpower=$7, attr_perception=$8, attr_charisma=$9,
         ability_text_value=0, ability_value_source='manual',
         is_completed=FALSE, updated_at=NOW()
       WHERE id=$1`,
      [id, b.s, b.a, b.c, b.rf, b.i, b.w, b.p, b.ch]
    );
    const fresh = await pool.query('SELECT * FROM investigator_templates WHERE id=$1', [id]);
    return reply.send(fresh.rows[0]);
  });

  // 複製模板（複製結果為 is_preset=FALSE 的自建模板）
  app.post('/api/admin/investigators/:id/clone', async (request, reply) => {
    const { id } = request.params as any;
    const r = await pool.query('SELECT * FROM investigator_templates WHERE id=$1', [id]);
    if (r.rowCount === 0) return reply.code(404).send({ error: 'not found' });
    const src = r.rows[0] as any;
    const newCode = `${src.code}-copy-${Date.now()}`;
    const ins = await pool.query(
      `INSERT INTO investigator_templates
       (code, faction_code, mbti_code, career_index, dominant_letter,
        name_zh, name_en, title_zh, title_en, backstory, ability_text_zh, ability_text_en,
        era_tags, portrait_url, proficiency_ids,
        attr_strength, attr_agility, attr_constitution, attr_reflex, attr_intellect, attr_willpower, attr_perception, attr_charisma,
        is_preset, is_completed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23, FALSE, FALSE)
       RETURNING *`,
      [
        newCode, src.faction_code, src.mbti_code, src.career_index, src.dominant_letter,
        src.name_zh, src.name_en, src.title_zh, src.title_en, src.backstory, src.ability_text_zh, src.ability_text_en,
        src.era_tags, src.portrait_url, src.proficiency_ids,
        src.attr_strength, src.attr_agility, src.attr_constitution, src.attr_reflex, src.attr_intellect,
        src.attr_willpower, src.attr_perception, src.attr_charisma,
      ]
    );
    return reply.send(ins.rows[0]);
  });

  // ════════════════════════════════════════════
  //  簽名卡
  // ════════════════════════════════════════════
  app.get('/api/admin/investigators/:id/signature-cards', async (request, reply) => {
    const { id } = request.params as any;
    const r = await pool.query(
      'SELECT * FROM investigator_signature_cards WHERE investigator_id=$1 ORDER BY card_order',
      [id]
    );
    return reply.send(r.rows);
  });

  app.post('/api/admin/investigators/:id/signature-cards', async (request, reply) => {
    const { id } = request.params as any;
    const b = request.body as any;
    const existing = await pool.query(
      'SELECT COUNT(*)::int AS c FROM investigator_signature_cards WHERE investigator_id=$1',
      [id]
    );
    if ((existing.rows[0] as any).c >= 3) {
      return reply.code(400).send({ error: 'maximum 3 signature cards per investigator' });
    }
    const r = await pool.query(
      `INSERT INTO investigator_signature_cards
       (investigator_id, card_order, name_zh, name_en, card_type, card_style, cost,
        commit_icons, consume_effect, play_effect, play_effect_code,
        flavor_text, illustration_url,
        effect_value, value_breakdown, value_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        id,
        b.card_order,
        b.name_zh,
        b.name_en ?? null,
        b.card_type,
        b.card_style ?? null,
        b.cost ?? 0,
        JSON.stringify(b.commit_icons ?? []),
        b.consume_effect ?? null,
        b.play_effect ?? null,
        JSON.stringify(b.play_effect_code ?? []),
        b.flavor_text ?? null,
        b.illustration_url ?? null,
        b.effect_value ?? 0,
        JSON.stringify(b.value_breakdown ?? []),
        b.value_source ?? 'manual',
      ]
    );
    // 自動加入起始牌組
    const created = r.rows[0] as any;
    await pool.query(
      `INSERT INTO investigator_starting_deck (investigator_id, signature_card_id, quantity)
       VALUES ($1, $2, 1) ON CONFLICT DO NOTHING`,
      [id, created.id]
    );
    await refreshIsCompleted(id);
    return reply.send(created);
  });

  app.patch('/api/admin/investigators/:id/signature-cards/:cid', async (request, reply) => {
    const { cid } = request.params as any;
    const b = request.body as any;
    const sets: string[] = [];
    const params: any[] = [];
    const editable = ['card_order','name_zh','name_en','card_type','card_style','cost',
      'commit_icons','consume_effect','play_effect','play_effect_code',
      'flavor_text','illustration_url','effect_value','value_breakdown','value_source'];
    for (const k of editable) {
      if (k in b) {
        const v = (k === 'commit_icons' || k === 'play_effect_code' || k === 'value_breakdown')
          ? JSON.stringify(b[k]) : b[k];
        params.push(v);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'no fields to update' });
    params.push(cid);
    const r = await pool.query(
      `UPDATE investigator_signature_cards SET ${sets.join(', ')}, updated_at=NOW(), value_last_updated=NOW()
       WHERE id=$${params.length} RETURNING investigator_id, *`,
      params
    );
    if (r.rowCount === 0) return reply.code(404).send({ error: 'not found' });
    await refreshIsCompleted((r.rows[0] as any).investigator_id);
    return reply.send(r.rows[0]);
  });

  app.delete('/api/admin/investigators/:id/signature-cards/:cid', async (request, reply) => {
    const { id, cid } = request.params as any;
    await pool.query('DELETE FROM investigator_starting_deck WHERE signature_card_id=$1', [cid]);
    await pool.query('DELETE FROM investigator_signature_cards WHERE id=$1', [cid]);
    await refreshIsCompleted(id);
    return reply.send({ ok: true });
  });

  // ════════════════════════════════════════════
  //  個人弱點
  // ════════════════════════════════════════════
  app.get('/api/admin/investigators/:id/weakness', async (request, reply) => {
    const { id } = request.params as any;
    const r = await pool.query('SELECT * FROM investigator_weaknesses WHERE investigator_id=$1', [id]);
    return reply.send(r.rows[0] || null);
  });

  app.put('/api/admin/investigators/:id/weakness', async (request, reply) => {
    const { id } = request.params as any;
    const b = request.body as any;
    const existing = await pool.query('SELECT id FROM investigator_weaknesses WHERE investigator_id=$1', [id]);
    let r;
    if (existing.rowCount === 0) {
      r = await pool.query(
        `INSERT INTO investigator_weaknesses
         (investigator_id, name_zh, name_en, weakness_type, trigger_condition,
          negative_effect, removal_condition, backstory, flavor_text,
          effect_value, trigger_probability, expected_rounds)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          id, b.name_zh, b.name_en ?? null, b.weakness_type,
          b.trigger_condition, b.negative_effect, b.removal_condition ?? null,
          b.backstory ?? null, b.flavor_text ?? null,
          b.effect_value ?? 0, b.trigger_probability ?? 0.067, b.expected_rounds ?? 5,
        ]
      );
      // 自動加入起始牌組
      await pool.query(
        `INSERT INTO investigator_starting_deck (investigator_id, weakness_id, quantity)
         VALUES ($1, $2, 1) ON CONFLICT DO NOTHING`,
        [id, (r.rows[0] as any).id]
      );
    } else {
      r = await pool.query(
        `UPDATE investigator_weaknesses SET
           name_zh=$1, name_en=$2, weakness_type=$3, trigger_condition=$4,
           negative_effect=$5, removal_condition=$6, backstory=$7, flavor_text=$8,
           effect_value=$9, trigger_probability=$10, expected_rounds=$11,
           updated_at=NOW()
         WHERE investigator_id=$12 RETURNING *`,
        [
          b.name_zh, b.name_en ?? null, b.weakness_type,
          b.trigger_condition, b.negative_effect, b.removal_condition ?? null,
          b.backstory ?? null, b.flavor_text ?? null,
          b.effect_value ?? 0, b.trigger_probability ?? 0.067, b.expected_rounds ?? 5,
          id,
        ]
      );
    }
    await refreshIsCompleted(id);
    return reply.send(r.rows[0]);
  });

  app.delete('/api/admin/investigators/:id/weakness', async (request, reply) => {
    const { id } = request.params as any;
    const wk = await pool.query('SELECT id FROM investigator_weaknesses WHERE investigator_id=$1', [id]);
    if (wk.rowCount === 0) return reply.send({ ok: true });
    const wid = (wk.rows[0] as any).id;
    await pool.query('DELETE FROM investigator_starting_deck WHERE weakness_id=$1', [wid]);
    await pool.query('DELETE FROM investigator_weaknesses WHERE id=$1', [wid]);
    await refreshIsCompleted(id);
    return reply.send({ ok: true });
  });

  // ════════════════════════════════════════════
  //  起始牌組
  // ════════════════════════════════════════════
  app.get('/api/admin/investigators/:id/starting-deck', async (request, reply) => {
    const { id } = request.params as any;
    const r = await pool.query(
      `SELECT d.*, cd.name_zh AS cd_name_zh, cd.cost AS cd_cost, cd.card_type AS cd_card_type, cd.faction AS cd_faction,
              sc.name_zh AS sc_name_zh, sc.cost AS sc_cost, sc.card_type AS sc_card_type,
              wk.name_zh AS wk_name_zh
         FROM investigator_starting_deck d
         LEFT JOIN card_definitions cd ON cd.id = d.card_definition_id
         LEFT JOIN investigator_signature_cards sc ON sc.id = d.signature_card_id
         LEFT JOIN investigator_weaknesses wk ON wk.id = d.weakness_id
         WHERE d.investigator_id=$1
         ORDER BY COALESCE(d.slot_order, 999), d.created_at`,
      [id]
    );
    return reply.send(r.rows);
  });

  app.post('/api/admin/investigators/:id/starting-deck/cards', async (request, reply) => {
    const { id } = request.params as any;
    const b = request.body as any;
    const sources = [b.card_definition_id, b.signature_card_id, b.weakness_id].filter(Boolean);
    if (sources.length !== 1) return reply.code(400).send({ error: 'exactly one source id required' });

    // 若為一般卡，驗證陣營對應
    if (b.card_definition_id) {
      const inv = await pool.query('SELECT mbti_code FROM investigator_templates WHERE id=$1', [id]);
      const card = await pool.query('SELECT faction, name_zh FROM card_definitions WHERE id=$1', [b.card_definition_id]);
      if (inv.rowCount === 0 || card.rowCount === 0) return reply.code(404).send({ error: 'investigator or card not found' });
      const mbti = ((inv.rows[0] as any).mbti_code || '').toUpperCase();
      const cf = ((card.rows[0] as any).faction || '').toUpperCase();
      const allowed = mbti.split('');
      const isNeutral = !cf || cf === 'NEUTRAL' || cf === 'N/A';
      const match = allowed.some((L: string) => cf.includes(L));
      if (!isNeutral && !match) {
        return reply.code(400).send({
          error: `卡片「${(card.rows[0] as any).name_zh}」屬於 ${cf} 陣營，不在該調查員的四字碼卡池 (${mbti}) 內`,
        });
      }
    }

    const r = await pool.query(
      `INSERT INTO investigator_starting_deck
       (investigator_id, card_definition_id, signature_card_id, weakness_id, quantity, slot_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        id,
        b.card_definition_id ?? null,
        b.signature_card_id ?? null,
        b.weakness_id ?? null,
        b.quantity ?? 1,
        b.slot_order ?? null,
      ]
    );
    await refreshIsCompleted(id);
    return reply.send(r.rows[0]);
  });

  app.patch('/api/admin/investigators/:id/starting-deck/cards/:slot', async (request, reply) => {
    const { id, slot } = request.params as any;
    const b = request.body as any;
    const r = await pool.query(
      `UPDATE investigator_starting_deck SET quantity=$1, slot_order=$2 WHERE id=$3 RETURNING *`,
      [b.quantity ?? 1, b.slot_order ?? null, slot]
    );
    if (r.rowCount === 0) return reply.code(404).send({ error: 'slot not found' });
    await refreshIsCompleted(id);
    return reply.send(r.rows[0]);
  });

  app.delete('/api/admin/investigators/:id/starting-deck/cards/:slot', async (request, reply) => {
    const { id, slot } = request.params as any;
    const r = await pool.query(
      `SELECT signature_card_id, weakness_id FROM investigator_starting_deck WHERE id=$1`,
      [slot]
    );
    if (r.rowCount === 0) return reply.code(404).send({ error: 'slot not found' });
    const row = r.rows[0] as any;
    if (row.signature_card_id || row.weakness_id) {
      return reply.code(400).send({ error: '簽名卡與弱點不可從牌組刪除（需從其編輯器處刪除）' });
    }
    await pool.query('DELETE FROM investigator_starting_deck WHERE id=$1', [slot]);
    await refreshIsCompleted(id);
    return reply.send({ ok: true });
  });

  app.get('/api/admin/investigators/:id/starting-deck/validate', async (request, reply) => {
    const { id } = request.params as any;
    const sumR = await pool.query(
      'SELECT COALESCE(SUM(quantity),0)::int AS total FROM investigator_starting_deck WHERE investigator_id=$1',
      [id]
    );
    const total = (sumR.rows[0] as any).total;
    const sigR = await pool.query(
      'SELECT COUNT(*)::int AS c FROM investigator_signature_cards WHERE investigator_id=$1',
      [id]
    );
    const wkR = await pool.query(
      'SELECT COUNT(*)::int AS c FROM investigator_weaknesses WHERE investigator_id=$1',
      [id]
    );
    const errors: string[] = [];
    const warnings: string[] = [];
    if (total < 15) errors.push(`牌組張數過少（${total} < 15）`);
    if (total > 20) errors.push(`牌組張數過多（${total} > 20）`);
    if ((sigR.rows[0] as any).c < 2) errors.push(`至少需要 2 張簽名卡（目前 ${(sigR.rows[0] as any).c}）`);
    if ((wkR.rows[0] as any).c < 1) errors.push('必須包含個人弱點');
    return reply.send({ totalCards: total, minCards: 15, maxCards: 20, isValid: errors.length === 0, errors, warnings });
  });

  // 依四字碼過濾可用卡池
  app.get('/api/admin/investigators/:id/available-cards', async (request, reply) => {
    const { id } = request.params as any;
    const q = request.query as any;
    const inv = await pool.query('SELECT mbti_code FROM investigator_templates WHERE id=$1', [id]);
    if (inv.rowCount === 0) return reply.code(404).send({ error: 'not found' });
    const mbti = ((inv.rows[0] as any).mbti_code || '').toUpperCase();
    const letters = mbti.split('');
    const where: string[] = ['is_signature = FALSE', 'is_weakness = FALSE'];
    const params: any[] = [];
    if (letters.length === 4) {
      // 允許陣營字串含四字碼中任一字母，或是中立（空/neutral）
      const conds: string[] = [`COALESCE(NULLIF(faction,''),'neutral') IN ('neutral','N/A')`];
      for (const L of letters) {
        params.push(`%${L}%`);
        conds.push(`UPPER(faction) LIKE $${params.length}`);
      }
      where.push(`(${conds.join(' OR ')})`);
    }
    if (q.card_type) { params.push(q.card_type); where.push(`card_type::text = $${params.length}`); }
    if (q.cost_min) { params.push(parseInt(q.cost_min, 10)); where.push(`cost >= $${params.length}`); }
    if (q.cost_max) { params.push(parseInt(q.cost_max, 10)); where.push(`cost <= $${params.length}`); }
    if (q.search) {
      params.push(`%${q.search}%`);
      where.push(`(name_zh ILIKE $${params.length} OR name_en ILIKE $${params.length})`);
    }
    const r = await pool.query(
      `SELECT id, code, name_zh, name_en, faction, card_type, cost, skill_value
         FROM card_definitions
         WHERE ${where.join(' AND ')}
         ORDER BY cost ASC, name_zh ASC
         LIMIT 500`,
      params
    );
    return reply.send(r.rows);
  });
};
