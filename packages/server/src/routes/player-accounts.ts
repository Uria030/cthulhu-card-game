import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { requireAdminRole } from '../middleware/auth.js';
import {
  decryptPlayerPassword,
  encryptPlayerPassword,
  getOrCreatePlayerPasswordVaultKey,
  type PlayerPasswordVaultRecord,
} from '../services/player-password-vault.js';
import { CARD_LAB_MANIFEST, isCardLabCreator } from '../services/card-lab.js';

const PLAYER_JWT_SECRET = process.env.PLAYER_JWT_SECRET || 'player-fallback-secret-change-me';
const PLAYER_SESSION_HOURS = Number.parseInt(process.env.PLAYER_SESSION_HOURS || '24', 10);
const PASSWORD_MIN_LENGTH = 8;

const loginBuckets = new Map<string, { count: number; resetAt: number }>();

interface PlayerTokenPayload {
  playerId: string;
  username: string;
  kind: 'player';
}

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeUsername(value: unknown): string {
  return String(value ?? '').trim();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidUsername(value: string): boolean {
  return /^[A-Za-z0-9_.-]{3,64}$/.test(value);
}

function passwordError(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return `密碼至少需要 ${PASSWORD_MIN_LENGTH} 碼`;
  }
  return null;
}

function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return request.ip || 'unknown';
}

function checkRateLimit(key: string, maxCount: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = loginBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    loginBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= maxCount) return false;
  bucket.count += 1;
  return true;
}

async function requirePlayerAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(authHeader.substring(7), PLAYER_JWT_SECRET) as Partial<PlayerTokenPayload>;
    if (decoded.kind !== 'player' || !decoded.playerId) {
      return reply.status(401).send({ success: false, error: 'Invalid token' });
    }
    (request as any).player = decoded;
  } catch {
    return reply.status(401).send({ success: false, error: 'Invalid or expired token' });
  }
}

function signPlayerToken(player: { id: string; username: string }): string {
  return jwt.sign(
    { playerId: player.id, username: player.username, kind: 'player' },
    PLAYER_JWT_SECRET,
    { expiresIn: `${PLAYER_SESSION_HOURS}h` },
  );
}

function saveSelectSql(where: string): string {
  return `
    SELECT s.id, s.player_id, s.slot, s.template_id, s.campaign_id, s.status,
           s.campaign_progress, s.created_at, s.updated_at, s.ended_at,
           it.code AS investigator_code,
           it.mbti_code,
           it.faction_code,
           it.name_zh,
           it.name_en,
           it.title_zh,
           it.is_completed,
           c.code AS campaign_code,
           c.name_zh AS campaign_name
      FROM investigator_saves s
      JOIN investigator_templates it ON it.id = s.template_id
      LEFT JOIN campaigns c ON c.id = s.campaign_id
     ${where}
     ORDER BY s.slot, s.created_at DESC`;
}

function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function evaluateOutcomeRows(outcomes: Array<Record<string, any>>, flags: Record<string, unknown>): Record<string, any> | null {
  const sorted = [...outcomes].sort((a, b) => String(a.outcome_code).localeCompare(String(b.outcome_code)));
  for (const outcome of sorted) {
    const cond = objectRecord(outcome.condition_expression);
    if (String(cond.type ?? '') !== 'flag_check') continue;
    const actual = flags[String(cond.flag_code ?? '')] === true;
    const expected = cond.expected === true;
    if (actual === expected) return outcome;
  }
  return null;
}

function rewardNumber(rewards: Record<string, any>, keys: string[]): number {
  for (const key of keys) {
    const value = Number(rewards[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function emptyProgress(campaignId: string): Record<string, any> {
  return {
    campaignId,
    currentChapterNumber: 1,
    investigators: {},
    cohesion: 0,
    flags: {},
    teamSpirits: { investments: {}, effectSnapshots: [] },
  };
}

function settleProgressOnServer(opts: {
  previous: Record<string, any>;
  campaignId: string;
  chapterNumber: number;
  templateId: string;
  investigator: Record<string, any>;
  outcome: Record<string, any>;
  stageId: string;
}): { progress: Record<string, any>; status: 'active' | 'dead' } {
  const previous = Object.keys(opts.previous).length > 0 ? opts.previous : emptyProgress(opts.campaignId);
  const progress = {
    ...previous,
    campaignId: String(previous.campaignId ?? opts.campaignId),
    currentChapterNumber: Number(previous.currentChapterNumber ?? opts.chapterNumber),
    investigators: { ...objectRecord(previous.investigators) },
    flags: { ...objectRecord(previous.flags) },
    chapterResults: { ...objectRecord(previous.chapterResults) },
    cohesion: Math.max(0, Number(previous.cohesion ?? 0)),
  };

  const existingCarry = objectRecord(progress.investigators[opts.templateId]);
  const rewards = objectRecord(opts.outcome.rewards);
  const xp = rewardNumber(rewards, ['xp', 'experience', 'exp']);
  const talentPoints = rewardNumber(rewards, ['talentPoints', 'talent_points', 'talent_point']);
  const cohesionReward = rewardNumber(rewards, ['cohesion']);
  const permanentlyDead = opts.investigator.permanentlyDead === true;

  if (permanentlyDead) {
    delete progress.investigators[opts.templateId];
  } else {
    progress.investigators[opts.templateId] = {
      investigatorDefinitionId: opts.templateId,
      hp: Number(opts.investigator.hp ?? existingCarry.hp ?? opts.investigator.hpMax ?? 0),
      san: Number(opts.investigator.san ?? existingCarry.san ?? opts.investigator.sanMax ?? 0),
      hpMax: Number(opts.investigator.hpMax ?? existingCarry.hpMax ?? 0),
      sanMax: Number(opts.investigator.sanMax ?? existingCarry.sanMax ?? 0),
      traumas: Array.isArray(opts.investigator.traumas) ? opts.investigator.traumas : (Array.isArray(existingCarry.traumas) ? existingCarry.traumas : []),
      deck: Array.isArray(existingCarry.deck) ? existingCarry.deck : [],
      combatStyle: String(opts.investigator.combatStyle ?? existingCarry.combatStyle ?? ''),
      specializations: Array.isArray(opts.investigator.specializations) ? opts.investigator.specializations : (Array.isArray(existingCarry.specializations) ? existingCarry.specializations : []),
      xp: Math.max(0, Number(existingCarry.xp ?? 0) + xp),
      talentPoints: Math.max(0, Number(existingCarry.talentPoints ?? 0) + talentPoints),
      talents: objectRecord(existingCarry.talents),
      permanentlyDead: false,
    };
  }

  for (const set of Array.isArray(opts.outcome.flag_sets) ? opts.outcome.flag_sets : []) {
    if (set?.flag_code) progress.flags[String(set.flag_code)] = set.value;
  }

  progress.cohesion = Math.max(0, Number(progress.cohesion ?? 0) + cohesionReward);
  progress.chapterResults[String(opts.chapterNumber)] = {
    chapterNumber: opts.chapterNumber,
    outcomeCode: String(opts.outcome.outcome_code ?? ''),
    nextChapterVersion: opts.outcome.next_chapter_version ?? null,
    stageId: opts.stageId,
    resolvedAt: new Date().toISOString(),
  };
  progress.currentChapterNumber = Number(progress.currentChapterNumber ?? opts.chapterNumber) + 1;
  progress.cohesion += 1;
  return { progress, status: permanentlyDead ? 'dead' : 'active' };
}

async function fetchPlayerSaves(playerId: string) {
  const res = await pool.query(
    saveSelectSql('WHERE s.player_id = $1'),
    [playerId],
  );
  return res.rows;
}

async function fetchPlayerProfile(
  playerId: string,
  options: { includeDisabled?: boolean; includePasswordVaultStatus?: boolean } = {},
) {
  const vaultStatusSql = options.includePasswordVaultStatus
    ? ', EXISTS (SELECT 1 FROM player_password_vault v WHERE v.player_id = players.id) AS has_recoverable_password'
    : '';
  const playerRes = await pool.query(
    `SELECT id, email, username, save_slots_max, dead_count, retired_count,
            is_disabled, created_at, last_login_at
            ${vaultStatusSql}
       FROM players
      WHERE id = $1`,
    [playerId],
  );
  if (playerRes.rows.length === 0 || (playerRes.rows[0].is_disabled && !options.includeDisabled)) return null;
  const saves = await fetchPlayerSaves(playerId);
  return { player: playerRes.rows[0], saves };
}

async function auditAccountAction(
  request: FastifyRequest,
  targetPlayerId: string | null,
  action: string,
  detail: Record<string, unknown> = {},
  client?: PoolClient,
) {
  const adminUserId = (request as any).user?.userId ?? null;
  await (client ?? pool).query(
    `INSERT INTO account_audit_logs (admin_user_id, target_player_id, action, detail)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [adminUserId, targetPlayerId, action, JSON.stringify(detail)],
  );
}

export const playerAccountRoutes: FastifyPluginAsync = async (app) => {
  // Player login. Test phase accounts are created by MOD-15; self-register is E15b.
  app.post<{ Body: { login?: string; username?: string; email?: string; password?: string } }>(
    '/api/player/login',
    async (request, reply) => {
      const login = normalizeEmail(request.body?.login ?? request.body?.email ?? request.body?.username);
      const password = request.body?.password;
      const bucketKey = `${clientIp(request)}:${login}`;
      if (!checkRateLimit(bucketKey, 10, 15 * 60 * 1000)) {
        return reply.status(429).send({ success: false, error: '嘗試次數過多,請稍後再試' });
      }
      if (!login || !password) {
        return reply.status(400).send({ success: false, error: '帳號與密碼為必填' });
      }

      try {
        const result = await pool.query(
          `SELECT *
             FROM players
            WHERE (lower(email) = $1 OR lower(username) = $1)
              AND is_disabled = FALSE
            LIMIT 1`,
          [login],
        );
        if (result.rows.length === 0) {
          return reply.status(401).send({ success: false, error: '帳號或密碼錯誤' });
        }
        const player = result.rows[0];
        const ok = await bcrypt.compare(password, player.password_hash);
        if (!ok) return reply.status(401).send({ success: false, error: '帳號或密碼錯誤' });

        await pool.query('UPDATE players SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [player.id]);
        const token = signPlayerToken(player);
        const profile = await fetchPlayerProfile(player.id);
        return reply.send({
          success: true,
          data: { token, expiresIn: PLAYER_SESSION_HOURS * 3600, ...profile },
        });
      } catch (error) {
        request.log.error(error, 'player login failed');
        return reply.status(500).send({ success: false, error: '登入失敗' });
      }
    },
  );

  app.post('/api/player/logout', async (_request, reply) => {
    return reply.send({ success: true });
  });

  app.get('/api/player/me', { preHandler: requirePlayerAuth }, async (request, reply) => {
    const profile = await fetchPlayerProfile((request as any).player.playerId);
    if (!profile) return reply.status(401).send({ success: false, error: '帳號不存在或已停用' });
    return reply.send({ success: true, data: profile });
  });

  app.get('/api/player/card-lab', { preHandler: requirePlayerAuth }, async (request, reply) => {
    const username = (request as any).player?.username;
    if (!isCardLabCreator(username)) {
      return reply.status(403).send({ success: false, error: '此帳號沒有實驗場權限' });
    }
    try {
      const stageRes = await pool.query(
        `SELECT s.id
           FROM stages s
           JOIN chapters ch ON ch.id = s.chapter_id
           JOIN campaigns c ON c.id = ch.campaign_id
          WHERE s.stage_type = 'main'
            AND COALESCE(s.is_hidden, FALSE) = FALSE
          ORDER BY c.created_at, ch.chapter_number, s.created_at
          LIMIT 1`,
      );
      const baseStageId = String(stageRes.rows[0]?.id ?? '');
      if (!baseStageId) {
        return reply.status(503).send({ success: false, error: '目前沒有可供實驗場載入牌組的基礎關卡' });
      }
      return reply.send({
        success: true,
        data: { ...CARD_LAB_MANIFEST, baseStageId },
      });
    } catch (error) {
      request.log.error(error, 'card lab manifest failed');
      return reply.status(500).send({ success: false, error: '實驗場載入失敗' });
    }
  });

  app.get('/api/player/saves', { preHandler: requirePlayerAuth }, async (request, reply) => {
    try {
      const playerId = (request as any).player.playerId;
      return reply.send({ success: true, data: await fetchPlayerSaves(playerId) });
    } catch (error) {
      request.log.error(error, 'list player saves failed');
      return reply.status(500).send({ success: false, error: '讀取存檔失敗' });
    }
  });

  app.post<{
    Body: { slot?: number; template_id?: string; campaign_id?: string | null; campaign_progress?: unknown };
  }>('/api/player/saves', { preHandler: requirePlayerAuth }, async (request, reply) => {
    const playerId = (request as any).player.playerId;
    const slot = Number(request.body?.slot);
    const templateId = String(request.body?.template_id ?? '').trim();
    const campaignId = request.body?.campaign_id ? String(request.body.campaign_id) : null;
    const progress = request.body?.campaign_progress && typeof request.body.campaign_progress === 'object'
      ? request.body.campaign_progress
      : {};
    if (!Number.isInteger(slot) || slot < 1) {
      return reply.status(400).send({ success: false, error: 'slot 必須為正整數' });
    }
    if (!templateId) return reply.status(400).send({ success: false, error: 'template_id 為必填' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const playerRes = await client.query(
        'SELECT save_slots_max FROM players WHERE id = $1 AND is_disabled = FALSE FOR UPDATE',
        [playerId],
      );
      if (playerRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(401).send({ success: false, error: '帳號不存在或已停用' });
      }
      if (slot > Number(playerRes.rows[0].save_slots_max)) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ success: false, error: 'slot 超過帳號存檔格上限' });
      }
      const templateRes = await client.query('SELECT id FROM investigator_templates WHERE id = $1', [templateId]);
      if (templateRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ success: false, error: '調查員模板不存在' });
      }
      const activeRes = await client.query(
        `SELECT id FROM investigator_saves WHERE player_id = $1 AND slot = $2 AND status = 'active'`,
        [playerId, slot],
      );
      if (activeRes.rows.length > 0) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ success: false, error: '此存檔格已有 active 調查員' });
      }
      const created = await client.query(
        `INSERT INTO investigator_saves
           (player_id, slot, template_id, campaign_id, campaign_progress)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id`,
        [playerId, slot, templateId, campaignId, JSON.stringify(progress)],
      );
      await client.query('COMMIT');
      const saveRes = await pool.query(saveSelectSql('WHERE s.id = $1'), [created.rows[0].id]);
      return reply.status(201).send({ success: true, data: saveRes.rows[0] });
    } catch (error: any) {
      await client.query('ROLLBACK');
      request.log.error(error, 'create player save failed');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: '此存檔格已有 active 調查員' });
      return reply.status(500).send({ success: false, error: '建立存檔失敗' });
    } finally {
      client.release();
    }
  });

  app.put<{
    Params: { id: string };
    Body: { campaign_id?: string | null; campaign_progress?: unknown };
  }>('/api/player/saves/:id/progress', { preHandler: requirePlayerAuth }, async (request, reply) => {
    const playerId = (request as any).player.playerId;
    const progress = request.body?.campaign_progress;
    if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
      return reply.status(400).send({ success: false, error: 'campaign_progress 必須為物件' });
    }
    const campaignId = request.body?.campaign_id ? String(request.body.campaign_id) : null;
    try {
      const result = await pool.query(
        `UPDATE investigator_saves
            SET campaign_id = COALESCE($1, campaign_id),
                campaign_progress = $2::jsonb,
                updated_at = NOW()
          WHERE id = $3 AND player_id = $4 AND status = 'active'
          RETURNING id`,
        [campaignId, JSON.stringify(progress), request.params.id, playerId],
      );
      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'active 存檔不存在' });
      }
      const saveRes = await pool.query(saveSelectSql('WHERE s.id = $1'), [request.params.id]);
      return reply.send({ success: true, data: saveRes.rows[0] });
    } catch (error) {
      request.log.error(error, 'update player save progress failed');
      return reply.status(500).send({ success: false, error: '更新存檔失敗' });
    }
  });

  app.post<{ Params: { id: string } }>(
    '/api/player/saves/:id/retire',
    { preHandler: requirePlayerAuth },
    async (request, reply) => {
      const playerId = (request as any).player.playerId;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query(
          `UPDATE investigator_saves
              SET status = 'retired', ended_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND player_id = $2 AND status = 'active'
            RETURNING id`,
          [request.params.id, playerId],
        );
        if (updated.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ success: false, error: 'active 存檔不存在' });
        }
        await client.query(
          `UPDATE players
              SET retired_count = retired_count + 1, updated_at = NOW()
            WHERE id = $1`,
          [playerId],
        );
        await client.query('COMMIT');
        return reply.send({ success: true, data: await fetchPlayerProfile(playerId) });
      } catch (error) {
        await client.query('ROLLBACK');
        request.log.error(error, 'retire save failed');
        return reply.status(500).send({ success: false, error: '退休存檔失敗' });
      } finally {
        client.release();
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: { stage_id?: string; flags?: unknown; investigator?: unknown };
  }>('/api/player/saves/:id/settle-scenario', { preHandler: requirePlayerAuth }, async (request, reply) => {
    const playerId = (request as any).player.playerId;
    const stageId = String(request.body?.stage_id ?? '').trim();
    const flags = objectRecord(request.body?.flags);
    const investigator = objectRecord(request.body?.investigator);
    if (!stageId) return reply.status(400).send({ success: false, error: 'stage_id 為必填' });
    if (!investigator.investigatorDefinitionId) {
      return reply.status(400).send({ success: false, error: 'investigator 狀態缺少 investigatorDefinitionId' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const saveRes = await client.query(
        `SELECT *
           FROM investigator_saves
          WHERE id = $1 AND player_id = $2 AND status = 'active'
          FOR UPDATE`,
        [request.params.id, playerId],
      );
      if (saveRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ success: false, error: 'active 存檔不存在' });
      }
      const save = saveRes.rows[0];
      if (String(save.template_id) !== String(investigator.investigatorDefinitionId)) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ success: false, error: '調查員狀態與存檔 template 不一致' });
      }

      const stageRes = await client.query(
        `SELECT s.id, ch.id AS chapter_id, ch.chapter_number, ch.campaign_id
           FROM stages s
           JOIN chapters ch ON ch.id = s.chapter_id
          WHERE s.id = $1`,
        [stageId],
      );
      if (stageRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ success: false, error: '關卡不存在' });
      }
      const stage = stageRes.rows[0];
      const outcomeRes = await client.query(
        `SELECT *
           FROM chapter_outcomes
          WHERE chapter_id = $1
          ORDER BY outcome_code`,
        [stage.chapter_id],
      );
      const outcome = evaluateOutcomeRows(outcomeRes.rows, flags);
      if (!outcome) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ success: false, error: '無法依旗標判定章節結局' });
      }

      const settled = settleProgressOnServer({
        previous: objectRecord(save.campaign_progress),
        campaignId: String(stage.campaign_id),
        chapterNumber: Number(stage.chapter_number ?? 1),
        templateId: String(save.template_id),
        investigator,
        outcome,
        stageId,
      });

      await client.query(
        `UPDATE investigator_saves
            SET campaign_id = $1,
                campaign_progress = $2::jsonb,
                status = $3,
                ended_at = CASE WHEN $3 = 'dead' THEN NOW() ELSE ended_at END,
                updated_at = NOW()
          WHERE id = $4`,
        [stage.campaign_id, JSON.stringify(settled.progress), settled.status, save.id],
      );
      if (settled.status === 'dead') {
        await client.query(
          `UPDATE players SET dead_count = dead_count + 1, updated_at = NOW() WHERE id = $1`,
          [playerId],
        );
      }
      await client.query('COMMIT');
      const saveRow = await pool.query(saveSelectSql('WHERE s.id = $1'), [save.id]);
      return reply.send({ success: true, data: saveRow.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      request.log.error(error, 'server scenario settlement failed');
      return reply.status(500).send({ success: false, error: '關卡結算入庫失敗' });
    } finally {
      client.release();
    }
  });

  app.post<{
    Params: { id: string };
    Body: { campaign_progress?: unknown };
  }>('/api/player/saves/:id/mark-dead', { preHandler: requirePlayerAuth }, async (request, reply) => {
    const playerId = (request as any).player.playerId;
    const progress = request.body?.campaign_progress && typeof request.body.campaign_progress === 'object'
      ? request.body.campaign_progress
      : null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE investigator_saves
            SET status = 'dead',
                campaign_progress = COALESCE($1::jsonb, campaign_progress),
                ended_at = NOW(),
                updated_at = NOW()
          WHERE id = $2 AND player_id = $3 AND status = 'active'
          RETURNING id`,
        [progress ? JSON.stringify(progress) : null, request.params.id, playerId],
      );
      if (updated.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ success: false, error: 'active 存檔不存在' });
      }
      await client.query(
        `UPDATE players SET dead_count = dead_count + 1, updated_at = NOW() WHERE id = $1`,
        [playerId],
      );
      await client.query('COMMIT');
      return reply.send({ success: true, data: await fetchPlayerProfile(playerId) });
    } catch (error) {
      await client.query('ROLLBACK');
      request.log.error(error, 'mark save dead failed');
      return reply.status(500).send({ success: false, error: '死亡結案失敗' });
    } finally {
      client.release();
    }
  });

  // E15b placeholders. They intentionally do not create public accounts during the test phase.
  app.post('/api/player/register', async (_request, reply) => {
    return reply.status(403).send({ success: false, error: '測試期帳號由 MOD-15 建立;自助註冊保留至 E15b' });
  });
  app.post('/api/player/forgot-password', async (_request, reply) => {
    return reply.send({ success: true, message: '若帳號存在,管理員會協助重設密碼' });
  });
  app.post('/api/player/reset-password', async (_request, reply) => {
    return reply.status(403).send({ success: false, error: '測試期請由 MOD-15 管理員重設密碼' });
  });

  // MOD-15 admin endpoints.
  app.get<{
    Querystring: { search?: string; limit?: string; offset?: string };
  }>('/api/admin/players', { preHandler: requireAdminRole }, async (request, reply) => {
    const search = String(request.query.search ?? '').trim();
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(request.query.limit ?? '50'), 10) || 50));
    const offset = Math.max(0, Number.parseInt(String(request.query.offset ?? '0'), 10) || 0);
    const vals: unknown[] = [];
    let where = '';
    if (search) {
      vals.push(`%${search.toLowerCase()}%`);
      where = `WHERE lower(username) LIKE $1 OR lower(email) LIKE $1`;
    }
    vals.push(limit, offset);
    const limitIdx = vals.length - 1;
    const offsetIdx = vals.length;
    try {
      const result = await pool.query(
        `SELECT p.id, p.email, p.username, p.save_slots_max, p.dead_count, p.retired_count,
                p.is_disabled, p.created_at, p.last_login_at,
                EXISTS (SELECT 1 FROM player_password_vault v WHERE v.player_id = p.id) AS has_recoverable_password,
                COUNT(s.id) FILTER (WHERE s.status = 'active')::int AS active_save_count
           FROM players p
           LEFT JOIN investigator_saves s ON s.player_id = p.id
          ${where}
          GROUP BY p.id
          ORDER BY p.created_at DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        vals,
      );
      return reply.send({ success: true, data: result.rows });
    } catch (error) {
      request.log.error(error, 'admin list players failed');
      return reply.status(500).send({ success: false, error: '讀取帳號列表失敗' });
    }
  });

  app.post<{
    Body: { email?: string; username?: string; password?: string; save_slots_max?: number };
  }>('/api/admin/players', { preHandler: requireAdminRole }, async (request, reply) => {
    const email = normalizeEmail(request.body?.email);
    const username = normalizeUsername(request.body?.username);
    const password = request.body?.password;
    const saveSlotsMax = Number(request.body?.save_slots_max ?? 2);
    if (!isValidEmail(email)) return reply.status(400).send({ success: false, error: 'email 格式錯誤' });
    if (!isValidUsername(username)) return reply.status(400).send({ success: false, error: 'username 格式錯誤' });
    const pErr = passwordError(password);
    if (pErr) return reply.status(400).send({ success: false, error: pErr });
    if (!Number.isInteger(saveSlotsMax) || saveSlotsMax < 1 || saveSlotsMax > 8) {
      return reply.status(400).send({ success: false, error: 'save_slots_max 必須為 1-8' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const vaultKey = await getOrCreatePlayerPasswordVaultKey(client);
      const hash = await bcrypt.hash(password!, 12);
      const result = await client.query(
        `INSERT INTO players (email, username, password_hash, save_slots_max)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, username, save_slots_max, dead_count, retired_count,
                   is_disabled, created_at, last_login_at`,
        [email, username, hash, saveSlotsMax],
      );
      const vault = encryptPlayerPassword(result.rows[0].id, password!, vaultKey);
      await client.query(
        `INSERT INTO player_password_vault (player_id, ciphertext, iv, auth_tag, key_version)
         VALUES ($1, $2, $3, $4, $5)`,
        [result.rows[0].id, vault.ciphertext, vault.iv, vault.authTag, vault.keyVersion],
      );
      await auditAccountAction(
        request,
        result.rows[0].id,
        'player_create',
        { username, email, save_slots_max: saveSlotsMax, password_vaulted: true },
        client,
      );
      await client.query('COMMIT');
      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      await client.query('ROLLBACK');
      request.log.error(error, 'admin create player failed');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: 'email 或 username 已存在' });
      return reply.status(500).send({ success: false, error: '建立帳號失敗' });
    } finally {
      client.release();
    }
  });

  app.patch<{
    Params: { id: string };
    Body: { email?: string; username?: string; password?: string; save_slots_max?: number; is_disabled?: boolean };
  }>('/api/admin/players/:id', { preHandler: requireAdminRole }, async (request, reply) => {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let pi = 1;
    const body = request.body ?? {};
    let passwordVault: PlayerPasswordVaultRecord | null = null;
    if (body.email !== undefined) {
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) return reply.status(400).send({ success: false, error: 'email 格式錯誤' });
      sets.push(`email = $${pi++}`);
      vals.push(email);
    }
    if (body.username !== undefined) {
      const username = normalizeUsername(body.username);
      if (!isValidUsername(username)) return reply.status(400).send({ success: false, error: 'username 格式錯誤' });
      sets.push(`username = $${pi++}`);
      vals.push(username);
    }
    if (body.password !== undefined) {
      const pErr = passwordError(body.password);
      if (pErr) return reply.status(400).send({ success: false, error: pErr });
      sets.push(`password_hash = $${pi++}`);
      vals.push(await bcrypt.hash(body.password, 12));
    }
    if (body.save_slots_max !== undefined) {
      const n = Number(body.save_slots_max);
      if (!Number.isInteger(n) || n < 1 || n > 8) {
        return reply.status(400).send({ success: false, error: 'save_slots_max 必須為 1-8' });
      }
      sets.push(`save_slots_max = $${pi++}`);
      vals.push(n);
    }
    if (body.is_disabled !== undefined) {
      sets.push(`is_disabled = $${pi++}`);
      vals.push(body.is_disabled === true);
    }
    if (sets.length === 0) return reply.status(400).send({ success: false, error: '沒有可更新欄位' });
    sets.push('updated_at = NOW()');
    vals.push(request.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (body.password !== undefined) {
        const vaultKey = await getOrCreatePlayerPasswordVaultKey(client);
        passwordVault = encryptPlayerPassword(request.params.id, body.password, vaultKey);
      }
      const result = await client.query(
        `UPDATE players SET ${sets.join(', ')}
          WHERE id = $${pi}
          RETURNING id, email, username, save_slots_max, dead_count, retired_count,
                    is_disabled, created_at, last_login_at`,
        vals,
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ success: false, error: '帳號不存在' });
      }
      if (passwordVault) {
        await client.query(
          `INSERT INTO player_password_vault (player_id, ciphertext, iv, auth_tag, key_version)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (player_id) DO UPDATE
             SET ciphertext = EXCLUDED.ciphertext,
                 iv = EXCLUDED.iv,
                 auth_tag = EXCLUDED.auth_tag,
                 key_version = EXCLUDED.key_version,
                 updated_at = NOW()`,
          [request.params.id, passwordVault.ciphertext, passwordVault.iv, passwordVault.authTag, passwordVault.keyVersion],
        );
      }
      await auditAccountAction(request, request.params.id, 'player_update', {
        fields: Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined && k !== 'password'),
        password_changed: body.password !== undefined,
        password_vaulted: passwordVault !== null,
      }, client);
      await client.query('COMMIT');
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      await client.query('ROLLBACK');
      request.log.error(error, 'admin update player failed');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: 'email 或 username 已存在' });
      return reply.status(500).send({ success: false, error: '更新帳號失敗' });
    } finally {
      client.release();
    }
  });

  app.post<{ Params: { id: string } }>(
    '/api/admin/players/:id/password/reveal',
    { preHandler: requireAdminRole },
    async (request, reply) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const vaultKey = await getOrCreatePlayerPasswordVaultKey(client);
        const result = await client.query(
          `SELECT p.id, v.ciphertext, v.iv, v.auth_tag, v.key_version, v.updated_at
             FROM players p
             LEFT JOIN player_password_vault v ON v.player_id = p.id
            WHERE p.id = $1`,
          [request.params.id],
        );
        if (result.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ success: false, error: '帳號不存在' });
        }
        const row = result.rows[0];
        if (!row.ciphertext) {
          await client.query('ROLLBACK');
          return reply.status(409).send({ success: false, error: '舊密碼未納入保管,請先設定新密碼' });
        }
        const password = decryptPlayerPassword(request.params.id, {
          ciphertext: row.ciphertext,
          iv: row.iv,
          authTag: row.auth_tag,
          keyVersion: Number(row.key_version),
        }, vaultKey);
        await auditAccountAction(request, request.params.id, 'password_reveal', {}, client);
        await client.query('COMMIT');
        return reply
          .header('Cache-Control', 'no-store, max-age=0')
          .header('Pragma', 'no-cache')
          .send({ success: true, data: { password, updated_at: row.updated_at } });
      } catch (error) {
        await client.query('ROLLBACK');
        request.log.error(error, 'admin reveal player password failed');
        return reply.status(500).send({ success: false, error: '目前密碼解密失敗' });
      } finally {
        client.release();
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/admin/players/:id/saves',
    { preHandler: requireAdminRole },
    async (request, reply) => {
      try {
        const player = await fetchPlayerProfile(request.params.id, {
          includeDisabled: true,
          includePasswordVaultStatus: true,
        });
        if (!player) return reply.status(404).send({ success: false, error: '帳號不存在或已停用' });
        return reply.send({ success: true, data: player });
      } catch (error) {
        request.log.error(error, 'admin read player saves failed');
        return reply.status(500).send({ success: false, error: '讀取存檔失敗' });
      }
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { slot?: number; save_slots_max?: never; status?: string; campaign_progress?: unknown; campaign_id?: string | null };
  }>('/api/admin/player-saves/:id', { preHandler: requireAdminRole }, async (request, reply) => {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let pi = 1;
    const body = request.body ?? {};
    if (body.slot !== undefined) {
      const slot = Number(body.slot);
      if (!Number.isInteger(slot) || slot < 1) return reply.status(400).send({ success: false, error: 'slot 必須為正整數' });
      sets.push(`slot = $${pi++}`);
      vals.push(slot);
    }
    if (body.status !== undefined) {
      if (!['active', 'dead', 'retired'].includes(String(body.status))) {
        return reply.status(400).send({ success: false, error: 'status 不合法' });
      }
      sets.push(`status = $${pi++}`);
      vals.push(String(body.status));
      if (body.status === 'dead' || body.status === 'retired') sets.push('ended_at = COALESCE(ended_at, NOW())');
      if (body.status === 'active') sets.push('ended_at = NULL');
    }
    if (body.campaign_id !== undefined) {
      sets.push(`campaign_id = $${pi++}`);
      vals.push(body.campaign_id ? String(body.campaign_id) : null);
    }
    if (body.campaign_progress !== undefined) {
      if (!body.campaign_progress || typeof body.campaign_progress !== 'object' || Array.isArray(body.campaign_progress)) {
        return reply.status(400).send({ success: false, error: 'campaign_progress 必須為物件' });
      }
      sets.push(`campaign_progress = $${pi++}::jsonb`);
      vals.push(JSON.stringify(body.campaign_progress));
    }
    if (sets.length === 0) return reply.status(400).send({ success: false, error: '沒有可更新欄位' });
    sets.push('updated_at = NOW()');
    vals.push(request.params.id);
    try {
      const result = await pool.query(
        `UPDATE investigator_saves
            SET ${sets.join(', ')}
          WHERE id = $${pi}
          RETURNING player_id`,
        vals,
      );
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: '存檔不存在' });
      await auditAccountAction(request, result.rows[0].player_id, 'save_update', { save_id: request.params.id });
      const saveRes = await pool.query(saveSelectSql('WHERE s.id = $1'), [request.params.id]);
      return reply.send({ success: true, data: saveRes.rows[0] });
    } catch (error: any) {
      request.log.error(error, 'admin update save failed');
      if (error.code === '23505') return reply.status(409).send({ success: false, error: '該 slot 已有 active 存檔' });
      return reply.status(500).send({ success: false, error: '更新存檔失敗' });
    }
  });

  app.get<{
    Querystring: { playerId?: string };
  }>('/api/admin/account-audit-logs', { preHandler: requireAdminRole }, async (request, reply) => {
    const playerId = request.query.playerId ? String(request.query.playerId) : null;
    const vals = playerId ? [playerId] : [];
    try {
      const result = await pool.query(
        `SELECT l.*, au.username AS admin_username
           FROM account_audit_logs l
           LEFT JOIN admin_users au ON au.id = l.admin_user_id
          ${playerId ? 'WHERE l.target_player_id = $1' : ''}
          ORDER BY l.created_at DESC
          LIMIT 100`,
        vals,
      );
      return reply.send({ success: true, data: result.rows });
    } catch (error) {
      request.log.error(error, 'admin account audit failed');
      return reply.status(500).send({ success: false, error: '讀取稽核紀錄失敗' });
    }
  });
};

export const playerAccountTestHelpers = {
  normalizeEmail,
  normalizeUsername,
  isValidEmail,
  isValidUsername,
  passwordError,
  settleProgressOnServer,
};
