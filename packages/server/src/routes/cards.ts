import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

export const cardRoutes: FastifyPluginAsync = async (app) => {
  // All card API routes require authentication
  app.addHook('preHandler', requireAuth);

  // ── GET /api/cards ── list with filters
  app.get<{ Querystring: { faction?: string; style?: string; type?: string; search?: string; series?: string; combat_style?: string } }>(
    '/api/cards',
    async (request, reply) => {
      const { faction, style, type, search, series, combat_style } = request.query;
      let query = `
        SELECT c.*,
          COALESCE(json_agg(e.* ORDER BY e.sort_order) FILTER (WHERE e.id IS NOT NULL), '[]') AS effects
        FROM card_definitions c
        LEFT JOIN card_effects e ON e.card_def_id = c.id
      `;
      const conditions: string[] = [];
      const params: any[] = [];
      let pi = 1;
      if (faction) { conditions.push(`c.faction = $${pi++}`); params.push(faction); }
      if (style) { conditions.push(`c.style = $${pi++}`); params.push(style); }
      if (type) { conditions.push(`c.card_type = $${pi++}`); params.push(type); }
      if (series) { conditions.push(`c.series = $${pi++}`); params.push(series); }
      if (combat_style) { conditions.push(`c.combat_style = $${pi++}`); params.push(combat_style); }
      if (search) { conditions.push(`(c.name_zh ILIKE $${pi} OR c.name_en ILIKE $${pi} OR c.code ILIKE $${pi})`); params.push(`%${search}%`); pi++; }
      if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`;
      query += ` GROUP BY c.id ORDER BY c.code ASC`;

      try {
        const result = await pool.query(query, params);
        return reply.send({ success: true, data: result.rows, total: result.rows.length });
      } catch (error) {
        request.log.error(error, 'GET /api/cards error');
        return reply.status(500).send({ success: false, error: 'Failed to fetch cards' });
      }
    }
  );

  // ── GET /api/cards/export ── must be before :id
  app.get('/api/cards/export', async (request, reply) => {
    try {
      const result = await pool.query(`
        SELECT c.*,
          COALESCE(json_agg(e.* ORDER BY e.sort_order) FILTER (WHERE e.id IS NOT NULL), '[]') AS effects
        FROM card_definitions c
        LEFT JOIN card_effects e ON e.card_def_id = c.id
        GROUP BY c.id ORDER BY c.code
      `);
      reply.header('Content-Disposition', `attachment; filename="cards-export-${new Date().toISOString().split('T')[0]}.json"`);
      return reply.send({ exported_at: new Date().toISOString(), total: result.rows.length, cards: result.rows });
    } catch (error) {
      request.log.error(error, 'Export error');
      return reply.status(500).send({ success: false, error: 'Failed to export cards' });
    }
  });

  // ── GET /api/cards/next-code ── preview next auto-code
  app.get<{ Querystring: { series?: string; faction: string; style: string } }>(
    '/api/cards/next-code',
    async (request, reply) => {
      const { series = 'C', faction, style } = request.query;
      if (!faction || !style) {
        return reply.status(400).send({ success: false, error: 'faction and style are required' });
      }
      const factionCode = faction === 'neutral' ? 'N0' : faction;
      const prefix = `${series}${factionCode}${style}`;
      try {
        const result = await pool.query(
          `SELECT code FROM card_definitions WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`,
          [`${prefix}-%`]
        );
        let nextNumber = 1;
        if (result.rows.length > 0) {
          nextNumber = parseInt(result.rows[0].code.split('-')[1], 10) + 1;
        }
        return reply.send({ success: true, data: { prefix, nextNumber, nextCode: `${prefix}-${String(nextNumber).padStart(2, '0')}` } });
      } catch (error) {
        request.log.error(error, 'next-code error');
        return reply.status(500).send({ success: false, error: 'Failed to calculate next code' });
      }
    }
  );

  // ── GET /api/cards/:id ── single card with effects
  app.get<{ Params: { id: string } }>('/api/cards/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const card = await pool.query('SELECT * FROM card_definitions WHERE id = $1', [id]);
      if (card.rows.length === 0) return reply.status(404).send({ success: false, error: 'Card not found' });
      const effects = await pool.query('SELECT * FROM card_effects WHERE card_def_id = $1 ORDER BY sort_order', [id]);
      return reply.send({ success: true, data: { ...card.rows[0], effects: effects.rows } });
    } catch (error) {
      request.log.error(error, 'GET card error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch card' });
    }
  });

  // ── POST /api/cards ── create card with auto-generated code
  app.post<{ Body: Record<string, any> }>('/api/cards', async (request, reply) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const b = request.body;

      // Auto-generate code
      const seriesCode = b.series || 'C';
      const factionCode = b.faction === 'neutral' ? 'N0' : b.faction;
      const prefix = `${seriesCode}${factionCode}${b.style}`;
      const maxRes = await client.query(
        `SELECT code FROM card_definitions WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`,
        [`${prefix}-%`]
      );
      let nextNum = 1;
      if (maxRes.rows.length > 0) nextNum = parseInt(maxRes.rows[0].code.split('-')[1], 10) + 1;
      const code = `${prefix}-${String(nextNum).padStart(2, '0')}`;

      const insertSQL = `
        INSERT INTO card_definitions (
          code, series, name_zh, name_en, faction, style, card_type, slot,
          is_unique, is_signature, is_weakness, is_revelation,
          level, cost, cost_currency, skill_value, damage, horror,
          health_boost, sanity_boost, weapon_tier, ammo, uses, consume_type,
          combat_style, attribute_modifiers, spell_type, spell_casting, hand_limit_mod,
          ally_hp, ally_san, xp_cost, subtypes,
          flavor_text, removable, committable, lethal_count, owner_investigator
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
          $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38
        ) RETURNING *`;

      const vals = [
        code, seriesCode, b.name_zh, b.name_en, b.faction, b.style, b.card_type || b.type, b.slot || 'none',
        b.is_unique || false, b.is_signature || false, b.is_weakness || false, b.is_revelation || false,
        b.level || 0, b.cost || 0, b.cost_currency || 'resource', b.skill_value || 0, b.damage || 0, b.horror || 0,
        b.health_boost || 0, b.sanity_boost || 0, b.weapon_tier || null, b.ammo || null, b.uses || null, b.consume_type || 'discard',
        b.combat_style || null, JSON.stringify(b.attribute_modifiers || {}), b.spell_type || null, b.spell_casting || null, b.hand_limit_mod || 0,
        b.ally_hp || null, b.ally_san || null, b.xp_cost || 0, b.subtypes || [],
        b.flavor_text || null, b.removable !== false, b.committable !== false, b.lethal_count || 0, b.owner_investigator || null
      ];

      const cardResult = await client.query(insertSQL, vals);
      const newCard = cardResult.rows[0];

      await insertEffects(client, newCard.id, b.effects);
      await client.query('COMMIT');

      const effs = await pool.query('SELECT * FROM card_effects WHERE card_def_id = $1 ORDER BY sort_order', [newCard.id]);
      return reply.status(201).send({ success: true, data: { ...newCard, effects: effs.rows } });
    } catch (error: any) {
      await client.query('ROLLBACK');
      request.log.error(error, 'POST card error');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: 'Card code conflict, please retry' });
      return reply.status(500).send({ success: false, error: 'Failed to create card' });
    } finally {
      client.release();
    }
  });

  // ── PUT /api/cards/:id ── update card
  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/cards/:id', async (request, reply) => {
    const { id } = request.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const b = request.body;

      const updateSQL = `
        UPDATE card_definitions SET
          name_zh=$1, name_en=$2, slot=$3,
          is_unique=$4, is_signature=$5, is_weakness=$6, is_revelation=$7,
          level=$8, cost=$9, cost_currency=$10, skill_value=$11,
          damage=$12, horror=$13, health_boost=$14, sanity_boost=$15,
          weapon_tier=$16, ammo=$17, uses=$18, consume_type=$19,
          combat_style=$20, attribute_modifiers=$21, spell_type=$22, spell_casting=$23, hand_limit_mod=$24,
          ally_hp=$25, ally_san=$26, xp_cost=$27, subtypes=$28,
          flavor_text=$29, removable=$30, committable=$31, lethal_count=$32, owner_investigator=$33,
          version = version + 1, updated_at = NOW()
        WHERE id = $34 RETURNING *`;

      const vals = [
        b.name_zh, b.name_en, b.slot || 'none',
        b.is_unique || false, b.is_signature || false, b.is_weakness || false, b.is_revelation || false,
        b.level || 0, b.cost || 0, b.cost_currency || 'resource', b.skill_value || 0,
        b.damage || 0, b.horror || 0, b.health_boost || 0, b.sanity_boost || 0,
        b.weapon_tier || null, b.ammo || null, b.uses || null, b.consume_type || 'discard',
        b.combat_style || null, JSON.stringify(b.attribute_modifiers || {}), b.spell_type || null, b.spell_casting || null, b.hand_limit_mod || 0,
        b.ally_hp || null, b.ally_san || null, b.xp_cost || 0, b.subtypes || [],
        b.flavor_text || null, b.removable !== false, b.committable !== false, b.lethal_count || 0, b.owner_investigator || null,
        id
      ];

      const cardResult = await client.query(updateSQL, vals);
      if (cardResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ success: false, error: 'Card not found' });
      }

      await client.query('DELETE FROM card_effects WHERE card_def_id = $1', [id]);
      await insertEffects(client, id, b.effects);
      await client.query('COMMIT');

      const effs = await pool.query('SELECT * FROM card_effects WHERE card_def_id = $1 ORDER BY sort_order', [id]);
      return reply.send({ success: true, data: { ...cardResult.rows[0], effects: effs.rows } });
    } catch (error) {
      await client.query('ROLLBACK');
      request.log.error(error, 'PUT card error');
      return reply.status(500).send({ success: false, error: 'Failed to update card' });
    } finally {
      client.release();
    }
  });

  // ── DELETE /api/cards/:id
  app.delete<{ Params: { id: string } }>('/api/cards/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const result = await pool.query('DELETE FROM card_definitions WHERE id = $1 RETURNING id, code', [id]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Card not found' });
      return reply.send({ success: true, data: { deleted: result.rows[0] } });
    } catch (error) {
      request.log.error(error, 'DELETE card error');
      return reply.status(500).send({ success: false, error: 'Failed to delete card' });
    }
  });

  // ── POST /api/cards/import ── bulk import
  app.post<{ Body: { cards: any[] } }>('/api/cards/import', async (request, reply) => {
    const { cards } = request.body;
    if (!Array.isArray(cards)) {
      return reply.status(400).send({ success: false, error: 'Expected { cards: [...] }' });
    }
    const results = { success: 0, failed: 0, errors: [] as string[] };
    for (const card of cards) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const seriesCode = card.series || 'C';
        const factionCode = card.faction === 'neutral' ? 'N0' : card.faction;
        const prefix = `${seriesCode}${factionCode}${card.style}`;
        const maxRes = await client.query(`SELECT code FROM card_definitions WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`, [`${prefix}-%`]);
        let nextNum = 1;
        if (maxRes.rows.length > 0) nextNum = parseInt(maxRes.rows[0].code.split('-')[1], 10) + 1;
        const code = `${prefix}-${String(nextNum).padStart(2, '0')}`;

        // Auto-migrate old format: check_attribute + check_modifier → attribute_modifiers
        let attrMods = card.attribute_modifiers || {};
        if (!Object.keys(attrMods).length && card.check_attribute) {
          attrMods = { [card.check_attribute]: card.check_modifier || 0 };
        }

        const insertRes = await client.query(`
          INSERT INTO card_definitions (
            code,series,name_zh,name_en,faction,style,card_type,slot,
            is_unique,is_signature,is_weakness,is_revelation,
            level,cost,cost_currency,skill_value,damage,horror,
            health_boost,sanity_boost,weapon_tier,ammo,uses,consume_type,
            combat_style,attribute_modifiers,spell_type,spell_casting,hand_limit_mod,
            ally_hp,ally_san,xp_cost,subtypes,flavor_text,removable,committable,lethal_count,owner_investigator
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38) RETURNING id`,
          [code,seriesCode,card.name_zh,card.name_en,card.faction,card.style,card.card_type||card.type,card.slot||'none',
           card.is_unique||false,card.is_signature||false,card.is_weakness||false,card.is_revelation||false,
           card.level||0,card.cost||0,card.cost_currency||'resource',card.skill_value||0,card.damage||0,card.horror||0,
           card.health_boost||0,card.sanity_boost||0,card.weapon_tier||null,card.ammo||null,card.uses||null,card.consume_type||'discard',
           card.combat_style||null,JSON.stringify(attrMods),card.spell_type||null,card.spell_casting||null,card.hand_limit_mod||0,
           card.ally_hp||null,card.ally_san||null,card.xp_cost||0,card.subtypes||[],card.flavor_text||null,
           card.removable!==false,card.committable!==false,card.lethal_count||0,card.owner_investigator||null]
        );
        await insertEffects(client, insertRes.rows[0].id, card.effects);
        await client.query('COMMIT');
        results.success++;
      } catch (error: any) {
        await client.query('ROLLBACK');
        results.failed++;
        results.errors.push(`${card.name_zh || 'unknown'}: ${error.message}`);
      } finally {
        client.release();
      }
    }
    return reply.send({ success: true, data: results });
  });
};

// ── Helper: insert effects for a card
async function insertEffects(client: any, cardId: string, effects?: any[]) {
  if (!effects || !effects.length) return;
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i];
    await client.query(`
      INSERT INTO card_effects (
        card_def_id, trigger_type, condition, cost, target,
        effect_code, effect_params, duration, scope,
        description_zh, description_en, sort_order
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        cardId,
        e.trigger_type || e.trigger || 'on_play',
        e.condition ? JSON.stringify(e.condition) : null,
        e.cost ? JSON.stringify(e.cost) : null,
        e.target || null,
        e.effect_code,
        JSON.stringify(e.effect_params || e.params || {}),
        e.duration || 'instant',
        e.scope || null,
        e.description_zh || e.desc_zh || null,
        e.description_en || e.desc_en || null,
        e.sort_order ?? i
      ]
    );
  }
}
