import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('Running database migrations...');
    const migrationsDir = path.join(__dirname, 'migrations');

    // In production (compiled), migrations may be missing from dist.
    // Fall back to reading from src if dist copy doesn't exist.
    let dir = migrationsDir;
    if (!fs.existsSync(dir)) {
      dir = path.resolve(__dirname, '../../src/db/migrations');
    }
    if (!fs.existsSync(dir)) {
      console.warn('No migrations directory found, skipping.');
      return;
    }

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      console.log(`  Executing ${file}...`);
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query(sql);
      console.log(`  ${file} completed`);
    }
    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}
