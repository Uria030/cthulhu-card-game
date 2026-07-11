import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const KEY_VERSION = 1;

export interface PlayerPasswordVaultRecord {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

export class PlayerPasswordVaultConfigurationError extends Error {
  constructor(message = 'PLAYER_PASSWORD_VAULT_KEY must be a base64-encoded 32-byte key') {
    super(message);
    this.name = 'PlayerPasswordVaultConfigurationError';
  }
}

function decodeKey(encodedKey: string | undefined): Buffer {
  if (!encodedKey) throw new PlayerPasswordVaultConfigurationError();
  const normalized = encodedKey.trim();
  const key = Buffer.from(normalized, 'base64');
  if (key.length !== KEY_BYTES || key.toString('base64') !== normalized) {
    throw new PlayerPasswordVaultConfigurationError();
  }
  return key;
}

function additionalData(playerId: string, keyVersion: number): Buffer {
  return Buffer.from(`player-password:${keyVersion}:${playerId}`, 'utf8');
}

export function encryptPlayerPassword(
  playerId: string,
  password: string,
  encodedKey = process.env.PLAYER_PASSWORD_VAULT_KEY,
): PlayerPasswordVaultRecord {
  const key = decodeKey(encodedKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(additionalData(playerId, KEY_VERSION));
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: KEY_VERSION,
  };
}

export function decryptPlayerPassword(
  playerId: string,
  record: PlayerPasswordVaultRecord,
  encodedKey = process.env.PLAYER_PASSWORD_VAULT_KEY,
): string {
  const key = decodeKey(encodedKey);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(record.iv, 'base64'));
  decipher.setAAD(additionalData(playerId, record.keyVersion));
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function assertPlayerPasswordVaultConfigured(
  encodedKey = process.env.PLAYER_PASSWORD_VAULT_KEY,
): void {
  decodeKey(encodedKey);
}
