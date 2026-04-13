import pg from 'pg';

const { Pool } = pg;

// Railway injects DATABASE_URL with sslmode param; detect it or NODE_ENV
const dbUrl = process.env.DATABASE_URL || '';
const needsSsl = dbUrl.includes('railway') || dbUrl.includes('sslmode') || process.env.NODE_ENV === 'production';

export const pool = new Pool({
  connectionString: dbUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});
