import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

// ── Tier defaults for auto-fill on variant creation
const TIER_DEFAULTS: Record<number, { dc: number; hp_base: number; damage_physical: number; spell_defense: number; attacks_per_round: number }> = {
  1: { dc: 12, hp_base: 4,  damage_physical: 1, spell_defense: 0, attacks_per_round: 1 },
  2: { dc: 16, hp_base: 11, damage_physical: 3, spell_defense: 2, attacks_per_round: 1 },
  3: { dc: 20, hp_base: 23, damage_physical: 4, spell_defense: 4, attacks_per_round: 1 },
  4: { dc: 24, hp_base: 42, damage_physical: 6, spell_defense: 6, attacks_per_round: 2 },
  5: { dc: 28, hp_base: 62, damage_physical: 8, spell_defense: 8, attacks_per_round: 2 },
};

// ── Validation: arcane must not appear in weaknesses/resistances/immunities
function validateNoArcane(body: Record<string, any>): string | null {
  for (const field of ['weaknesses', 'resistances', 'immunities']) {
    const arr = body[field];
    if (Array.isArray(arr) && arr.includes('arcane')) {
      return '神秘（Arcane）元素不能有抗性或免疫';
    }
  }
  // Also check base_ prefixed versions (for species)
  for (const field of ['base_weaknesses', 'base_resistances', 'base_immunities']) {
    const arr = body[field];
    if (Array.isArray(arr) && arr.includes('arcane')) {
      return '神秘（Arcane）元素不能有抗性或免疫';
    }
  }
  return null;
}

export const monsterRoutes: FastifyPluginAsync = async (app) => {
  // All monster API routes require authentication
  app.addHook('preHandler', requireAuth);

  // ════════════════════════════════════════════
  //  批次 / 統計路由 — 必須在 /:id 之前定義
  // ════════════════════════════════════════════

  // ── GET /api/admin/monsters/stats/overview ── 全局統計
  app.get('/api/admin/monsters/stats/overview', async (request, reply) => {
    try {
      const families = await pool.query('SELECT COUNT(*)::int AS count FROM monster_families');
      const species = await pool.query('SELECT COUNT(*)::int AS count FROM monster_species');
      const variants = await pool.query('SELECT COUNT(*)::int AS count FROM monster_variants');
      const cards = await pool.query('SELECT COUNT(*)::int AS count FROM monster_attack_cards');

      const breakdown = await pool.query(`
        SELECT
          mf.id, mf.code, mf.name_zh, mf.name_en,
          (SELECT COUNT(*) FROM monster_species ms WHERE ms.family_id = mf.id)::int AS species_count,
          (SELECT COUNT(*) FROM monster_variants mv
            JOIN monster_species ms2 ON ms2.id = mv.species_id
            WHERE ms2.family_id = mf.id)::int AS variant_count,
          (SELECT COUNT(*) FROM monster_attack_cards mac
            LEFT JOIN monster_variants mv2 ON mv2.id = mac.variant_id
            LEFT JOIN monster_species ms3 ON ms3.id = COALESCE(mac.species_id, mv2.species_id)
            WHERE ms3.family_id = mf.id)::int AS card_count
        FROM monster_families mf
        ORDER BY mf.sort_order, mf.code
      `);

      return reply.send({
        success: true,
        data: {
          totals: {
            families: families.rows[0].count,
            species: species.rows[0].count,
            variants: variants.rows[0].count,
            attack_cards: cards.rows[0].count,
          },
          per_family: breakdown.rows,
        },
      });
    } catch (error) {
      request.log.error(error, 'GET monsters/stats/overview error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch monster stats' });
    }
  });

  // ── GET /api/admin/monsters/attack-cards ── 攻擊卡列表
  app.get<{ Querystring: { variant_id?: string; species_id?: string } }>(
    '/api/admin/monsters/attack-cards',
    async (request, reply) => {
      const { variant_id, species_id } = request.query;
      try {
        if (variant_id) {
          // Get variant-specific cards + species-level shared cards
          const variant = await pool.query('SELECT species_id FROM monster_variants WHERE id = $1', [variant_id]);
          if (variant.rows.length === 0) return reply.status(404).send({ success: false, error: 'Variant not found' });
          const sid = variant.rows[0].species_id;

          const result = await pool.query(`
            SELECT * FROM monster_attack_cards
            WHERE variant_id = $1 OR (species_id = $2 AND variant_id IS NULL)
            ORDER BY sort_order, code
          `, [variant_id, sid]);
          return reply.send({ success: true, data: result.rows, total: result.rows.length });
        } else if (species_id) {
          const result = await pool.query(
            'SELECT * FROM monster_attack_cards WHERE species_id = $1 ORDER BY sort_order, code',
            [species_id]
          );
          return reply.send({ success: true, data: result.rows, total: result.rows.length });
        } else {
          const result = await pool.query('SELECT * FROM monster_attack_cards ORDER BY sort_order, code');
          return reply.send({ success: true, data: result.rows, total: result.rows.length });
        }
      } catch (error) {
        request.log.error(error, 'GET attack-cards error');
        return reply.status(500).send({ success: false, error: 'Failed to fetch attack cards' });
      }
    }
  );

  // ── POST /api/admin/monsters/attack-cards ── 新增攻擊卡
  app.post<{ Body: Record<string, any> }>('/api/admin/monsters/attack-cards', async (request, reply) => {
    const b = request.body;
    try {
      const result = await pool.query(`
        INSERT INTO monster_attack_cards (
          species_id, variant_id, code, name_zh, name_en,
          defense_attribute, dc_override, damage_physical, damage_horror, damage_element,
          inflicts_status, special_effect, weight, use_condition,
          narrative_attack_zh, narrative_attack_en,
          narrative_hit_zh, narrative_hit_en,
          narrative_miss_zh, narrative_miss_en,
          sort_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        RETURNING *
      `, [
        b.species_id || null, b.variant_id || null, b.code, b.name_zh, b.name_en,
        b.defense_attribute, b.dc_override || null, b.damage_physical || 0, b.damage_horror || 0, b.damage_element || null,
        b.inflicts_status ? JSON.stringify(b.inflicts_status) : null,
        b.special_effect ? JSON.stringify(b.special_effect) : null,
        b.weight || 1, b.use_condition ? JSON.stringify(b.use_condition) : null,
        b.narrative_attack_zh || null, b.narrative_attack_en || null,
        b.narrative_hit_zh || null, b.narrative_hit_en || null,
        b.narrative_miss_zh || null, b.narrative_miss_en || null,
        b.sort_order || 0,
      ]);
      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      request.log.error(error, 'POST attack-card error');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: 'Attack card code already exists' });
      return reply.status(500).send({ success: false, error: 'Failed to create attack card' });
    }
  });

  // ── PUT /api/admin/monsters/attack-cards/:id ── 更新攻擊卡
  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/admin/monsters/attack-cards/:id', async (request, reply) => {
    const { id } = request.params;
    const b = request.body;
    try {
      const result = await pool.query(`
        UPDATE monster_attack_cards SET
          species_id = $1, variant_id = $2, name_zh = $3, name_en = $4,
          defense_attribute = $5, dc_override = $6, damage_physical = $7, damage_horror = $8, damage_element = $9,
          inflicts_status = $10, special_effect = $11, weight = $12, use_condition = $13,
          narrative_attack_zh = $14, narrative_attack_en = $15,
          narrative_hit_zh = $16, narrative_hit_en = $17,
          narrative_miss_zh = $18, narrative_miss_en = $19,
          sort_order = $20
        WHERE id = $21 RETURNING *
      `, [
        b.species_id || null, b.variant_id || null, b.name_zh, b.name_en,
        b.defense_attribute, b.dc_override || null, b.damage_physical || 0, b.damage_horror || 0, b.damage_element || null,
        b.inflicts_status ? JSON.stringify(b.inflicts_status) : null,
        b.special_effect ? JSON.stringify(b.special_effect) : null,
        b.weight || 1, b.use_condition ? JSON.stringify(b.use_condition) : null,
        b.narrative_attack_zh || null, b.narrative_attack_en || null,
        b.narrative_hit_zh || null, b.narrative_hit_en || null,
        b.narrative_miss_zh || null, b.narrative_miss_en || null,
        b.sort_order || 0,
        id,
      ]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Attack card not found' });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT attack-card error');
      return reply.status(500).send({ success: false, error: 'Failed to update attack card' });
    }
  });

  // ── DELETE /api/admin/monsters/attack-cards/:id ── 刪除攻擊卡
  app.delete<{ Params: { id: string } }>('/api/admin/monsters/attack-cards/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const result = await pool.query('DELETE FROM monster_attack_cards WHERE id = $1 RETURNING id, code', [id]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Attack card not found' });
      return reply.send({ success: true, data: { deleted: result.rows[0] } });
    } catch (error) {
      request.log.error(error, 'DELETE attack-card error');
      return reply.status(500).send({ success: false, error: 'Failed to delete attack card' });
    }
  });

  // ════════════════════════════════════════════
  //  怪物家族 CRUD
  // ════════════════════════════════════════════

  // ── GET /api/admin/monsters/families ── 列出所有家族 + 統計
  app.get('/api/admin/monsters/families', async (request, reply) => {
    try {
      const result = await pool.query(`
        SELECT mf.*,
          (SELECT COUNT(*) FROM monster_species ms WHERE ms.family_id = mf.id)::int AS species_count,
          (SELECT COUNT(*) FROM monster_variants mv
            JOIN monster_species ms2 ON ms2.id = mv.species_id
            WHERE ms2.family_id = mf.id)::int AS variant_count
        FROM monster_families mf
        ORDER BY mf.sort_order, mf.code
      `);
      return reply.send({ success: true, data: result.rows, total: result.rows.length });
    } catch (error) {
      request.log.error(error, 'GET families error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch monster families' });
    }
  });

  // ── GET /api/admin/monsters/families/:id ── 單一家族完整資料
  app.get<{ Params: { id: string } }>('/api/admin/monsters/families/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const family = await pool.query('SELECT * FROM monster_families WHERE id = $1', [id]);
      if (family.rows.length === 0) return reply.status(404).send({ success: false, error: 'Family not found' });
      return reply.send({ success: true, data: family.rows[0] });
    } catch (error) {
      request.log.error(error, 'GET family error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch family' });
    }
  });

  // ── PUT /api/admin/monsters/families/:id ── 更新家族
  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/admin/monsters/families/:id', async (request, reply) => {
    const { id } = request.params;
    const b = request.body;

    const arcaneErr = validateNoArcane(b);
    if (arcaneErr) return reply.status(400).send({ success: false, error: arcaneErr });

    try {
      const result = await pool.query(`
        UPDATE monster_families SET
          name_zh = $1, name_en = $2, patron_zh = $3, patron_en = $4,
          patron_title_zh = $5, patron_title_en = $6, theme_zh = $7, theme_en = $8,
          family_type = $9, chaos_bag_preferences = $10, attack_element = $11,
          damage_focus = $12, combat_tempo_zh = $13, combat_tempo_en = $14,
          typical_keywords = $15, ai_preference = $16,
          weaknesses = $17, resistances = $18, immunities = $19,
          inflicted_statuses = $20, self_buffs = $21, status_immunities = $22,
          fear_radius_range = $23, fear_value_range = $24,
          fear_design_note_zh = $25, fear_design_note_en = $26,
          defense_attribute_tendency = $27,
          rival_family_codes = $28, rival_note_zh = $29, rival_note_en = $30,
          is_active = $31, expansion_note = $32, sort_order = $33, design_status = $34,
          updated_at = NOW()
        WHERE id = $35 RETURNING *
      `, [
        b.name_zh, b.name_en, b.patron_zh || null, b.patron_en || null,
        b.patron_title_zh || null, b.patron_title_en || null, b.theme_zh || null, b.theme_en || null,
        b.family_type || null, b.chaos_bag_preferences ? JSON.stringify(b.chaos_bag_preferences) : null,
        b.attack_element || null,
        b.damage_focus || null, b.combat_tempo_zh || null, b.combat_tempo_en || null,
        b.typical_keywords ? JSON.stringify(b.typical_keywords) : null, b.ai_preference || null,
        b.weaknesses ? JSON.stringify(b.weaknesses) : null,
        b.resistances ? JSON.stringify(b.resistances) : null,
        b.immunities ? JSON.stringify(b.immunities) : null,
        b.inflicted_statuses ? JSON.stringify(b.inflicted_statuses) : null,
        b.self_buffs ? JSON.stringify(b.self_buffs) : null,
        b.status_immunities ? JSON.stringify(b.status_immunities) : null,
        b.fear_radius_range ? JSON.stringify(b.fear_radius_range) : null,
        b.fear_value_range ? JSON.stringify(b.fear_value_range) : null,
        b.fear_design_note_zh || null, b.fear_design_note_en || null,
        b.defense_attribute_tendency ? JSON.stringify(b.defense_attribute_tendency) : null,
        b.rival_family_codes ? JSON.stringify(b.rival_family_codes) : null,
        b.rival_note_zh || null, b.rival_note_en || null,
        b.is_active !== undefined ? b.is_active : true, b.expansion_note || null,
        b.sort_order || 0, b.design_status || 'draft',
        id,
      ]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Family not found' });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT family error');
      return reply.status(500).send({ success: false, error: 'Failed to update family' });
    }
  });

  // ════════════════════════════════════════════
  //  怪物物種 CRUD
  // ════════════════════════════════════════════

  // ── GET /api/admin/monsters/species ── 列出物種（可篩選）
  app.get<{ Querystring: { family_id?: string; family_code?: string; design_status?: string } }>(
    '/api/admin/monsters/species',
    async (request, reply) => {
      const { family_id, family_code, design_status } = request.query;
      let query = `
        SELECT ms.*,
          mf.code AS family_code, mf.name_zh AS family_name_zh,
          (SELECT COUNT(*) FROM monster_variants mv WHERE mv.species_id = ms.id)::int AS variant_count
        FROM monster_species ms
        JOIN monster_families mf ON mf.id = ms.family_id
      `;
      const conditions: string[] = [];
      const params: any[] = [];
      let pi = 1;
      if (family_id) { conditions.push(`ms.family_id = $${pi++}`); params.push(family_id); }
      if (family_code) { conditions.push(`mf.code = $${pi++}`); params.push(family_code); }
      if (design_status) { conditions.push(`ms.design_status = $${pi++}`); params.push(design_status); }
      if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`;
      query += ` ORDER BY ms.sort_order, ms.code`;

      try {
        const result = await pool.query(query, params);
        return reply.send({ success: true, data: result.rows, total: result.rows.length });
      } catch (error) {
        request.log.error(error, 'GET species error');
        return reply.status(500).send({ success: false, error: 'Failed to fetch species' });
      }
    }
  );

  // ── GET /api/admin/monsters/species/:id ── 單一物種 + variants 摘要 + shared attack cards
  app.get<{ Params: { id: string } }>('/api/admin/monsters/species/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const species = await pool.query(`
        SELECT ms.*, mf.code AS family_code, mf.name_zh AS family_name_zh
        FROM monster_species ms
        JOIN monster_families mf ON mf.id = ms.family_id
        WHERE ms.id = $1
      `, [id]);
      if (species.rows.length === 0) return reply.status(404).send({ success: false, error: 'Species not found' });

      const variants = await pool.query(`
        SELECT id, code, name_zh, name_en, tier, dc, hp_base, design_status
        FROM monster_variants WHERE species_id = $1
        ORDER BY tier, sort_order, code
      `, [id]);

      const sharedCards = await pool.query(
        'SELECT * FROM monster_attack_cards WHERE species_id = $1 AND variant_id IS NULL ORDER BY sort_order, code',
        [id]
      );

      return reply.send({
        success: true,
        data: {
          ...species.rows[0],
          variants: variants.rows,
          shared_attack_cards: sharedCards.rows,
        },
      });
    } catch (error) {
      request.log.error(error, 'GET species/:id error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch species' });
    }
  });

  // ── POST /api/admin/monsters/species ── 新增物種
  app.post<{ Body: Record<string, any> }>('/api/admin/monsters/species', async (request, reply) => {
    const b = request.body;

    const arcaneErr = validateNoArcane(b);
    if (arcaneErr) return reply.status(400).send({ success: false, error: arcaneErr });

    try {
      const result = await pool.query(`
        INSERT INTO monster_species (
          family_id, code, name_zh, name_en, description_zh, description_en,
          lore_zh, lore_en, base_attack_element, base_ai_preference,
          base_weaknesses, base_resistances, base_immunities, base_status_immunities,
          tier_min, tier_max, base_keywords, defense_attribute_tendency,
          design_notes, variant_count, art_url, sort_order, design_status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        RETURNING *
      `, [
        b.family_id, b.code, b.name_zh, b.name_en, b.description_zh || null, b.description_en || null,
        b.lore_zh || null, b.lore_en || null, b.base_attack_element || null, b.base_ai_preference || null,
        b.base_weaknesses ? JSON.stringify(b.base_weaknesses) : null,
        b.base_resistances ? JSON.stringify(b.base_resistances) : null,
        b.base_immunities ? JSON.stringify(b.base_immunities) : null,
        b.base_status_immunities ? JSON.stringify(b.base_status_immunities) : null,
        b.tier_min || 1, b.tier_max || 5,
        b.base_keywords ? JSON.stringify(b.base_keywords) : null,
        b.defense_attribute_tendency ? JSON.stringify(b.defense_attribute_tendency) : null,
        b.design_notes || null, b.variant_count || 0, b.art_url || null,
        b.sort_order || 0, b.design_status || 'draft',
      ]);
      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      request.log.error(error, 'POST species error');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: 'Species code already exists' });
      return reply.status(500).send({ success: false, error: 'Failed to create species' });
    }
  });

  // ── PUT /api/admin/monsters/species/:id ── 更新物種
  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/admin/monsters/species/:id', async (request, reply) => {
    const { id } = request.params;
    const b = request.body;

    const arcaneErr = validateNoArcane(b);
    if (arcaneErr) return reply.status(400).send({ success: false, error: arcaneErr });

    try {
      const result = await pool.query(`
        UPDATE monster_species SET
          family_id = $1, name_zh = $2, name_en = $3, description_zh = $4, description_en = $5,
          lore_zh = $6, lore_en = $7, base_attack_element = $8, base_ai_preference = $9,
          base_weaknesses = $10, base_resistances = $11, base_immunities = $12, base_status_immunities = $13,
          tier_min = $14, tier_max = $15, base_keywords = $16, defense_attribute_tendency = $17,
          design_notes = $18, variant_count = $19, art_url = $20, sort_order = $21, design_status = $22,
          updated_at = NOW()
        WHERE id = $23 RETURNING *
      `, [
        b.family_id, b.name_zh, b.name_en, b.description_zh || null, b.description_en || null,
        b.lore_zh || null, b.lore_en || null, b.base_attack_element || null, b.base_ai_preference || null,
        b.base_weaknesses ? JSON.stringify(b.base_weaknesses) : null,
        b.base_resistances ? JSON.stringify(b.base_resistances) : null,
        b.base_immunities ? JSON.stringify(b.base_immunities) : null,
        b.base_status_immunities ? JSON.stringify(b.base_status_immunities) : null,
        b.tier_min || 1, b.tier_max || 5,
        b.base_keywords ? JSON.stringify(b.base_keywords) : null,
        b.defense_attribute_tendency ? JSON.stringify(b.defense_attribute_tendency) : null,
        b.design_notes || null, b.variant_count || 0, b.art_url || null,
        b.sort_order || 0, b.design_status || 'draft',
        id,
      ]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Species not found' });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT species error');
      return reply.status(500).send({ success: false, error: 'Failed to update species' });
    }
  });

  // ── DELETE /api/admin/monsters/species/:id ── 刪除物種（CASCADE）
  app.delete<{ Params: { id: string } }>('/api/admin/monsters/species/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const result = await pool.query('DELETE FROM monster_species WHERE id = $1 RETURNING id, code', [id]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Species not found' });
      return reply.send({ success: true, data: { deleted: result.rows[0] } });
    } catch (error) {
      request.log.error(error, 'DELETE species error');
      return reply.status(500).send({ success: false, error: 'Failed to delete species' });
    }
  });

  // ════════════════════════════════════════════
  //  怪物變體 CRUD
  // ════════════════════════════════════════════

  // ── GET /api/admin/monsters/variants ── 列出變體（可篩選）
  app.get<{ Querystring: { species_id?: string; family_code?: string; tier?: string } }>(
    '/api/admin/monsters/variants',
    async (request, reply) => {
      const { species_id, family_code, tier } = request.query;
      let query = `
        SELECT mv.*,
          ms.code AS species_code, ms.name_zh AS species_name_zh,
          mf.code AS family_code, mf.name_zh AS family_name_zh
        FROM monster_variants mv
        JOIN monster_species ms ON ms.id = mv.species_id
        JOIN monster_families mf ON mf.id = ms.family_id
      `;
      const conditions: string[] = [];
      const params: any[] = [];
      let pi = 1;
      if (species_id) { conditions.push(`mv.species_id = $${pi++}`); params.push(species_id); }
      if (family_code) { conditions.push(`mf.code = $${pi++}`); params.push(family_code); }
      if (tier) { conditions.push(`mv.tier = $${pi++}`); params.push(parseInt(tier, 10)); }
      if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`;
      query += ` ORDER BY mv.tier, mv.sort_order, mv.code`;

      try {
        const result = await pool.query(query, params);
        return reply.send({ success: true, data: result.rows, total: result.rows.length });
      } catch (error) {
        request.log.error(error, 'GET variants error');
        return reply.status(500).send({ success: false, error: 'Failed to fetch variants' });
      }
    }
  );

  // ── GET /api/admin/monsters/variants/:id ── 單一變體 + 攻擊卡 + 狀態描述 + resolved 繼承
  app.get<{ Params: { id: string } }>('/api/admin/monsters/variants/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const variant = await pool.query('SELECT * FROM monster_variants WHERE id = $1', [id]);
      if (variant.rows.length === 0) return reply.status(404).send({ success: false, error: 'Variant not found' });
      const v = variant.rows[0];

      const species = await pool.query('SELECT * FROM monster_species WHERE id = $1', [v.species_id]);
      const s = species.rows[0];

      const family = await pool.query('SELECT * FROM monster_families WHERE id = $1', [s.family_id]);
      const f = family.rows[0];

      // Attack cards: variant-specific + species shared
      const attackCards = await pool.query(`
        SELECT * FROM monster_attack_cards
        WHERE variant_id = $1 OR (species_id = $2 AND variant_id IS NULL)
        ORDER BY sort_order, code
      `, [id, v.species_id]);

      const statusDescs = await pool.query(
        'SELECT * FROM monster_status_descriptions WHERE variant_id = $1 ORDER BY sort_order',
        [id]
      );

      // Compute resolved inheritance chain: variant > species > family
      const resolved = {
        attack_element: v.attack_element ?? s.base_attack_element ?? f.attack_element,
        weaknesses: v.weaknesses ?? s.base_weaknesses ?? f.weaknesses,
        resistances: v.resistances ?? s.base_resistances ?? f.resistances,
        immunities: v.immunities ?? s.base_immunities ?? f.immunities,
        status_immunities: v.status_immunities ?? s.base_status_immunities ?? f.status_immunities,
        ai_preference: v.ai_preference ?? s.base_ai_preference ?? f.ai_preference,
        inflicted_statuses: v.inflicted_statuses ?? f.inflicted_statuses,
        self_buffs: v.self_buffs ?? f.self_buffs,
      };

      return reply.send({
        success: true,
        data: {
          ...v,
          species_code: s.code,
          species_name_zh: s.name_zh,
          family_code: f.code,
          family_name_zh: f.name_zh,
          attack_cards: attackCards.rows,
          status_descriptions: statusDescs.rows,
          resolved,
        },
      });
    } catch (error) {
      request.log.error(error, 'GET variant/:id error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch variant' });
    }
  });

  // ── POST /api/admin/monsters/variants ── 新增變體（含 tier 預設值 + 自動建立狀態描述）
  app.post<{ Body: Record<string, any> }>('/api/admin/monsters/variants', async (request, reply) => {
    const b = request.body;

    const arcaneErr = validateNoArcane(b);
    if (arcaneErr) return reply.status(400).send({ success: false, error: arcaneErr });

    // Validate tier within species range
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const speciesRes = await client.query('SELECT tier_min, tier_max FROM monster_species WHERE id = $1', [b.species_id]);
      if (speciesRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ success: false, error: 'Species not found' });
      }
      const { tier_min, tier_max } = speciesRes.rows[0];
      const tier = b.tier || 1;
      if (tier < tier_min || tier > tier_max) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ success: false, error: `Tier must be between ${tier_min} and ${tier_max}` });
      }

      // Apply tier defaults
      const defaults = TIER_DEFAULTS[tier] || TIER_DEFAULTS[1];

      const result = await client.query(`
        INSERT INTO monster_variants (
          species_id, code, name_zh, name_en, tier,
          dc, hp_base, hp_per_player, damage_physical, damage_horror,
          regen_per_round, spell_defense, attacks_per_round,
          fear_radius, fear_value, fear_type,
          movement_speed, movement_type, keywords,
          attack_element, weaknesses, resistances, immunities, resistance_values,
          inflicted_statuses, self_buffs, status_immunities,
          ai_preference, ai_preference_param, ai_behavior_notes,
          is_undefeatable, phase_count, phase_rules, legendary_actions, environment_effects,
          description_zh, description_en, art_url, design_notes,
          attack_card_count, sort_order, design_status
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42
        ) RETURNING *
      `, [
        b.species_id, b.code, b.name_zh, b.name_en, tier,
        b.dc ?? defaults.dc, b.hp_base ?? defaults.hp_base, b.hp_per_player || 0,
        b.damage_physical ?? defaults.damage_physical, b.damage_horror || 0,
        b.regen_per_round || 0, b.spell_defense ?? defaults.spell_defense, b.attacks_per_round ?? defaults.attacks_per_round,
        b.fear_radius || 0, b.fear_value || 0, b.fear_type || null,
        b.movement_speed || null, b.movement_type || null,
        b.keywords ? JSON.stringify(b.keywords) : null,
        b.attack_element || null,
        b.weaknesses ? JSON.stringify(b.weaknesses) : null,
        b.resistances ? JSON.stringify(b.resistances) : null,
        b.immunities ? JSON.stringify(b.immunities) : null,
        b.resistance_values ? JSON.stringify(b.resistance_values) : null,
        b.inflicted_statuses ? JSON.stringify(b.inflicted_statuses) : null,
        b.self_buffs ? JSON.stringify(b.self_buffs) : null,
        b.status_immunities ? JSON.stringify(b.status_immunities) : null,
        b.ai_preference || null, b.ai_preference_param || null, b.ai_behavior_notes || null,
        b.is_undefeatable || false, b.phase_count || 1,
        b.phase_rules ? JSON.stringify(b.phase_rules) : null,
        b.legendary_actions ? JSON.stringify(b.legendary_actions) : null,
        b.environment_effects ? JSON.stringify(b.environment_effects) : null,
        b.description_zh || null, b.description_en || null, b.art_url || null, b.design_notes || null,
        b.attack_card_count || 0, b.sort_order || 0, b.design_status || 'draft',
      ]);

      const newVariant = result.rows[0];

      // Auto-create 5 default status descriptions
      const defaultThresholds = [
        { hp_threshold: 100, sort_order: 0 },
        { hp_threshold: 75,  sort_order: 1 },
        { hp_threshold: 50,  sort_order: 2 },
        { hp_threshold: 25,  sort_order: 3 },
        { hp_threshold: 0,   sort_order: 4 },
      ];
      for (const t of defaultThresholds) {
        await client.query(`
          INSERT INTO monster_status_descriptions (variant_id, hp_threshold, description_zh, description_en, sort_order)
          VALUES ($1, $2, $3, $4, $5)
        `, [newVariant.id, t.hp_threshold, null, null, t.sort_order]);
      }

      // Update species variant_count
      await client.query(`
        UPDATE monster_species SET variant_count = (SELECT COUNT(*) FROM monster_variants WHERE species_id = $1)::int, updated_at = NOW()
        WHERE id = $1
      `, [b.species_id]);

      await client.query('COMMIT');
      return reply.status(201).send({ success: true, data: newVariant });
    } catch (error: any) {
      await client.query('ROLLBACK');
      request.log.error(error, 'POST variant error');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: 'Variant code already exists' });
      return reply.status(500).send({ success: false, error: 'Failed to create variant' });
    } finally {
      client.release();
    }
  });

  // ── PUT /api/admin/monsters/variants/:id ── 更新變體
  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/admin/monsters/variants/:id', async (request, reply) => {
    const { id } = request.params;
    const b = request.body;

    const arcaneErr = validateNoArcane(b);
    if (arcaneErr) return reply.status(400).send({ success: false, error: arcaneErr });

    // Validate tier within species range if tier is provided
    if (b.tier !== undefined) {
      try {
        const variantRes = await pool.query('SELECT species_id FROM monster_variants WHERE id = $1', [id]);
        if (variantRes.rows.length === 0) return reply.status(404).send({ success: false, error: 'Variant not found' });
        const speciesId = b.species_id || variantRes.rows[0].species_id;
        const speciesRes = await pool.query('SELECT tier_min, tier_max FROM monster_species WHERE id = $1', [speciesId]);
        if (speciesRes.rows.length > 0) {
          const { tier_min, tier_max } = speciesRes.rows[0];
          if (b.tier < tier_min || b.tier > tier_max) {
            return reply.status(400).send({ success: false, error: `Tier must be between ${tier_min} and ${tier_max}` });
          }
        }
      } catch (error) {
        request.log.error(error, 'PUT variant tier validation error');
        return reply.status(500).send({ success: false, error: 'Failed to validate tier' });
      }
    }

    try {
      const result = await pool.query(`
        UPDATE monster_variants SET
          species_id = $1, name_zh = $2, name_en = $3, tier = $4,
          dc = $5, hp_base = $6, hp_per_player = $7, damage_physical = $8, damage_horror = $9,
          regen_per_round = $10, spell_defense = $11, attacks_per_round = $12,
          fear_radius = $13, fear_value = $14, fear_type = $15,
          movement_speed = $16, movement_type = $17, keywords = $18,
          attack_element = $19, weaknesses = $20, resistances = $21, immunities = $22, resistance_values = $23,
          inflicted_statuses = $24, self_buffs = $25, status_immunities = $26,
          ai_preference = $27, ai_preference_param = $28, ai_behavior_notes = $29,
          is_undefeatable = $30, phase_count = $31, phase_rules = $32, legendary_actions = $33, environment_effects = $34,
          description_zh = $35, description_en = $36, art_url = $37, design_notes = $38,
          attack_card_count = $39, sort_order = $40, design_status = $41,
          updated_at = NOW()
        WHERE id = $42 RETURNING *
      `, [
        b.species_id, b.name_zh, b.name_en, b.tier,
        b.dc, b.hp_base, b.hp_per_player || 0, b.damage_physical, b.damage_horror || 0,
        b.regen_per_round || 0, b.spell_defense, b.attacks_per_round,
        b.fear_radius || 0, b.fear_value || 0, b.fear_type || null,
        b.movement_speed || null, b.movement_type || null,
        b.keywords ? JSON.stringify(b.keywords) : null,
        b.attack_element || null,
        b.weaknesses ? JSON.stringify(b.weaknesses) : null,
        b.resistances ? JSON.stringify(b.resistances) : null,
        b.immunities ? JSON.stringify(b.immunities) : null,
        b.resistance_values ? JSON.stringify(b.resistance_values) : null,
        b.inflicted_statuses ? JSON.stringify(b.inflicted_statuses) : null,
        b.self_buffs ? JSON.stringify(b.self_buffs) : null,
        b.status_immunities ? JSON.stringify(b.status_immunities) : null,
        b.ai_preference || null, b.ai_preference_param || null, b.ai_behavior_notes || null,
        b.is_undefeatable || false, b.phase_count || 1,
        b.phase_rules ? JSON.stringify(b.phase_rules) : null,
        b.legendary_actions ? JSON.stringify(b.legendary_actions) : null,
        b.environment_effects ? JSON.stringify(b.environment_effects) : null,
        b.description_zh || null, b.description_en || null, b.art_url || null, b.design_notes || null,
        b.attack_card_count || 0, b.sort_order || 0, b.design_status || 'draft',
        id,
      ]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Variant not found' });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT variant error');
      return reply.status(500).send({ success: false, error: 'Failed to update variant' });
    }
  });

  // ── DELETE /api/admin/monsters/variants/:id ── 刪除變體（CASCADE）
  app.delete<{ Params: { id: string } }>('/api/admin/monsters/variants/:id', async (request, reply) => {
    const { id } = request.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const variant = await client.query('SELECT species_id FROM monster_variants WHERE id = $1', [id]);
      if (variant.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ success: false, error: 'Variant not found' });
      }
      const speciesId = variant.rows[0].species_id;

      await client.query('DELETE FROM monster_variants WHERE id = $1', [id]);

      // Update species variant_count
      await client.query(`
        UPDATE monster_species SET variant_count = (SELECT COUNT(*) FROM monster_variants WHERE species_id = $1)::int, updated_at = NOW()
        WHERE id = $1
      `, [speciesId]);

      await client.query('COMMIT');
      return reply.send({ success: true, data: { deleted: id } });
    } catch (error) {
      await client.query('ROLLBACK');
      request.log.error(error, 'DELETE variant error');
      return reply.status(500).send({ success: false, error: 'Failed to delete variant' });
    } finally {
      client.release();
    }
  });

  // ── POST /api/admin/monsters/variants/:id/duplicate ── 複製變體
  app.post<{ Params: { id: string } }>('/api/admin/monsters/variants/:id/duplicate', async (request, reply) => {
    const { id } = request.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const original = await client.query('SELECT * FROM monster_variants WHERE id = $1', [id]);
      if (original.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ success: false, error: 'Variant not found' });
      }
      const o = original.rows[0];

      const newCode = o.code + '_copy';
      const newNameZh = o.name_zh ? o.name_zh + '_copy' : null;
      const newNameEn = o.name_en ? o.name_en + '_copy' : null;

      const newVariant = await client.query(`
        INSERT INTO monster_variants (
          species_id, code, name_zh, name_en, tier,
          dc, hp_base, hp_per_player, damage_physical, damage_horror,
          regen_per_round, spell_defense, attacks_per_round,
          fear_radius, fear_value, fear_type,
          movement_speed, movement_type, keywords,
          attack_element, weaknesses, resistances, immunities, resistance_values,
          inflicted_statuses, self_buffs, status_immunities,
          ai_preference, ai_preference_param, ai_behavior_notes,
          is_undefeatable, phase_count, phase_rules, legendary_actions, environment_effects,
          description_zh, description_en, art_url, design_notes,
          attack_card_count, sort_order, design_status
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42
        ) RETURNING *
      `, [
        o.species_id, newCode, newNameZh, newNameEn, o.tier,
        o.dc, o.hp_base, o.hp_per_player, o.damage_physical, o.damage_horror,
        o.regen_per_round, o.spell_defense, o.attacks_per_round,
        o.fear_radius, o.fear_value, o.fear_type,
        o.movement_speed, o.movement_type, o.keywords ? JSON.stringify(o.keywords) : null,
        o.attack_element,
        o.weaknesses ? JSON.stringify(o.weaknesses) : null,
        o.resistances ? JSON.stringify(o.resistances) : null,
        o.immunities ? JSON.stringify(o.immunities) : null,
        o.resistance_values ? JSON.stringify(o.resistance_values) : null,
        o.inflicted_statuses ? JSON.stringify(o.inflicted_statuses) : null,
        o.self_buffs ? JSON.stringify(o.self_buffs) : null,
        o.status_immunities ? JSON.stringify(o.status_immunities) : null,
        o.ai_preference, o.ai_preference_param, o.ai_behavior_notes,
        o.is_undefeatable, o.phase_count,
        o.phase_rules ? JSON.stringify(o.phase_rules) : null,
        o.legendary_actions ? JSON.stringify(o.legendary_actions) : null,
        o.environment_effects ? JSON.stringify(o.environment_effects) : null,
        o.description_zh, o.description_en, o.art_url, o.design_notes,
        o.attack_card_count, o.sort_order, o.design_status || 'draft',
      ]);

      const newId = newVariant.rows[0].id;

      // Duplicate attack cards
      const cards = await client.query('SELECT * FROM monster_attack_cards WHERE variant_id = $1 ORDER BY sort_order', [id]);
      for (const c of cards.rows) {
        await client.query(`
          INSERT INTO monster_attack_cards (
            species_id, variant_id, code, name_zh, name_en,
            defense_attribute, dc_override, damage_physical, damage_horror, damage_element,
            inflicts_status, special_effect, weight, use_condition,
            narrative_attack_zh, narrative_attack_en,
            narrative_hit_zh, narrative_hit_en,
            narrative_miss_zh, narrative_miss_en,
            sort_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        `, [
          c.species_id, newId, c.code + '_copy', c.name_zh, c.name_en,
          c.defense_attribute, c.dc_override, c.damage_physical, c.damage_horror, c.damage_element,
          c.inflicts_status ? JSON.stringify(c.inflicts_status) : null,
          c.special_effect ? JSON.stringify(c.special_effect) : null,
          c.weight, c.use_condition ? JSON.stringify(c.use_condition) : null,
          c.narrative_attack_zh, c.narrative_attack_en,
          c.narrative_hit_zh, c.narrative_hit_en,
          c.narrative_miss_zh, c.narrative_miss_en,
          c.sort_order,
        ]);
      }

      // Duplicate status descriptions
      const descs = await client.query('SELECT * FROM monster_status_descriptions WHERE variant_id = $1 ORDER BY sort_order', [id]);
      for (const d of descs.rows) {
        await client.query(`
          INSERT INTO monster_status_descriptions (variant_id, hp_threshold, description_zh, description_en, sort_order)
          VALUES ($1, $2, $3, $4, $5)
        `, [newId, d.hp_threshold, d.description_zh, d.description_en, d.sort_order]);
      }

      // Update species variant_count
      await client.query(`
        UPDATE monster_species SET variant_count = (SELECT COUNT(*) FROM monster_variants WHERE species_id = $1)::int, updated_at = NOW()
        WHERE id = $1
      `, [o.species_id]);

      await client.query('COMMIT');
      return reply.status(201).send({ success: true, data: newVariant.rows[0] });
    } catch (error: any) {
      await client.query('ROLLBACK');
      request.log.error(error, 'POST variant duplicate error');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: 'Duplicate code conflict — variant may already have a copy' });
      return reply.status(500).send({ success: false, error: 'Failed to duplicate variant' });
    } finally {
      client.release();
    }
  });

  // ── PUT /api/admin/monsters/variants/:id/status-descriptions ── 批次替換狀態描述
  app.put<{ Params: { id: string }; Body: { descriptions: Array<{ hp_threshold: number; description_zh?: string; description_en?: string; sort_order?: number }> } }>(
    '/api/admin/monsters/variants/:id/status-descriptions',
    async (request, reply) => {
      const { id } = request.params;
      const { descriptions } = request.body;

      if (!Array.isArray(descriptions)) {
        return reply.status(400).send({ success: false, error: 'Expected { descriptions: [...] }' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Verify variant exists
        const variant = await client.query('SELECT id FROM monster_variants WHERE id = $1', [id]);
        if (variant.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ success: false, error: 'Variant not found' });
        }

        // Delete all existing and re-insert
        await client.query('DELETE FROM monster_status_descriptions WHERE variant_id = $1', [id]);

        for (let i = 0; i < descriptions.length; i++) {
          const d = descriptions[i];
          await client.query(`
            INSERT INTO monster_status_descriptions (variant_id, hp_threshold, description_zh, description_en, sort_order)
            VALUES ($1, $2, $3, $4, $5)
          `, [id, d.hp_threshold, d.description_zh || null, d.description_en || null, d.sort_order ?? i]);
        }

        await client.query('COMMIT');

        const result = await pool.query('SELECT * FROM monster_status_descriptions WHERE variant_id = $1 ORDER BY sort_order', [id]);
        return reply.send({ success: true, data: result.rows });
      } catch (error) {
        await client.query('ROLLBACK');
        request.log.error(error, 'PUT status-descriptions error');
        return reply.status(500).send({ success: false, error: 'Failed to update status descriptions' });
      } finally {
        client.release();
      }
    }
  );
};
