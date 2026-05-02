// 驗證 MIGRATION_029 是否在 Railway 跑完
// 抓一張既有神話卡 + 一張既有遭遇卡,確認新欄位都存在
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const TOKEN = fs.readFileSync(path.join(ROOT, '.g1-token'), 'utf8').trim();
const BASE = 'https://server-production-fc4f.up.railway.app';

async function adminGet(p) {
  const r = await fetch(BASE + p, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) {
    console.error(`✗ GET ${p} → ${r.status}`);
    const t = await r.text();
    console.error('  body:', t.slice(0, 300));
    process.exit(1);
  }
  return r.json();
}

console.log('=== 驗證 MIGRATION_029 (Railway) ===');

// 1) 神話卡新欄位
const myth = await adminGet('/api/admin/keeper/mythos-cards');
const cards = myth.mythos_cards || [];
console.log(`\n[1] 神話卡共 ${cards.length} 張`);
if (cards.length === 0) {
  console.log('  (無資料,直接看欄位定義無從驗證,跳到遭遇卡)');
} else {
  const sample = cards[0];
  const expected = [
    'reusable', 'cooldown_rounds', 'max_uses_per_stage', 'axis_tag',
    'persistence_mode', 'attachment_target', 'has_chain_trigger', 'has_self_dedupe',
    'threat_type', 'attack_surfaces', 'faction_pressure',
    'complexity_tier', 'dv_average', 'dv_peak', 'dv_peak_target'
  ];
  const missing = expected.filter(k => !(k in sample));
  if (missing.length === 0) {
    console.log(`  ✓ 15 個新欄位全在 (sample code=${sample.code})`);
  } else {
    console.log(`  ✗ 缺欄位:`, missing);
  }
}

// 2) 遭遇卡新欄位
const enc = await adminGet('/api/admin/keeper/encounter-cards');
const encs = enc.encounter_cards || [];
console.log(`\n[2] 遭遇卡共 ${encs.length} 張`);
if (encs.length === 0) {
  console.log('  (無資料,跳過驗證)');
} else {
  const sample = encs[0];
  const expected = [
    'threat_type_array', 'dv_average', 'dv_peak', 'dv_peak_target',
    'has_peril', 'has_surge_builtin', 'has_surge_conditional',
    'has_self_dedupe', 'has_progressive_strengthen',
    'persistence_mode', 'attachment_target', 'deployment_mode',
    'attack_surfaces', 'faction_pressure', 'complexity_tier',
    'encounter_set_id', 'copies_in_set'
  ];
  const missing = expected.filter(k => !(k in sample));
  if (missing.length === 0) {
    console.log(`  ✓ 17 個新欄位全在 (sample code=${sample.code})`);
  } else {
    console.log(`  ✗ 缺欄位:`, missing);
  }

  // 既有 threat_type → threat_type_array 遷移檢查
  const withOld = encs.filter(c => c.threat_type);
  const migrated = withOld.filter(c => Array.isArray(c.threat_type_array) && c.threat_type_array.length > 0);
  console.log(`  既有 threat_type 卡:${withOld.length},已遷至陣列:${migrated.length}`);
}

// 3) encounter_sets 是否 seed 7 個
const setsRes = await fetch(BASE + '/api/admin/keeper/encounter-sets', {
  headers: { Authorization: `Bearer ${TOKEN}` },
});
console.log(`\n[3] encounter_sets endpoint 狀態:${setsRes.status}`);
if (setsRes.ok) {
  const setsData = await setsRes.json();
  const sets = setsData.encounter_sets || setsData.sets || [];
  console.log(`  共 ${sets.length} 個遭遇集`);
  if (sets.length >= 7) {
    console.log(`  ✓ 7 個 seed 已落地`);
    sets.slice(0, 7).forEach(s => console.log(`    - ${s.code}: ${s.name_zh}`));
  } else {
    console.log(`  ⚠ 預期 7 個,實際 ${sets.length}`);
  }
} else {
  console.log(`  (endpoint 尚未開,只能靠神話/遭遇卡欄位推斷 migration 跑了)`);
}

console.log('\n=== 驗證完成 ===');
