import bcrypt from 'bcryptjs';
import { pool } from './pool.js';

export async function createDefaultAdmin() {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.warn('ADMIN_PASSWORD not set, skipping default admin creation');
    return;
  }

  const client = await pool.connect();
  try {
    const existing = await client.query(
      "SELECT id FROM admin_users WHERE username = 'admin' LIMIT 1"
    );
    if (existing.rows.length === 0) {
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      await client.query(
        `INSERT INTO admin_users (username, password_hash, display_name, role)
         VALUES ('admin', $1, 'Administrator', 'owner')`,
        [passwordHash]
      );
      console.log('Default admin account created (username: admin)');
    }
  } finally {
    client.release();
  }
}
