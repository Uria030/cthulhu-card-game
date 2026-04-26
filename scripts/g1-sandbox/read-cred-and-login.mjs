import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CRED_PATH = path.join(ROOT, 'g1-cred.txt');
const TOKEN_PATH = path.join(ROOT, '.g1-token');
const URL = 'https://server-production-fc4f.up.railway.app/api/auth/login';

if (!fs.existsSync(CRED_PATH)) {
  console.error(`✗ 找不到 ${CRED_PATH}`);
  console.error('  請先用記事本在這個位置建檔:');
  console.error(`  ${CRED_PATH}`);
  console.error('  內容兩行:第一行帳號,第二行密碼');
  process.exit(2);
}

const raw = fs.readFileSync(CRED_PATH, 'utf8');
const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
if (lines.length < 2) {
  console.error('✗ g1-cred.txt 格式錯誤,需要兩行(第一行帳號,第二行密碼)');
  console.error(`  目前讀到 ${lines.length} 行有效內容`);
  process.exit(3);
}
const [username, password] = lines;

console.log(`讀到帳號: ${username}(密碼長度 ${password.length})`);
console.log('正在登入...');

const res = await fetch(URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ username, password }),
});
const data = await res.json();

// 不論成敗,都先刪掉 cred 檔
try {
  fs.unlinkSync(CRED_PATH);
  console.log(`✓ 已刪除 g1-cred.txt(密碼不留電腦)`);
} catch (e) {
  console.error(`⚠ 無法刪除 g1-cred.txt: ${e.message}`);
}

if (!res.ok || !data?.data?.token) {
  console.error(`✗ 登入失敗: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  process.exit(1);
}

fs.writeFileSync(TOKEN_PATH, data.data.token);
console.log(`✓ token 已儲存到 .g1-token`);
console.log(`  長度: ${data.data.token.length}`);
console.log(`  角色: ${data.data.user.role}`);
console.log(`  有效時間: 約 ${Math.round(data.data.expiresIn / 3600)} 小時`);
