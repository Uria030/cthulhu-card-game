import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const TOKEN_PATH = path.join(ROOT, '.g1-token');
const BASE_URL = process.env.G1_API_BASE || 'https://server-production-fc4f.up.railway.app';

function readToken() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`找不到 ${TOKEN_PATH}。請先依說明取 admin token。`);
  }
  const t = fs.readFileSync(TOKEN_PATH, 'utf8').replace(/[\r\n\s]+/g, '');
  if (t.length < 50) {
    throw new Error(`token 長度異常 (${t.length}),可能登入失敗。請檢查 .g1-token 內容。`);
  }
  return t;
}

export async function adminFetch(pathOrUrl, options = {}) {
  const token = readToken();
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
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
