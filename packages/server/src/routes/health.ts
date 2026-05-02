import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { getLastMigrationError, getStartupTimestamp } from '../lib/startup-state.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    let db = 'unknown';
    let tables: string[] = [];
    let adminCount = 0;
    const seedCounts: Record<string, number> = {};
    try {
      const res = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
      tables = res.rows.map((r: any) => r.tablename);
      db = 'connected';
      const adminRes = await pool.query("SELECT count(*) FROM admin_users").catch(() => ({ rows: [{ count: 0 }] }));
      adminCount = parseInt(adminRes.rows[0].count, 10);
      const seedTables = ['material_categories', 'material_definitions', 'forging_affixes', 'forging_affix_tiers', 'crafting_recipes'];
      for (const t of seedTables) {
        const r = await pool.query(`SELECT count(*) FROM ${t}`).catch(() => ({ rows: [{ count: -1 }] }));
        seedCounts[t] = parseInt(r.rows[0].count, 10);
      }
    } catch (e: any) {
      db = `error: ${e.message}`;
    }
    return {
      status: 'ok',
      version: '0.1.0',
      db,
      tables,
      adminCount,
      seedCounts,
      startedAt: getStartupTimestamp(),
      lastMigrationError: getLastMigrationError(),
    };
  });
};
