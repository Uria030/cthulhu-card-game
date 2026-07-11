import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { playerAccountTestHelpers } from './player-accounts.js';
import { playerAccountRoutes } from './player-accounts.js';
import { MIGRATION_042_SQL, MIGRATION_043_SQL } from '../db/migrate.js';
import { pool } from '../db/pool.js';
import {
  decryptPlayerPassword,
  encryptPlayerPassword,
  PlayerPasswordVaultConfigurationError,
} from '../services/player-password-vault.js';

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
  const originalVaultKey = process.env.PLAYER_PASSWORD_VAULT_KEY;
  const vaultRows = new Map<string, { ciphertext: string; iv: string; auth_tag: string; key_version: number; updated_at: string }>();
  const creatorRows = new Map([
    ['creator-01-id', { id: 'creator-01-id', email: 'creator01@ug.local', username: 'creator01' }],
    ['creator-02-id', { id: 'creator-02-id', email: 'creator02@ug.local', username: 'creator02' }],
  ]);
  const fakeClient = {
    async query(sql: string, params: unknown[] = []) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql)) return { rows: [] };
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
  process.env.PLAYER_PASSWORD_VAULT_KEY = Buffer.alloc(32, 31).toString('base64');
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
    if (originalVaultKey === undefined) delete process.env.PLAYER_PASSWORD_VAULT_KEY;
    else process.env.PLAYER_PASSWORD_VAULT_KEY = originalVaultKey;
  }
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
