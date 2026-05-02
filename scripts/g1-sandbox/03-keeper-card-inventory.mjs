// 守密人牌庫盤點:神話卡 + 遭遇卡實際存量
// 走 /api/admin/keeper/stats/overview(已驗 schema:keeper.ts L37-91)
import { adminGet } from './api.mjs';

console.log('═══ 守密人牌庫盤點(神話卡 + 遭遇卡) ═══\n');

const stats = await adminGet('/api/admin/keeper/stats/overview');
const m = stats?.mythos_cards ?? {};
const e = stats?.encounter_cards ?? {};

console.log('## 神話卡 mythos_cards\n');
console.log(`  總數: ${m.total ?? 0}`);
console.log('  分類分布(by_category):');
for (const [k, v] of Object.entries(m.by_category ?? {})) {
  console.log(`    ${k.padEnd(12)}: ${v}`);
}
console.log('  強度分布(by_intensity):');
for (const [k, v] of Object.entries(m.by_intensity ?? {})) {
  console.log(`    ${k.padEnd(8)}: ${v}`);
}
console.log('  時機分布(by_timing):');
for (const [k, v] of Object.entries(m.by_timing ?? {})) {
  console.log(`    ${k.padEnd(28)}: ${v}`);
}
console.log('  狀態分布(by_status):');
for (const [k, v] of Object.entries(m.by_status ?? {})) {
  console.log(`    ${k.padEnd(10)}: ${v}`);
}
console.log(`  缺風味字 missing_flavor: ${m.missing_flavor ?? 0}\n`);

console.log('## 遭遇卡 encounter_cards\n');
console.log(`  總數: ${e.total ?? 0}`);
console.log('  類型分布(by_type):');
for (const [k, v] of Object.entries(e.by_type ?? {})) {
  console.log(`    ${k.padEnd(12)}: ${v}`);
}
console.log('  狀態分布(by_status):');
for (const [k, v] of Object.entries(e.by_status ?? {})) {
  console.log(`    ${k.padEnd(10)}: ${v}`);
}
console.log('  地點風格 tag 覆蓋:');
for (const [k, v] of Object.entries(e.tag_coverage ?? {})) {
  console.log(`    ${k.padEnd(20)}: ${v}`);
}
console.log(`  選項不足(<2)的卡 insufficient_options: ${e.insufficient_options ?? 0}\n`);

// 第 11 點規範對照
console.log('## 對照規範缺口\n');
const REGULATION_TARGET_POOL = 12;
const cats = m.by_category ?? {};
const REQUIRED_CATS_BASE = ['summon', 'environment', 'status', 'global', 'agenda'];
console.log('  神話卡 — 規範:每關 10-15 張可挑,主軸需要 category 都有對應卡');
const totalMythos = m.total ?? 0;
if (totalMythos < REGULATION_TARGET_POOL * 2) {
  console.log(`    ❌ 庫存 ${totalMythos} < 建議基底 ${REGULATION_TARGET_POOL * 2}(一關 12 + 通用備援 12)`);
}
for (const cat of REQUIRED_CATS_BASE) {
  const count = cats[cat] ?? 0;
  const ok = count >= 3;
  console.log(`    ${ok ? '✓' : '❌'} category=${cat.padEnd(12)} 庫存 ${count}(建議 ≥3)`);
}

console.log('\n  遭遇卡 — 規範:每關 5-10 張通用 + 3-5 張關卡專屬');
const totalEnc = e.total ?? 0;
const ENC_REQUIRED_TYPES = ['thriller', 'choice', 'trade', 'puzzle', 'social', 'discovery'];
if (totalEnc < 30) {
  console.log(`    ❌ 庫存 ${totalEnc} < 建議基底 30(每 type 至少 5 張)`);
}
for (const t of ENC_REQUIRED_TYPES) {
  const count = (e.by_type ?? {})[t] ?? 0;
  const ok = count >= 3;
  console.log(`    ${ok ? '✓' : '❌'} type=${t.padEnd(12)} 庫存 ${count}(建議 ≥3-5)`);
}

console.log('\n═══ 盤點完成 ═══');
