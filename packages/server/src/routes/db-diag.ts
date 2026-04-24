import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import {
  MIGRATION_021_SQL,
  MIGRATION_022_SQL,
  MIGRATION_023_SQL,
  MIGRATION_024_SQL,
  MIGRATION_025_SQL,
} from '../db/migrate.js';

/**
 * DB 診斷：給 MOD-12 批次寫卡失敗時排錯用
 * - GET /api/admin/db-diag/columns?table=X — 列出某表全欄位（公開讀）
 * - POST /api/admin/db-diag/rerun-axis-migrations — 重跑 021-025 並逐 migration
 *   回報結果（需 admin 認證；因 MIGRATION 使用 IF NOT EXISTS / ON CONFLICT，
 *   重跑安全）
 */
export const dbDiagRoutes: FastifyPluginAsync = async (app) => {
  // 公開讀：列欄位
  app.get<{ Querystring: { table?: string } }>('/api/admin/db-diag/columns', async (request, reply) => {
    const table = (request.query.table || '').trim();
    if (!table || !/^[a-z_]+$/i.test(table)) {
      return reply.status(400).send({ success: false, error: 'invalid table name' });
    }
    const r = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [table]
    );
    return reply.send({ success: true, table, columns: r.rows, count: r.rows.length });
  });

  // Admin 保護：重跑 MIGRATION_021-025
  app.post('/api/admin/db-diag/rerun-axis-migrations', { preHandler: requireAuth }, async (_request, reply) => {
    const migrations: { name: string; sql: string }[] = [
      { name: 'MIGRATION_021', sql: MIGRATION_021_SQL },
      { name: 'MIGRATION_022', sql: MIGRATION_022_SQL },
      { name: 'MIGRATION_023', sql: MIGRATION_023_SQL },
      { name: 'MIGRATION_024', sql: MIGRATION_024_SQL },
      { name: 'MIGRATION_025', sql: MIGRATION_025_SQL },
    ];
    const results: { name: string; ok: boolean; error?: string; detail?: string }[] = [];
    const client = await pool.connect();
    try {
      for (const m of migrations) {
        try {
          await client.query(m.sql);
          results.push({ name: m.name, ok: true });
        } catch (e: any) {
          results.push({
            name: m.name,
            ok: false,
            error: e.message || String(e),
            detail: e.detail || e.hint || undefined,
          });
        }
      }
    } finally {
      client.release();
    }

    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='card_definitions' ORDER BY ordinal_position`
    );

    return reply.send({
      success: true,
      results,
      card_definitions_columns: cols.rows.map((r: any) => r.column_name),
      has_is_talisman: cols.rows.some((r: any) => r.column_name === 'is_talisman'),
      has_primary_axis: cols.rows.some((r: any) => r.column_name === 'primary_axis_layer'),
      has_is_permanent: cols.rows.some((r: any) => r.column_name === 'is_permanent'),
    });
  });
};
