import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    let db = 'unknown';
    let tables: string[] = [];
    let adminCount = 0;
    try {
      const res = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
      tables = res.rows.map((r: any) => r.tablename);
      db = 'connected';
      const adminRes = await pool.query("SELECT count(*) FROM admin_users").catch(() => ({ rows: [{ count: 0 }] }));
      adminCount = parseInt(adminRes.rows[0].count, 10);
    } catch (e: any) {
      db = `error: ${e.message}`;
    }
    return { status: 'ok', version: '0.1.0', db, tables, adminCount };
  });
};
