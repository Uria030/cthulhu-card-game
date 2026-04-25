import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import {
  MIGRATION_021_SQL,
  MIGRATION_022_SQL,
  MIGRATION_023_SQL,
  MIGRATION_024_SQL,
  MIGRATION_025_SQL,
  MIGRATION_026_SQL,
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
      { name: 'MIGRATION_026', sql: MIGRATION_026_SQL },
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
      has_starting_xp: cols.rows.some((r: any) => r.column_name === 'starting_xp'),
      has_enhancement_slots: cols.rows.some((r: any) => r.column_name === 'enhancement_slots'),
      has_card_source: cols.rows.some((r: any) => r.column_name === 'card_source'),
    });
  });

  // 卡片資料診斷:給定 code 或 id,回傳該卡完整 raw + effects[] 陣列
  // 用途:V 值計算對不上時,讓使用者一鍵把 DB 的真實資料攤開,不靠截圖排錯
  app.get<{ Querystring: { code?: string; id?: string; name_zh?: string } }>(
    '/api/admin/db-diag/card-inspect',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { code, id, name_zh } = request.query;
      if (!code && !id && !name_zh) {
        return reply.status(400).send({ success: false, error: '需提供 code / id / name_zh 至少一個' });
      }

      let cardRow: any;
      try {
        if (id) {
          const r = await pool.query('SELECT * FROM card_definitions WHERE id = $1 LIMIT 1', [id]);
          cardRow = r.rows[0];
        } else if (code) {
          const r = await pool.query('SELECT * FROM card_definitions WHERE code = $1 LIMIT 1', [code]);
          cardRow = r.rows[0];
        } else if (name_zh) {
          const r = await pool.query('SELECT * FROM card_definitions WHERE name_zh = $1 LIMIT 1', [name_zh]);
          cardRow = r.rows[0];
        }
      } catch (e: any) {
        return reply.status(500).send({ success: false, error: 'DB 查詢失敗:' + (e.message || e) });
      }

      if (!cardRow) {
        return reply.status(404).send({ success: false, error: '查無此卡' });
      }

      // 撈 effects 子表
      let effects: any[] = [];
      try {
        const er = await pool.query(
          `SELECT id, sort_order, trigger, condition, cost, target, effect_code, effect_params AS params, duration, scope, desc_zh, desc_en
             FROM card_effects WHERE card_definition_id = $1 ORDER BY sort_order, id`,
          [cardRow.id]
        );
        effects = er.rows;
      } catch (e: any) {
        return reply.status(500).send({ success: false, error: 'effects 查詢失敗:' + (e.message || e) });
      }

      return reply.send({
        success: true,
        card: cardRow,
        effects,
        effects_count: effects.length,
        hint: 'V 值診斷請在前端用 admin-system-diag 的「卡片 V 值診斷」按鈕,前端會跑引擎算逐條結果',
      });
    }
  );

  // 建立或重設使用者帳號(只有 owner / admin 可呼叫)
  // role: editor / viewer 看不到 MOD-12/MOD-14/AXIS/DIAG;admin / owner 看得到全部
  app.post<{ Body: { username: string; password: string; role?: string; display_name?: string; reset_password?: boolean } }>(
    '/api/admin/db-diag/seed-user',
    { preHandler: requireAuth },
    async (request, reply) => {
      const callerUser = (request as any).user;
      if (!callerUser || (callerUser.role !== 'owner' && callerUser.role !== 'admin')) {
        return reply.status(403).send({ success: false, error: '只有 owner / admin 能建立帳號' });
      }
      const { username, password, role = 'editor', display_name, reset_password } = request.body || ({} as any);
      if (!username || !password) {
        return reply.status(400).send({ success: false, error: 'username 與 password 必填' });
      }
      if (!/^[a-zA-Z0-9_-]{3,64}$/.test(username)) {
        return reply.status(400).send({ success: false, error: 'username 限英數底線連字號 3-64 字元' });
      }
      if (password.length < 6) {
        return reply.status(400).send({ success: false, error: '密碼至少 6 字元' });
      }
      if (!['owner', 'admin', 'editor', 'viewer'].includes(role)) {
        return reply.status(400).send({ success: false, error: 'role 必須是 owner/admin/editor/viewer 之一' });
      }
      try {
        const passwordHash = await bcrypt.hash(password, 12);
        const existing = await pool.query('SELECT id, role FROM admin_users WHERE username = $1 LIMIT 1', [username]);
        if (existing.rows.length > 0) {
          if (!reset_password) {
            return reply.status(409).send({
              success: false,
              error: '帳號 ' + username + ' 已存在(目前 role=' + existing.rows[0].role + ')。要覆寫密碼?帶 reset_password=true 重試',
            });
          }
          await pool.query(
            `UPDATE admin_users SET password_hash=$1, role=$2, display_name=COALESCE($3, display_name), updated_at=NOW() WHERE username=$4`,
            [passwordHash, role, display_name || null, username]
          );
          return reply.send({ success: true, action: 'reset', username, role });
        }
        await pool.query(
          `INSERT INTO admin_users (username, password_hash, display_name, role) VALUES ($1, $2, $3, $4)`,
          [username, passwordHash, display_name || username, role]
        );
        return reply.send({ success: true, action: 'created', username, role });
      } catch (e: any) {
        return reply.status(500).send({ success: false, error: e.message || String(e) });
      }
    }
  );
};
