import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import type { PoolClient } from 'pg';
import { encryptPlayerPassword } from './player-password-vault.js';

const CREATOR_USERNAMES = ['creator01', 'creator02'] as const;
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const PASSWORD_LENGTH = 16;
const AUDIT_ACTION = 'creator_password_bootstrap_v2';

function generatePassword(): string {
  let password = '';
  for (let i = 0; i < PASSWORD_LENGTH; i++) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return password;
}

export async function bootstrapCreatorPasswords(
  client: Pick<PoolClient, 'query'>,
  vaultKey: string,
): Promise<string[]> {
  const updated: string[] = [];
  for (const username of CREATOR_USERNAMES) {
    await client.query('BEGIN');
    try {
      const result = await client.query(
        `SELECT p.id, p.username,
                EXISTS (
                  SELECT 1 FROM account_audit_logs l
                   WHERE l.target_player_id = p.id AND l.action = $2
                ) AS already_bootstrapped
           FROM players p
          WHERE p.username = $1
          FOR UPDATE`,
        [username, AUDIT_ACTION],
      );
      const player = result.rows[0];
      if (!player || player.already_bootstrapped) {
        await client.query('COMMIT');
        continue;
      }

      const password = generatePassword();
      const hash = await bcrypt.hash(password, 12);
      const vault = encryptPlayerPassword(player.id, password, vaultKey);
      await client.query(
        'UPDATE players SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [hash, player.id],
      );
      await client.query(
        `INSERT INTO player_password_vault (player_id, ciphertext, iv, auth_tag, key_version)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (player_id) DO UPDATE
           SET ciphertext = EXCLUDED.ciphertext,
               iv = EXCLUDED.iv,
               auth_tag = EXCLUDED.auth_tag,
               key_version = EXCLUDED.key_version,
               updated_at = NOW()`,
        [player.id, vault.ciphertext, vault.iv, vault.authTag, vault.keyVersion],
      );
      await client.query(
        `INSERT INTO account_audit_logs (target_player_id, action, detail)
         VALUES ($1, $2, $3::jsonb)`,
        [player.id, AUDIT_ACTION, JSON.stringify({ username, generated_by: 'server', password_length: PASSWORD_LENGTH })],
      );
      await client.query('COMMIT');
      updated.push(username);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  return updated;
}

export const creatorPasswordBootstrapTestHelpers = {
  AUDIT_ACTION,
  PASSWORD_LENGTH,
};
