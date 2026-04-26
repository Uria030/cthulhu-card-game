import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const TOKEN_PATH = path.join(ROOT, '.g1-token');
const URL = 'https://server-production-fc4f.up.railway.app/api/auth/login';

const username = process.env.ADMIN_USER;
const password = process.env.ADMIN_PASS;
if (!username || !password) {
  console.error('✗ 請設 ADMIN_USER 與 ADMIN_PASS 環境變數,例如:');
  console.error('  ADMIN_USER=owner ADMIN_PASS=xxx node scripts/g1-sandbox/00-login.mjs');
  process.exit(2);
}

const res = await fetch(URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ username, password }),
});
const data = await res.json();
if (!res.ok || !data?.data?.token) {
  console.error(`✗ login failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  process.exit(1);
}
fs.writeFileSync(TOKEN_PATH, data.data.token);
console.log(`✓ token saved to .g1-token (len=${data.data.token.length}, role=${data.data.user.role}, expires in ${data.data.expiresIn}s ≈ ${Math.round(data.data.expiresIn / 3600)}h)`);
