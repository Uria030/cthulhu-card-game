import { adminFetch, adminGet } from './api.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `g1-bind-pools-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# G1 stage 池綁定 ${stamp}`);

const stages = await adminGet('/api/stages');
const stArr = stages.stages || stages.data || [];
const stage = stArr.find(s => s.code === 'g1_sandbox_innsmouth');
if (!stage) { log('✗ 找不到 g1_sandbox_innsmouth stage'); process.exit(1); }
log(`stage id=${stage.id}`);

// 既有綁定(冪等)
const detail = await adminGet(`/api/stages/${stage.id}`);
const existingMythIds = new Set((detail.mythos_pool || []).map(m => m.mythos_card_id));
const existingEncIds = new Set((detail.encounter_pool || []).map(e => e.encounter_card_id));
const existingMonsterFams = new Set((detail.monster_pool || []).map(m => m.family_code));
log(`既有綁定: 神話 ${existingMythIds.size} / 遭遇 ${existingEncIds.size} / 怪物家族 ${existingMonsterFams.size}`);

// ── 1. 神話池:G1_ 10 張
const mList = await adminGet('/api/admin/keeper/mythos-cards');
const g1Myth = (mList.mythos_cards || []).filter(m => m.code?.startsWith('G1_myth_'));
log(`\n── 神話池(${g1Myth.length} 張)──`);
let mAdd = 0;
for (const m of g1Myth) {
  if (existingMythIds.has(m.id)) { log(`⊙ skip: ${m.name_zh}`); continue; }
  const r = await adminFetch(`/api/stages/${stage.id}/mythos-pool`, {
    method: 'POST', body: JSON.stringify({ mythos_card_id: m.id, weight: m.intensity_tag === 'large' ? 2 : 1 }),
  });
  if (!r.ok) { log(`✗ ${m.name_zh}: ${r.status}`); continue; }
  log(`✓ ${m.name_zh} (weight ${m.intensity_tag === 'large' ? 2 : 1})`); mAdd++;
}

// ── 2. 遭遇池:G1_ 5 張
const eList = await adminGet('/api/admin/keeper/encounter-cards');
const g1Enc = (eList.encounter_cards || []).filter(e => e.code?.startsWith('G1_enc_'));
log(`\n── 遭遇池(${g1Enc.length} 張)──`);
let eAdd = 0;
for (const e of g1Enc) {
  if (existingEncIds.has(e.id)) { log(`⊙ skip: ${e.name_zh}`); continue; }
  const r = await adminFetch(`/api/stages/${stage.id}/encounter-pool`, {
    method: 'POST', body: JSON.stringify({ encounter_card_id: e.id, weight: 1 }),
  });
  if (!r.ok) { log(`✗ ${e.name_zh}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); continue; }
  log(`✓ ${e.name_zh}`); eAdd++;
}

// ── 3. 怪物池
// house_cthulhu (深潛者裂嘴女 + 亡靈) + fallen (街頭流氓)
const variants = await adminGet('/api/admin/monsters/variants');
const vArr = variants.variants || variants.data || [];
const slitMouth = vArr.find(v => v.code === 'G1_deep_one_slit_mouth');
const ghoul = vArr.find(v => v.code === 'G1_deep_one_revenant');
const thug = vArr.find(v => v.code === 'G1_street_thug_basic');
log(`\n── 怪物池 ──`);
log(`找到變體: 裂嘴女 ${slitMouth?.id} / 亡靈 ${ghoul?.id} / 流氓 ${thug?.id}`);

const monsterPools = [
  { family_code: 'house_cthulhu', role: 'main', allowed_tiers: ['elite', 'basic'], fixed_boss_ids: [slitMouth?.id, ghoul?.id].filter(Boolean) },
  { family_code: 'fallen', role: 'support', allowed_tiers: ['basic'], fixed_boss_ids: [thug?.id].filter(Boolean) },
];

let monAdd = 0;
for (const mp of monsterPools) {
  if (existingMonsterFams.has(mp.family_code)) { log(`⊙ skip family: ${mp.family_code}`); continue; }
  const r = await adminFetch(`/api/stages/${stage.id}/monster-pool`, {
    method: 'POST', body: JSON.stringify(mp),
  });
  if (!r.ok) { log(`✗ ${mp.family_code}: ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`); continue; }
  log(`✓ ${mp.family_code} role=${mp.role} fixed=${mp.fixed_boss_ids.length}`); monAdd++;
}

log(`\n=== 綁定結果 === 神話 +${mAdd} / 遭遇 +${eAdd} / 怪物家族 +${monAdd}`);
fs.writeFileSync(logPath, lines.join('\n'));
log(`log: ${logPath}`);
