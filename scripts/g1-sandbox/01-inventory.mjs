import { adminGet, BASE_URL } from './api.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const reportPath = path.join(LOG_DIR, `g1-inventory-${stamp}.md`);

const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# G1 動工前既有零件盤點 (${stamp})`);
log(`API base: ${BASE_URL}`);
log('');

function pickArray(r) {
  if (Array.isArray(r)) return r;
  if (Array.isArray(r?.data)) return r.data;
  if (Array.isArray(r?.items)) return r.items;
  if (Array.isArray(r?.locations)) return r.locations;
  if (Array.isArray(r?.mythos_cards)) return r.mythos_cards;
  if (Array.isArray(r?.encounter_cards)) return r.encounter_cards;
  if (Array.isArray(r?.cards)) return r.cards;
  if (Array.isArray(r?.investigators)) return r.investigators;
  if (Array.isArray(r?.combat_styles)) return r.combat_styles;
  if (Array.isArray(r?.styles)) return r.styles;
  if (Array.isArray(r?.stages)) return r.stages;
  if (Array.isArray(r?.campaigns)) return r.campaigns;
  if (Array.isArray(r?.trees)) return r.trees;
  return null;
}

async function safeGet(label, url, render) {
  try {
    const r = await adminGet(url);
    const arr = pickArray(r);
    log(`## ${label}`);
    log(`endpoint: \`${url}\``);
    if (arr) {
      log(`count: **${arr.length}**`);
      if (render) render(arr, r);
    } else {
      log(`count: n/a (response keys: ${Object.keys(r || {}).join(', ')})`);
    }
    log('');
  } catch (e) {
    log(`## ${label}  ❌`);
    log(`endpoint: \`${url}\``);
    log(`error: ${e.message}`);
    log('');
  }
}

await safeGet('卡片定義', '/api/cards', (arr) => {
  log(`first 10 codes: ${arr.slice(0, 10).map(c => c.code || c.id).join(', ')}`);
  const talisman = arr.filter(c => c.is_talisman).length;
  log(`is_talisman: ${talisman}`);
});

await safeGet('地點', '/api/admin/locations', (arr) => {
  log(`names: ${arr.map(l => l.name_zh || l.name || l.id).slice(0, 20).join(', ')}`);
});

await safeGet('怪物家族', '/api/admin/monsters/families', (arr) => {
  log(`families: ${arr.map(f => f.code || f.name_zh || f.id).join(', ')}`);
});

await safeGet('怪物物種', '/api/admin/monsters/species', (arr) => {
  log(`first 10: ${arr.slice(0, 10).map(s => s.name_zh || s.id).join(', ')}`);
});

await safeGet('怪物變體', '/api/admin/monsters/variants', (arr) => {
  log(`first 10: ${arr.slice(0, 10).map(v => v.name_zh || v.id).join(', ')}`);
});

await safeGet('調查員', '/api/admin/investigators', (arr) => {
  log(`names: ${arr.map(i => i.name_zh || i.id).join(', ')}`);
});

await safeGet('神話卡', '/api/admin/keeper/mythos-cards', (arr) => {
  log(`first 10: ${arr.slice(0, 10).map(m => m.name_zh || m.code || m.id).join(', ')}`);
});

await safeGet('遭遇卡', '/api/admin/keeper/encounter-cards', (arr) => {
  log(`first 10: ${arr.slice(0, 10).map(m => m.name_zh || m.code || m.id).join(', ')}`);
});

await safeGet('戰鬥風格', '/api/combat-styles', (arr) => {
  log(`styles: ${arr.map(s => `${s.code}:${s.name_zh || s.name}`).join(', ')}`);
});

await safeGet('關卡 stages', '/api/stages', (arr) => {
  log(`names: ${arr.map(s => s.name_zh || s.id).join(', ')}`);
});

await safeGet('戰役 campaigns', '/api/campaigns', (arr) => {
  log(`names: ${arr.map(s => s.name_zh || s.id).join(', ')}`);
});

await safeGet('天賦樹 talent_trees', '/api/talent-trees', (arr) => {
  log(`factions: ${arr.map(t => t.faction_code || t.id).join(', ')}`);
});

fs.writeFileSync(reportPath, lines.join('\n'));
log('---');
log(`report saved: ${reportPath}`);
