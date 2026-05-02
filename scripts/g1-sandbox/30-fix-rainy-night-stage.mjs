// G1 短期修復:補「雨夜的真相」的 reference_locations + chaos_bag,並把戰役掛上 stage
// 對應 root cause:pipeline 跑時資料未齊,留 WARN 跳過
import { adminGet, adminFetch } from './api.mjs';

const STAGE_ID = '9ad171b3-c439-4049-b673-b929f91366ce'; // 雨夜的真相

console.log('═══ G1 短期修復:雨夜的真相 ═══\n');

// 1. 看現況
console.log('## 1. 現況');
const stage = await adminGet(`/api/stages/${STAGE_ID}`);
const stageData = stage?.data ?? stage;
const scenarios = stageData?.scenarios ?? [];
console.log(`  stage chapter_id: ${stageData?.stage?.chapter_id ?? stageData?.chapter_id ?? '?'}`);
console.log(`  scenarios: ${scenarios.length}`);
scenarios.forEach((s, i) => {
  console.log(`    [${i}] ${s.name_zh ?? '(無名)'}: locations=${(s.initial_location_codes ?? []).length}, connections=${(s.initial_connections ?? []).length}`);
});

const locs = await adminGet('/api/admin/locations');
const locList = locs?.data ?? locs?.locations ?? locs ?? [];
console.log(`  locations: ${locList.length}`);
locList.forEach((l) => console.log(`    code=${l.code}, name=${l.name_zh}`));
console.log();

// 2. 拿戰役確認 initial_chaos_bag
console.log('## 2. 戰役狀態');
const camps = await adminGet('/api/campaigns');
const campList = camps?.data ?? camps?.campaigns ?? camps ?? [];
const camp = campList[0];
console.log(`  campaign: ${camp?.name_zh ?? camp?.id}`);
const campDetail = await adminGet(`/api/campaigns/${camp.id}`);
const campD = campDetail?.data ?? campDetail;
const ibag = campD?.campaign?.initial_chaos_bag ?? campD?.initial_chaos_bag;
console.log(`  initial_chaos_bag: ${ibag ? Object.keys(ibag).join(',') : '無'}`);
const chapters = campD?.chapters ?? [];
console.log(`  chapters: ${chapters.length}`);
chapters.forEach((c) => console.log(`    [${c.chapter_number}] ${c.name_zh ?? '(無名)'} id=${c.id}`));
console.log();

// 3. 補 scenario 的 location_codes + connections
console.log('## 3. 補 scenario 綁地點');
if (locList.length < 3) {
  console.log(`  ❌ 地點少於 3 個,無法繼續`);
  process.exit(1);
}
const [loc1, loc2, loc3] = locList;
const codes = [loc1.code, loc2.code, loc3.code];
// G1 規格:相鄰連接 + 一個障礙物連接
const connections = [
  { from: loc1.code, to: loc2.code },             // 普通連接
  { from: loc2.code, to: loc3.code, obstacle: true }, // 障礙物連接
];
for (const sc of scenarios) {
  const r = await adminFetch(`/api/scenarios/${sc.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      initial_location_codes: codes,
      investigator_spawn_location: loc1.code,
      initial_connections: connections,
    }),
  });
  if (r.ok) {
    console.log(`  ✓ scenario [${sc.scenario_order}] ${sc.name_zh ?? ''} 綁定 ${codes.length} 地點`);
  } else {
    console.log(`  ❌ scenario ${sc.id} 失敗 ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  }
}
console.log();

// 4. chaos_bag:若戰役無 initial_chaos_bag,先帶 standard preset
console.log('## 4. chaos_bag');
if (!ibag || Object.keys(ibag).length === 0) {
  console.log('  戰役 initial_chaos_bag 為空,先設 standard preset');
  // standard preset 從 stage-options.json 拿
  const standardBag = {
    number_markers: { '+1': 1, '0': 2, '-1': 3, '-2': 2, '-3': 1, '-4': 1 },
    skull_markers: { count: 1, value: -2 },
    fail_marker: true,
    elder_sign_marker: true,
  };
  const ru = await adminFetch(`/api/campaigns/${camp.id}`, {
    method: 'PUT',
    body: JSON.stringify({ initial_chaos_bag: standardBag }),
  });
  if (ru.ok) console.log(`  ✓ 戰役 initial_chaos_bag 已設 standard preset`);
  else console.log(`  ❌ 戰役 PUT 失敗 ${ru.status}: ${JSON.stringify(ru.body).slice(0, 200)}`);
}

const reset = await adminFetch(`/api/stages/${STAGE_ID}/chaos-bag/reset-from-campaign`, {
  method: 'POST',
});
if (reset.ok) console.log(`  ✓ stage chaos_bag 從戰役 initial_chaos_bag 繼承`);
else console.log(`  ❌ chaos_bag 繼承失敗 ${reset.status}: ${JSON.stringify(reset.body).slice(0, 200)}`);
console.log();

// 5. 驗證
console.log('## 5. 驗證');
const after = await adminGet(`/api/stages/${STAGE_ID}`);
const ad = after?.data ?? after;
const refLocs = ad?.scenarios?.reduce((sum, sc) => sum + (sc.initial_location_codes?.length ?? 0), 0) ?? 0;
console.log(`  scenarios 綁定地點總數: ${refLocs}`);
console.log(`  chaos_bag tokens: ${ad?.chaos_bag ? Object.keys(ad.chaos_bag).length : 0}`);

console.log('\n═══ 完成 ═══');
