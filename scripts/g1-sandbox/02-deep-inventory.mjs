// G1 深度盤點:看 stage/investigator/combat-style 細節是否完整綁定
import { adminGet } from './api.mjs';

function show(label, val, indent = 0) {
  const pad = ' '.repeat(indent);
  console.log(`${pad}${label}: ${val}`);
}

async function tryGet(url) {
  try {
    return await adminGet(url);
  } catch (e) {
    return { __error: e.message };
  }
}

console.log('═══ G1 深度盤點 ═══\n');

// 1. Stage 完整檢查
console.log('## 關卡(stage)綁定完整性\n');
const stages = await tryGet('/api/stages');
const stageList = stages?.data ?? stages?.stages ?? stages ?? [];
for (const s of stageList) {
  const id = s.id;
  const detail = await tryGet(`/api/stages/${id}`);
  const d = detail?.data ?? detail;
  console.log(`  ▸ ${s.name_zh ?? s.code ?? id}`);
  show('id', id, 4);
  show('type', d?.stage?.stage_type ?? d?.stage_type ?? '?', 4);
  show('scenarios', (d?.scenarios?.length ?? d?.scenario?.length ?? 0), 4);
  show('act_cards', (d?.act_cards?.length ?? 0), 4);
  show('agenda_cards', (d?.agenda_cards?.length ?? 0), 4);
  show('encounter_pool', (d?.encounter_pool?.length ?? 0), 4);
  show('mythos_pool', (d?.mythos_pool?.length ?? 0), 4);
  show('chaos_bag tokens', (d?.chaos_bag?.length ?? 0), 4);
  show('monster_pool', (d?.monster_pool?.length ?? 0), 4);
  show('reference_locations', (d?.reference_locations?.length ?? 0), 4);
  show('chapter_info', d?.chapter_info ? '有' : '無', 4);
  console.log();
}

// 2. 調查員完整檢查(只挑前 3 個跟最後 1 個有名字的看)
console.log('## 調查員 setup 完整性(隨機取樣)\n');
const invs = await tryGet('/api/admin/investigators');
let invList = invs?.data ?? invs?.investigators ?? invs;
if (!Array.isArray(invList)) invList = [];
const namedInvs = invList.filter((i) => i.name_zh && !String(i.name_zh).startsWith('未命名'));
const sample = [...namedInvs.slice(0, 3), ...invList.slice(-2)];
for (const inv of sample) {
  const detail = await tryGet(`/api/admin/investigators/${inv.id}`);
  const d = detail?.data ?? detail;
  console.log(`  ▸ ${inv.name_zh ?? inv.id}`);
  show('id', inv.id, 4);
  show('faction', d?.faction_code ?? d?.investigator?.faction_code ?? '?', 4);
  show('combat_style', d?.combat_style_code ?? d?.investigator?.combat_style_code ?? '?', 4);
  const stats = d?.stats ?? d?.investigator?.stats;
  show('stats', stats ? Object.keys(stats).join(',') : '無', 4);
  show('starter_deck cards', d?.starter_deck?.length ?? d?.deck_cards?.length ?? 0, 4);
  show('signature_cards', d?.signature_cards?.length ?? 0, 4);
  show('weakness_cards', d?.weakness_cards?.length ?? 0, 4);
  console.log();
}

// 3. 戰鬥風格 specializations 數量
console.log('## 戰鬥風格 specializations 完整性\n');
const styles = await tryGet('/api/combat-styles');
let styleList = styles?.data ?? styles?.combat_styles ?? styles?.styles ?? styles;
if (!Array.isArray(styleList)) styleList = [];
for (const s of styleList) {
  const detail = await tryGet(`/api/combat-styles/${s.code}`);
  const d = detail?.data ?? detail;
  const specs = d?.specializations ?? d?.specs ?? d?.style?.specializations ?? [];
  console.log(`  ▸ ${s.code} ${s.name_zh ?? ''}: ${specs.length} 專精`);
}
console.log();

// 4. 地點欄位
console.log('## 地點視野欄位\n');
const locs = await tryGet('/api/admin/locations');
let locList = locs?.data ?? locs?.locations ?? locs;
if (!Array.isArray(locList)) locList = [];
for (const l of locList) {
  const fields = Object.keys(l).filter((k) => /(ambient|lighting|light|visibility|vision)/i.test(k));
  console.log(`  ▸ ${l.name_zh ?? l.code}: 視野相關欄位 = ${fields.length > 0 ? fields.join(',') : '無'}`);
}
console.log();

// 5. 戰役(campaign)結構
console.log('## 戰役結構\n');
const camps = await tryGet('/api/campaigns');
let campList = camps?.data ?? camps?.campaigns ?? camps;
if (!Array.isArray(campList)) campList = [];
for (const c of campList) {
  const detail = await tryGet(`/api/campaigns/${c.id}`);
  const d = detail?.data ?? detail;
  console.log(`  ▸ ${c.name_zh ?? c.id}`);
  show('chapter_count', d?.chapter_count ?? d?.campaign?.chapter_count ?? '?', 4);
  show('campaign_type', d?.campaign_type ?? d?.campaign?.campaign_type ?? '?', 4);
  show('chapters', d?.chapters?.length ?? 0, 4);
  show('stages', d?.stages?.length ?? 0, 4);
  show('flags', d?.flags?.length ?? 0, 4);
}

console.log('\n═══ 盤點結束 ═══');
