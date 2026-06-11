// 玩家側唯讀端點 — 單人測試版
// 安全界線:本檔只允許 GET 唯讀,不掛 requireAuth(玩家網頁無 admin 登入)。
// 任何寫入端點(存檔等)未來另開檔案並走玩家帳號驗證,不放這裡。
import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { loadFullStage } from './stages.js';

export const playRoutes: FastifyPluginAsync = async (app) => {
  // ═══════════════════════════════════════════
  // 出發板:可遊玩關卡清單(主線,含戰役/章節資訊)
  // ═══════════════════════════════════════════
  app.get('/api/play/stages', async (request, reply) => {
    try {
      const res = await pool.query(
        `SELECT s.id, s.code, s.name_zh, s.stage_type, s.narrative, s.design_status,
                ch.chapter_number, ch.name_zh AS chapter_name,
                c.id AS campaign_id, c.code AS campaign_code, c.name_zh AS campaign_name,
                c.theme, c.cover_narrative, c.difficulty_tier,
                (SELECT COUNT(*) FROM scenarios WHERE stage_id = s.id)::int AS scenario_count
           FROM stages s
           JOIN chapters ch ON ch.id = s.chapter_id
           JOIN campaigns c ON c.id = ch.campaign_id
          WHERE s.stage_type = 'main'
          ORDER BY c.created_at, ch.chapter_number`,
      );
      return reply.send({ success: true, data: res.rows });
    } catch (error) {
      request.log.error(error, 'play: 列出關卡失敗');
      return reply.status(500).send({ success: false, error: '列出關卡失敗' });
    }
  });

  // ═══════════════════════════════════════════
  // 可選調查員清單(大廳/整備用,只列設計完成的)
  // ═══════════════════════════════════════════
  app.get('/api/play/investigators', async (request, reply) => {
    try {
      const res = await pool.query(
        `SELECT id, code, mbti_code, faction_code, name_zh, name_en,
                title_zh, backstory, ability_text_zh, portrait_url,
                attr_strength, attr_agility, attr_constitution, attr_reflex,
                attr_intellect, attr_willpower, attr_perception, attr_charisma
           FROM investigator_templates
          WHERE is_completed = TRUE
          ORDER BY mbti_code`,
      );
      return reply.send({ success: true, data: res.rows });
    } catch (error) {
      request.log.error(error, 'play: 列出調查員失敗');
      return reply.status(500).send({ success: false, error: '列出調查員失敗' });
    }
  });

  // ═══════════════════════════════════════════
  // 開局包:引擎初始化所需的全部零件一次回傳
  //   ?investigator=<uuid> 指定調查員,預設取第一位設計完成者
  // ═══════════════════════════════════════════
  app.get<{
    Params: { id: string };
    Querystring: { investigator?: string };
  }>('/api/play/stages/:id/bootstrap', async (request, reply) => {
    try {
      const stage = await loadFullStage(request.params.id);
      if (!stage) {
        return reply.status(404).send({ success: false, error: '關卡不存在' });
      }

      // ── 章節 + 戰役 + 結局 ──
      let chapter: any = null;
      let campaign: any = null;
      let outcomes: any[] = [];
      if (stage.chapter_id) {
        const chRes = await pool.query('SELECT * FROM chapters WHERE id = $1', [stage.chapter_id]);
        chapter = chRes.rows[0] || null;
        if (chapter) {
          const [campRes, outRes] = await Promise.all([
            pool.query('SELECT * FROM campaigns WHERE id = $1', [chapter.campaign_id]),
            pool.query(
              'SELECT * FROM chapter_outcomes WHERE chapter_id = $1 ORDER BY outcome_code',
              [chapter.id],
            ),
          ]);
          campaign = campRes.rows[0] || null;
          outcomes = outRes.rows;
        }
      }

      // ── 地點(場景引用的所有 code)+ 標籤 + 隱藏資訊 ──
      const locCodes = [
        ...new Set(
          (stage.scenarios || []).flatMap((sc: any) => sc.initial_location_codes || []),
        ),
      ];
      let locations: any[] = [];
      if (locCodes.length > 0) {
        const locRes = await pool.query(
          'SELECT * FROM locations WHERE code = ANY($1)',
          [locCodes],
        );
        locations = locRes.rows;
        const locIds = locations.map((l: any) => l.id);
        const [tagRes, hidRes] = await Promise.all([
          pool.query(
            `SELECT ltm.location_id, lst.code, lst.name_zh, lst.category
               FROM location_tag_map ltm
               JOIN location_style_tags lst ON lst.id = ltm.tag_id
              WHERE ltm.location_id = ANY($1)`,
            [locIds],
          ),
          pool.query(
            `SELECT * FROM location_hidden_info
              WHERE location_id = ANY($1) ORDER BY location_id, sort_order`,
            [locIds],
          ),
        ]);
        for (const loc of locations) {
          loc.tags = tagRes.rows.filter((t: any) => t.location_id === loc.id);
          loc.hidden_info = hidRes.rows.filter((h: any) => h.location_id === loc.id);
        }
      }

      // ── 三池完整卡面(loadFullStage 只帶名稱,這裡補全卡內容)──
      const mythosIds = (stage.mythos_pool || []).map((p: any) => p.mythos_card_id).filter(Boolean);
      const encounterIds = (stage.encounter_pool || []).map((p: any) => p.encounter_card_id).filter(Boolean);
      const familyCodes = (stage.monster_pool || []).map((p: any) => p.family_code).filter(Boolean);

      const [mythosRes, mythosFxRes, encRes, encOptRes, monsterRes] = await Promise.all([
        mythosIds.length
          ? pool.query('SELECT * FROM mythos_cards WHERE id = ANY($1)', [mythosIds])
          : Promise.resolve({ rows: [] as any[] }),
        mythosIds.length
          ? pool.query(
              `SELECT * FROM mythos_card_effects
                WHERE mythos_card_id = ANY($1) ORDER BY mythos_card_id, sort_order`,
              [mythosIds],
            )
          : Promise.resolve({ rows: [] as any[] }),
        encounterIds.length
          ? pool.query('SELECT * FROM encounter_cards WHERE id = ANY($1)', [encounterIds])
          : Promise.resolve({ rows: [] as any[] }),
        encounterIds.length
          ? pool.query(
              `SELECT * FROM encounter_card_options
                WHERE encounter_card_id = ANY($1) ORDER BY encounter_card_id, sort_order`,
              [encounterIds],
            )
          : Promise.resolve({ rows: [] as any[] }),
        familyCodes.length
          ? pool.query(
              `SELECT mv.*, ms.code AS species_code, ms.name_zh AS species_name_zh,
                      mf.code AS family_code
                 FROM monster_variants mv
                 JOIN monster_species ms ON ms.id = mv.species_id
                 JOIN monster_families mf ON mf.id = ms.family_id
                WHERE mf.code = ANY($1)
                ORDER BY mf.code, mv.tier, mv.sort_order`,
              [familyCodes],
            )
          : Promise.resolve({ rows: [] as any[] }),
      ]);

      const mythosCards = mythosRes.rows.map((mc: any) => ({
        ...mc,
        effects: mythosFxRes.rows.filter((e: any) => e.mythos_card_id === mc.id),
      }));
      const encounterCards = encRes.rows.map((ec: any) => ({
        ...ec,
        options: encOptRes.rows.filter((o: any) => o.encounter_card_id === ec.id),
      }));

      // ── 怪物招式卡(變體 move_pool 引用的方式庫卡)──
      const moveCodes = [
        ...new Set(
          monsterRes.rows.flatMap((mv: any) =>
            (Array.isArray(mv.move_pool) ? mv.move_pool : []).map((m: any) => m.code),
          ),
        ),
      ].filter(Boolean);
      const attackCards = moveCodes.length
        ? (
            await pool.query('SELECT * FROM monster_attack_cards WHERE code = ANY($1)', [
              moveCodes,
            ])
          ).rows
        : [];

      // ── 調查員 + 起始牌組(含卡片效果)──
      const invId = request.query.investigator;
      const invRes = invId
        ? await pool.query(
            'SELECT * FROM investigator_templates WHERE id = $1 AND is_completed = TRUE',
            [invId],
          )
        : await pool.query(
            'SELECT * FROM investigator_templates WHERE is_completed = TRUE ORDER BY mbti_code LIMIT 1',
          );
      const investigator: any = invRes.rows[0] || null;
      if (investigator) {
        const [deckRes, sigRes, weakRes] = await Promise.all([
          pool.query(
            `SELECT d.id AS deck_entry_id, d.quantity, d.slot_order,
                    d.card_definition_id, d.signature_card_id, d.weakness_id
               FROM investigator_starting_deck d
              WHERE d.investigator_id = $1
              ORDER BY d.slot_order NULLS LAST, d.created_at`,
            [investigator.id],
          ),
          pool.query(
            'SELECT * FROM investigator_signature_cards WHERE investigator_id = $1',
            [investigator.id],
          ),
          pool.query(
            'SELECT * FROM investigator_weaknesses WHERE investigator_id = $1',
            [investigator.id],
          ),
        ]);

        const cardDefIds = deckRes.rows
          .map((d: any) => d.card_definition_id)
          .filter(Boolean);
        const [cardDefRes, cardFxRes] = await Promise.all([
          cardDefIds.length
            ? pool.query('SELECT * FROM card_definitions WHERE id = ANY($1)', [cardDefIds])
            : Promise.resolve({ rows: [] as any[] }),
          cardDefIds.length
            ? pool.query(
                `SELECT * FROM card_effects
                  WHERE card_def_id = ANY($1) ORDER BY card_def_id, sort_order`,
                [cardDefIds],
              )
            : Promise.resolve({ rows: [] as any[] }),
        ]);
        const cardsById = new Map<string, any>(
          cardDefRes.rows.map((c: any) => [
            c.id,
            { ...c, effects: cardFxRes.rows.filter((e: any) => e.card_def_id === c.id) },
          ]),
        );

        investigator.starting_deck = deckRes.rows.map((d: any) => ({
          ...d,
          card: d.card_definition_id ? cardsById.get(d.card_definition_id) || null : null,
          signature_card: d.signature_card_id
            ? sigRes.rows.find((s: any) => s.id === d.signature_card_id) || null
            : null,
          weakness: d.weakness_id
            ? weakRes.rows.find((w: any) => w.id === d.weakness_id) || null
            : null,
        }));
      }

      // ── 戰鬥風格卡池(§8:攻擊時抽卡決定檢定屬性)──
      // 範圍 = 牌組武器用到的風格 + 調查員主熟練;第一層(card_tier=1)公用池
      const styleCodes = new Set<string>();
      for (const entry of investigator?.starting_deck ?? []) {
        const cs = entry.card?.combat_style;
        if (cs) styleCodes.add(String(cs));
      }
      for (const p of investigator?.proficiency_ids ?? []) {
        if (typeof p === 'string' && p) styleCodes.add(p);
      }
      const stylePools = styleCodes.size
        ? (
            await pool.query(
              `SELECT csc.code, csc.name_zh, csc.check_attribute,
                      csc.narrative_attack_zh, csc.narrative_success_zh, csc.narrative_fail_zh,
                      cs.code AS style_code
                 FROM combat_style_cards csc
                 JOIN combat_styles cs ON cs.id = csc.style_id
                WHERE cs.code = ANY($1) AND csc.card_tier = 1
                ORDER BY cs.code, csc.sort_order`,
              [[...styleCodes]],
            )
          ).rows
        : [];

      // ── 城主行動點設定(keeper_ai_regulation §2.1)──
      const keeperSettings: Record<string, unknown> = {};
      const kbRes = await pool.query(
        `SELECT setting_key, value FROM game_balance_settings WHERE setting_group = 'keeper_action_points'`,
      );
      for (const row of kbRes.rows) {
        keeperSettings[row.setting_key] = row.value?.value;
      }

      return reply.send({
        success: true,
        data: {
          stage,
          campaign,
          chapter: chapter ? { ...chapter, outcomes } : null,
          locations,
          mythos_cards: mythosCards,
          encounter_cards: encounterCards,
          monsters: monsterRes.rows,
          monster_attack_cards: attackCards,
          investigator,
          combat_style_pools: stylePools,
          keeper_settings: keeperSettings,
        },
      });
    } catch (error) {
      request.log.error(error, 'play: 開局包組裝失敗');
      return reply.status(500).send({ success: false, error: '開局包組裝失敗' });
    }
  });
};
