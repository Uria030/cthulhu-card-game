import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const TOKEN_PATH = path.join(ROOT, '.g1-token');
const CRED_PATH = path.join(ROOT, 'g1-cred.txt');
const BASE_URL = process.env.G1_API_BASE || 'https://server-production-fc4f.up.railway.app';

function readToken() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  const t = fs.readFileSync(TOKEN_PATH, 'utf8').replace(/[\r\n\s]+/g, '');
  if (t.length < 50) return null;
  return t;
}

// 自動登入(讀 g1-cred.txt → POST /api/auth/login → 寫 .g1-token)
async function autoRefreshToken() {
  if (!fs.existsSync(CRED_PATH)) {
    throw new Error([
      `找不到 ${CRED_PATH}。`,
      '請用記事本在這個位置建檔(內容兩行:第一行帳號、第二行密碼),存檔後重跑腳本。',
      '檔案已 .gitignore,不會進 git。設計為永久保留,以後 token 過期會自動 refresh,不再打擾。',
    ].join('\n'));
  }
  const raw = fs.readFileSync(CRED_PATH, 'utf8');
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) {
    throw new Error(`g1-cred.txt 格式錯誤,需要兩行(帳號/密碼),目前有效行數 ${lines.length}`);
  }
  const [username, password] = lines;
  console.log(`[auto-refresh] token 失效,用 g1-cred.txt 自動登入(帳號 ${username})...`);
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok || !data?.data?.token) {
    throw new Error(`自動登入失敗: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
  fs.writeFileSync(TOKEN_PATH, data.data.token);
  console.log(`[auto-refresh] ✓ 新 token 已寫入 .g1-token(${Math.round(data.data.expiresIn / 3600)}h)`);
  return data.data.token;
}

export async function adminFetch(pathOrUrl, options = {}, _retry = false) {
  let token = readToken();
  if (!token) token = await autoRefreshToken();
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {}),
  };
  // Content-Type: application/json 僅在確實帶 body 時才加(對應 admin-shared.js 同邏輯)
  // 空 body + JSON header 會被 Fastify 擋 400 Bad Request(發生在 DELETE / 無 body GET)
  if (options.body !== undefined && options.body !== null && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }

  // 401 → 自動 refresh + retry 一次(避開無限迴圈)
  if (res.status === 401 && !_retry) {
    await autoRefreshToken();
    return adminFetch(pathOrUrl, options, true);
  }

  return { status: res.status, ok: res.ok, body };
}

export async function adminGet(p) {
  const r = await adminFetch(p);
  if (!r.ok) throw new Error(`GET ${p} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
}

export async function adminPost(p, body) {
  const r = await adminFetch(p, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${p} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
}

export async function adminPut(p, body) {
  const r = await adminFetch(p, { method: 'PUT', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PUT ${p} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
}

export async function callGemini(prompt, opts = {}) {
  const apiKey = process.env.GEMINI_API_KEY_PERSONAL;
  if (!apiKey) throw new Error('GEMINI_API_KEY_PERSONAL not set in environment');
  const model = opts.model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      responseMimeType: opts.responseMimeType || 'application/json',
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (opts.responseMimeType === 'application/json' || !opts.responseMimeType) {
    try { return JSON.parse(text); } catch { return { _raw: text, _parseError: true }; }
  }
  return text;
}

export { BASE_URL };
