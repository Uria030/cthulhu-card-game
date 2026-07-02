import fs from 'node:fs';
import path from 'node:path';
import { adminGet } from '../api.mjs';

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback;
}

const outPath = argValue('--out', path.join(import.meta.dirname, 'preset-investigators.json'));
const limit = Number(argValue('--limit', '200'));

const response = await adminGet(`/api/admin/investigators?is_preset=true&limit=${limit}`);
const rows = Array.isArray(response?.items) ? response.items : Array.isArray(response?.data) ? response.data : response;
if (!Array.isArray(rows)) {
  throw new Error('無法解析 /api/admin/investigators 回傳格式');
}

const investigators = rows
  .filter((x) => x?.id)
  .map((x) => ({
    id: String(x.id),
    code: String(x.code ?? x.mbti_code ?? x.id),
    mbti_code: x.mbti_code ?? null,
    faction_code: x.faction_code ?? null,
    name_zh: x.name_zh ?? '',
    title_zh: x.title_zh ?? '',
    is_completed: Boolean(x.is_completed),
  }))
  .sort((a, b) => a.code.localeCompare(b.code));

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(investigators, null, 2));
console.log(`wrote ${investigators.length} preset investigators -> ${outPath}`);
