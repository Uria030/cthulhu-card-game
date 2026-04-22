import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * 雙軸戰鬥草案 v1.0：
 * - GET /api/admin/threat-types — 三種遭遇卡威脅類型（mental / physical / ritual）
 * - GET /api/admin/talisman-types — 六種法器物質類型（桃木 / 銀製 / 鋼製 / 水晶 / 鹽 / 符卷）
 *
 * 兩張表由 MIGRATION_021 seed 建立，此 plugin 僅提供唯讀查詢。
 *
 * 注意：threat_type（威脅類型）與 encounter_cards.encounter_type（交互類型，既有）
 * 是正交的兩個概念，不可混用。
 */
export const typesRegistryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/api/admin/threat-types', async (_request, reply) => {
    const r = await pool.query('SELECT code, name_zh, name_en, description, narrative_archetype FROM threat_types ORDER BY code');
    return reply.send({ success: true, data: r.rows });
  });

  app.get('/api/admin/talisman-types', async (_request, reply) => {
    const r = await pool.query('SELECT code, name_zh, name_en, description FROM talisman_types ORDER BY code');
    return reply.send({ success: true, data: r.rows });
  });
};
