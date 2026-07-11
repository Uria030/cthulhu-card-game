import Fastify from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { playerAccountTestHelpers } from './player-accounts.js';
import { playerAccountRoutes } from './player-accounts.js';
import { MIGRATION_042_SQL, MIGRATION_043_SQL, MIGRATION_044_SQL } from '../db/migrate.js';
import { pool } from '../db/pool.js';
import {
  decryptPlayerPassword,
  encryptPlayerPassword,
  PlayerPasswordVaultConfigurationError,
} from '../services/player-password-vault.js';
import { bootstrapCreatorPasswords } from '../services/creator-password-bootstrap.js';
import { CARD_LAB_MANIFEST, isCardLabCreator } from '../services/card-lab.js';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

const h = playerAccountTestHelpers;

test('normalizeEmail: trims and lowercases before unique lookup', () => {
  assertEq(h.normalizeEmail('  Uria@Test.COM '), 'uria@test.com');
});

test('username policy: permits test account names but rejects spaces', () => {
  assertEq(h.isValidUsername('playtest_01'), true);
  assertEq(h.isValidUsername('play test'), false);
});

test('email and password policy match E15a test-phase contract', () => {
  assertEq(h.isValidEmail('player@example.com'), true);
  assertEq(h.isValidEmail('player.example.com'), false);
  assertEq(h.passwordError('1234567') !== null, true, 'minimum length enforced');
  assertEq(h.passwordError('12345678'), null);
});

test('card lab whitelist only admits creator01 and creator02', () => {
  assertEq(isCardLabCreator('creator01'), true);
  assertEq(isCardLabCreator('Creator02'), true);
  assertEq(isCardLabCreator('creator03'), false);
  assertEq(isCardLabCreator('admin'), false);
  assertEq(CARD_LAB_MANIFEST.locations.length, 2);
  assertEq(CARD_LAB_MANIFEST.enemy.damage_physical, 0);
  assertEq(CARD_LAB_MANIFEST.enemy.damage_horror, 0);
  assertEq(CARD_LAB_MANIFEST.enemy.fear_value, 0);
});

test('card lab endpoint rejects other players and returns manifest to creators', async () => {
  const originalQuery = pool.query;
  (pool as any).query = async (sql: string) => {
    if (sql.includes('FROM stages s')) return { rows: [{ id: 'stage-base-1' }] };
    throw new Error(`Unexpected SQL in card lab route test: ${sql}`);
  };
  const app = Fastify({ logger: false });
  await app.register(playerAccountRoutes);
  const secret = process.env.PLAYER_JWT_SECRET || 'player-fallback-secret-change-me';
  const tokenFor = (username: string) => jwt.sign({ playerId: `${username}-id`, username, kind: 'player' }, secret);
  try {
    const denied = await app.inject({
      method: 'GET',
      url: '/api/player/card-lab',
      headers: { authorization: `Bearer ${tokenFor('ordinary-player')}` },
    });
    assertEq(denied.statusCode, 403);

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/player/card-lab',
      headers: { authorization: `Bearer ${tokenFor('creator01')}` },
    });
    assertEq(allowed.statusCode, 200);
    assertEq(allowed.json().data.baseStageId, 'stage-base-1');
    assertEq(allowed.json().data.locations.length, 2);
    assertEq(allowed.json().data.enemy.name_zh, '訓練木人');
  } finally {
    await app.close();
    (pool as any).query = originalQuery;
  }
});

test('settleProgressOnServer: awards DB outcome rewards and advances chapter', () => {
  const result = h.settleProgressOnServer({
    previous: {
      campaignId: 'campaign-1',
      currentChapterNumber: 1,
      investigators: {
        'template-1': {
          deck: ['card-1'],
          xp: 1,
          talentPoints: 0,
          hpMax: 9,
          sanMax: 7,
          talents: {},
        },
      },
      cohesion: 0,
      flags: {},
    },
    campaignId: 'campaign-1',
    chapterNumber: 1,
    templateId: 'template-1',
    investigator: {
      investigatorDefinitionId: 'template-1',
      hp: 4,
      san: 5,
      hpMax: 9,
      sanMax: 7,
      combatStyle: 'sidearm',
      specializations: [],
      traumas: [],
    },
    outcome: {
      outcome_code: 'A',
      next_chapter_version: 'ch2_a',
      rewards: { xp: 2, talent_point: 1, cohesion: 1 },
      flag_sets: [{ flag_code: 'outcome.victory', value: true }],
    },
    stageId: 'stage-1',
  });
  const carry = result.progress.investigators['template-1'];
  assertEq(result.status, 'active', 'save remains active');
  assertEq(carry.xp, 3, 'xp added from DB reward');
  assertEq(carry.talentPoints, 1, 'talent point added from DB reward');
  assertEq(result.progress.flags['outcome.victory'], true, 'flag_sets applied');
  assertEq(result.progress.currentChapterNumber, 2, 'long rest advances chapter');
  assertEq(result.progress.cohesion, 2, 'reward cohesion + long rest cohesion');
});

test('MIGRATION_042 mirrors creator01/creator02 admin users into MOD-15 players', () => {
  assertEq(MIGRATION_042_SQL.includes('creator01'), true);
  assertEq(MIGRATION_042_SQL.includes('creator02'), true);
  assertEq(MIGRATION_042_SQL.includes('FROM admin_users'), true);
  assertEq(MIGRATION_042_SQL.includes('INSERT INTO players'), true);
  assertEq(MIGRATION_042_SQL.includes("'@ug.local'"), true);
  assertEq(MIGRATION_042_SQL.includes('legacy_creator_import'), true);
});

test('MIGRATION_043 stores encrypted password material outside players', () => {
  assertEq(MIGRATION_043_SQL.includes('CREATE TABLE IF NOT EXISTS player_password_vault'), true);
  assertEq(MIGRATION_043_SQL.includes('ciphertext'), true);
  assertEq(MIGRATION_043_SQL.includes('auth_tag'), true);
  assertEq(MIGRATION_043_SQL.includes('password_plaintext'), false);
});

test('MIGRATION_044 persists a server-managed vault key', () => {
  assertEq(MIGRATION_044_SQL.includes('CREATE TABLE IF NOT EXISTS server_secrets'), true);
  assertEq(MIGRATION_044_SQL.includes('secret_name'), true);
  assertEq(MIGRATION_044_SQL.includes('secret_value'), true);
});

test('password vault round-trips independent creator passwords', () => {
  const key = Buffer.alloc(32, 17).toString('base64');
  const creator01 = encryptPlayerPassword('creator-01-id', 'CreatorAlpha1207', key);
  const creator02 = encryptPlayerPassword('creator-02-id', 'CreatorBeta4816', key);
  assertEq(decryptPlayerPassword('creator-01-id', creator01, key), 'CreatorAlpha1207');
  assertEq(decryptPlayerPassword('creator-02-id', creator02, key), 'CreatorBeta4816');
  assertEq(creator01.ciphertext === creator02.ciphertext, false, 'vault entries use independent ciphertext');
});

test('password vault rejects an invalid key and wrong player binding', () => {
  let invalidKeyRejected = false;
  try {
    encryptPlayerPassword('player-1', 'Password1234', 'not-a-32-byte-key');
  } catch (error) {
    invalidKeyRejected = error instanceof PlayerPasswordVaultConfigurationError;
  }
  assertEq(invalidKeyRejected, true);

  const key = Buffer.alloc(32, 23).toString('base64');
  const record = encryptPlayerPassword('player-1', 'Password1234', key);
  let wrongPlayerRejected = false;
  try {
    decryptPlayerPassword('player-2', record, key);
  } catch {
    wrongPlayerRejected = true;
  }
  assertEq(wrongPlayerRejected, true);
});

test('MOD-15 resets and reveals two independent creator passwords', async () => {
  const originalConnect = pool.connect;
  const serverVaultKey = Buffer.alloc(32, 31).toString('base64');
  const vaultRows = new Map<string, { ciphertext: string; iv: string; auth_tag: string; key_version: number; updated_at: string }>();
  const creatorRows = new Map([
    ['creator-01-id', { id: 'creator-01-id', email: 'creator01@ug.local', username: 'creator01' }],
    ['creator-02-id', { id: 'creator-02-id', email: 'creator02@ug.local', username: 'creator02' }],
  ]);
  const fakeClient = {
    async query(sql: string, params: unknown[] = []) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql)) return { rows: [] };
      if (sql.includes('INSERT INTO server_secrets')) return { rows: [{ secret_value: serverVaultKey }] };
      if (sql.includes('UPDATE players SET')) {
        const id = String(params.at(-1));
        const player = creatorRows.get(id);
        return { rows: player ? [{ ...player, save_slots_max: 2, dead_count: 0, retired_count: 0, is_disabled: false }] : [] };
      }
      if (sql.includes('INSERT INTO player_password_vault')) {
        const [id, ciphertext, iv, authTag, keyVersion] = params;
        vaultRows.set(String(id), {
          ciphertext: String(ciphertext),
          iv: String(iv),
          auth_tag: String(authTag),
          key_version: Number(keyVersion),
          updated_at: '2026-07-11T00:00:00.000Z',
        });
        return { rows: [] };
      }
      if (sql.includes('LEFT JOIN player_password_vault')) {
        const id = String(params[0]);
        const player = creatorRows.get(id);
        const vault = vaultRows.get(id);
        return { rows: player ? [{ id, ...vault }] : [] };
      }
      if (sql.includes('INSERT INTO account_audit_logs')) return { rows: [] };
      throw new Error(`Unexpected SQL in MOD-15 route test: ${sql}`);
    },
    release() {},
  };

  (pool as any).connect = async () => fakeClient;
  const app = Fastify({ logger: false });
  await app.register(playerAccountRoutes);
  const adminToken = jwt.sign(
    { userId: 'admin-id', role: 'admin' },
    process.env.ADMIN_JWT_SECRET || 'fallback-secret-change-me',
  );
  const headers = { authorization: `Bearer ${adminToken}` };
  const credentials = [
    { id: 'creator-01-id', password: 'CreatorNorth7319' },
    { id: 'creator-02-id', password: 'CreatorSouth8642' },
  ];

  try {
    for (const credential of credentials) {
      const reset = await app.inject({
        method: 'PATCH',
        url: `/api/admin/players/${credential.id}`,
        headers,
        payload: { password: credential.password },
      });
      assertEq(reset.statusCode, 200, `reset ${credential.id}`);

      const reveal = await app.inject({
        method: 'POST',
        url: `/api/admin/players/${credential.id}/password/reveal`,
        headers,
      });
      assertEq(reveal.statusCode, 200, `reveal ${credential.id}`);
      assertEq(reveal.json().data.password, credential.password, `round-trip ${credential.id}`);
      assertEq(reveal.headers['cache-control'], 'no-store, max-age=0', `no-store ${credential.id}`);
    }
    assertEq(
      vaultRows.get('creator-01-id')?.ciphertext === vaultRows.get('creator-02-id')?.ciphertext,
      false,
      'creator accounts must not share ciphertext',
    );
  } finally {
    await app.close();
    (pool as any).connect = originalConnect;
  }
});

test('deployment bootstraps visible, login-valid creator passwords exactly once', async () => {
  const key = Buffer.alloc(32, 41).toString('base64');
  const players = new Map([
    ['creator01', { id: 'creator-01-id', username: 'creator01', password_hash: '' }],
    ['creator02', { id: 'creator-02-id', username: 'creator02', password_hash: '' }],
  ]);
  const vaultRows = new Map<string, { ciphertext: string; iv: string; authTag: string; keyVersion: number }>();
  const bootstrapped = new Set<string>();
  const fakeClient = {
    async query(sql: string, params: unknown[] = []) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql)) return { rows: [] };
      if (sql.includes('FROM players p') && sql.includes('already_bootstrapped')) {
        const player = players.get(String(params[0]));
        return { rows: player ? [{ ...player, already_bootstrapped: bootstrapped.has(player.id) }] : [] };
      }
      if (sql.includes('UPDATE players SET password_hash')) {
        const player = [...players.values()].find((row) => row.id === String(params[1]));
        if (player) player.password_hash = String(params[0]);
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO player_password_vault')) {
        vaultRows.set(String(params[0]), {
          ciphertext: String(params[1]),
          iv: String(params[2]),
          authTag: String(params[3]),
          keyVersion: Number(params[4]),
        });
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO account_audit_logs')) {
        bootstrapped.add(String(params[0]));
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in creator bootstrap test: ${sql}`);
    },
  };

  const firstRun = await bootstrapCreatorPasswords(fakeClient as any, key);
  const secondRun = await bootstrapCreatorPasswords(fakeClient as any, key);
  assertEq(firstRun.join(','), 'creator01,creator02');
  assertEq(secondRun.length, 0, 'bootstrap must not rotate passwords on restart');

  const creator01Vault = vaultRows.get('creator-01-id')!;
  const creator02Vault = vaultRows.get('creator-02-id')!;
  const creator01Password = decryptPlayerPassword('creator-01-id', creator01Vault, key);
  const creator02Password = decryptPlayerPassword('creator-02-id', creator02Vault, key);
  assertEq(/^[A-Za-z0-9]{16}$/.test(creator01Password), true, 'creator01 password is usable alphanumeric');
  assertEq(/^[A-Za-z0-9]{16}$/.test(creator02Password), true, 'creator02 password is usable alphanumeric');
  assertEq(creator01Password === creator02Password, false, 'creator passwords are independent');
  assertEq(await bcrypt.compare(creator01Password, players.get('creator01')!.password_hash), true, 'creator01 login hash matches');
  assertEq(await bcrypt.compare(creator02Password, players.get('creator02')!.password_hash), true, 'creator02 login hash matches');
});

let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log('PASS', t.name);
  } catch (e) {
    failed++;
    console.error('FAIL', t.name, e);
  }
}
if (failed > 0) process.exit(1);
