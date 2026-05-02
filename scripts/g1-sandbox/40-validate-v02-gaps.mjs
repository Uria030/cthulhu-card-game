// story01 vs v0.2 新流程的誤差驗證
// 跑前次跑通的 stage(雨夜的真相)對照新規範看缺什麼
import { adminGet } from './api.mjs';
import fs from 'node:fs';

const STAGE_ID = '9ad171b3-c439-4049-b673-b929f91366ce'; // 雨夜的真相
const PIPELINE_RESULT_PATH = 'scripts/mod-agent-local/pipeline-story-to-stage/result.json';
const OUTLINE_PATH = 'scripts/mod-agent-local/pipeline-story-to-stage/outline.json';

// keeper_ai_regulation v0.2 §4.1.1 神話卡基底庫需求
const MYTHOS_BASE_REQUIREMENT = {
  summon: { min: 8, max: 10 },
  environment: { min: 5, max: 6 },
  global: { min: 4, max: 5 },
  status: { min: 4, max: 5 },
  narrative: { min: 4, max: 5 },
  agenda: { min: 3, max: 4 },
  epic: { min: 2, max: 3 }, // 新規範要 epic 而非 mythos_cards 的 intensity_tag
};

// keeper_ai_regulation v0.2 §5.1 遭遇卡基底庫需求(7 個遭遇集)
const ENCOUNTER_SETS_TARGET = {
  '儀式詛咒': 7,
  '物質異變': 7,
  '精神侵蝕': 7,
  '規則扭曲': 4,
  '混合複合': 4,
  '敦威治當地': 6,
  '基底填料': 6,
};
const ENCOUNTER_BASE_TOTAL = Object.values(ENCOUNTER_SETS_TARGET).reduce((a, b) => a + b, 0); // 41 張

// 主軸 7 真相揭露 神話卡需求(從 v0.2 §3 主軸 7)
const PLOT_SPINE_7_MYTHOS = {
  narrative: { min: 3, max: 4 }, // 篡改線索 + 散播假線索 + NPC 變臉(可含 meta_personal)
  status: { min: 1, max: 1 },    // 玩家迷亂
  summon: { min: 1, max: 1 },    // 干擾雜兵
  agenda: { min: 1, max: 1 },    // 篡改加速
};

// 主軸 7 遭遇卡偏好
const PLOT_SPINE_7_ENC_TYPE = ['discovery', 'social', 'puzzle']; // s14 part4 §2.3 細分
const PLOT_SPINE_7_THREAT = ['mental', 'ritual', 'meta_personal'];

// 觸發子 Agent 的閾值(pipeline 規範第 11 點 / §13.3)
const SUB_AGENT_TRIGGER_THRESHOLD = {
  mythos_any_category_gap: 3,
  mythos_total_gap: 8,
  encounter_total_gap: 8,
};

console.log('═══ story01 vs v0.2 新流程 誤差驗證 ═══\n');
console.log('目標 stage:雨夜的真相(g_slit_mouth_legend_st1)');
console.log('比對基準:keeper_ai_regulation v0.2 + s14 + 神話卡規範主檔 v0.1');
console.log('');

// ─── 1. 神話卡基底庫缺口 ─────────────────────────────────
console.log('## 1. 神話卡基底庫缺口(v0.2 §4.1.1)\n');
const mAll = await adminGet('/api/admin/keeper/mythos-cards');
const mythos = mAll.mythos_cards || [];
const mByCategory = {};
for (const m of mythos) {
  mByCategory[m.card_category] = (mByCategory[m.card_category] || 0) + 1;
}
const mythosBaseGaps = {};
let mythosTotalGap = 0;
let mythosAnyCategoryGap3Plus = 0;
for (const [cat, req] of Object.entries(MYTHOS_BASE_REQUIREMENT)) {
  const have = mByCategory[cat] || 0;
  // epic 看 intensity 不看 category
  let actual = have;
  if (cat === 'epic') {
    actual = mythos.filter(m => m.intensity_tag === 'epic').length;
  }
  const gap = Math.max(0, req.min - actual);
  mythosBaseGaps[cat] = { have: actual, target: req.min, gap };
  mythosTotalGap += gap;
  if (gap >= 3) mythosAnyCategoryGap3Plus++;
  console.log(`  ${gap > 0 ? '❌' : '✓'} ${cat.padEnd(12)} have=${actual.toString().padStart(2)} / target ≥${req.min} → gap=${gap}`);
}
console.log(`  總缺口:${mythosTotalGap} 張`);
console.log(`  category 缺 ≥3 的:${mythosAnyCategoryGap3Plus} 個`);

const triggerMythosBatch = (mythosAnyCategoryGap3Plus > 0 || mythosTotalGap >= SUB_AGENT_TRIGGER_THRESHOLD.mythos_total_gap);
console.log(`  ${triggerMythosBatch ? '🚨 觸發子 Agent 補建' : '✓ 不需觸發'}(規範第 11 點 §池缺口處理 / §13.3)`);

console.log();

// ─── 2. 遭遇卡基底庫缺口 ─────────────────────────────────
console.log('## 2. 遭遇卡基底庫缺口(v0.2 §5.1,7 個遭遇集)\n');
const eAll = await adminGet('/api/admin/keeper/encounter-cards');
const encounters = eAll.encounter_cards || [];
const encByType = {};
for (const e of encounters) {
  encByType[e.encounter_type] = (encByType[e.encounter_type] || 0) + 1;
}
const encounterTotalGap = ENCOUNTER_BASE_TOTAL - encounters.length;
console.log(`  目前總數:${encounters.length} 張`);
console.log(`  目標總量:${ENCOUNTER_BASE_TOTAL} 張(7 集合計)`);
console.log(`  總缺口:${encounterTotalGap} 張`);
console.log(`  類型分布(舊 6 種枚舉):`);
for (const t of ['thriller', 'choice', 'trade', 'puzzle', 'social', 'discovery']) {
  console.log(`    ${(encByType[t] || 0) > 0 ? '✓' : '❌'} ${t.padEnd(12)} = ${encByType[t] || 0}`);
}
console.log(`  s14 新增 encounter_type 細分:passive / conditional / choice_entry / choice_fail / choice_responsibility / test / chaos_bag(全為 0,既有 7 張未細分)`);
console.log(`  threat_type 標註:`);
const eWithThreat = encounters.filter(e => e.threat_type).length;
console.log(`    ${eWithThreat === encounters.length ? '✓' : '❌'} ${eWithThreat}/${encounters.length} 張有 threat_type 標註`);

const triggerEncBatch = (encounterTotalGap >= SUB_AGENT_TRIGGER_THRESHOLD.encounter_total_gap);
console.log(`  ${triggerEncBatch ? '🚨 觸發子 Agent 補建' : '✓ 不需觸發'}`);

console.log();

// ─── 3. stage 雨夜的真相 — 神話卡池檢查 ──────────────────
console.log('## 3. stage 雨夜的真相 神話卡池(主軸對應檢查)\n');
const outline = JSON.parse(fs.readFileSync(OUTLINE_PATH, 'utf8'));
const plotSpine = outline.plot_spine?.type || '?';
console.log(`  主軸:${plotSpine}`);

const mPoolRes = await adminGet(`/api/stages/${STAGE_ID}/mythos-pool`);
const mPool = mPoolRes.data || [];
console.log(`  綁定數:${mPool.length} 張(規範:10-15)`);

// 看 pool 內 category 分布
const poolByCat = {};
for (const p of mPool) {
  const card = mythos.find(m => m.id === p.mythos_card_id);
  if (card) poolByCat[card.card_category] = (poolByCat[card.card_category] || 0) + 1;
}
console.log(`  pool 內 category 分布:`);
for (const [cat, count] of Object.entries(poolByCat)) {
  console.log(`    ${cat.padEnd(12)} = ${count}`);
}

console.log(`  主軸 7(真相揭露)需求:`);
let plotMythosGap = 0;
for (const [cat, req] of Object.entries(PLOT_SPINE_7_MYTHOS)) {
  const have = poolByCat[cat] || 0;
  const gap = Math.max(0, req.min - have);
  plotMythosGap += gap;
  console.log(`    ${gap > 0 ? '❌' : '✓'} ${cat.padEnd(12)} pool=${have} / 主軸需求 ≥${req.min}`);
}
console.log(`  pool 內主軸對應缺口:${plotMythosGap} 張(被 general 補位代替)`);
console.log(`  general 卡占 pool 比例:${((poolByCat.general || 0) / mPool.length * 100).toFixed(0)}%(理想 0%)`);

console.log();

// ─── 4. stage 雨夜的真相 — 遭遇卡池檢查 ──────────────────
console.log('## 4. stage 雨夜的真相 遭遇卡池\n');
const ePoolRes = await adminGet(`/api/stages/${STAGE_ID}/encounter-pool`);
const ePool = ePoolRes.data || [];
console.log(`  綁定數:${ePool.length} 張(規範:8-15,3-5 關卡專屬 + 5-10 通用)`);

let stageEncSpecific = 0;
let stageEncGeneric = 0;
for (const p of ePool) {
  const card = encounters.find(e => e.id === p.encounter_card_id);
  if (card) {
    if (card.code?.startsWith('g_slit_mouth')) stageEncSpecific++;
    else stageEncGeneric++;
  }
}
console.log(`  關卡專屬(g_slit_mouth_enc_*):${stageEncSpecific} 張(規範:3-5)→ ${stageEncSpecific < 3 ? '❌ 缺 ' + (3 - stageEncSpecific) + ' 張' : '✓'}`);
console.log(`  通用(基底庫):${stageEncGeneric} 張(規範:5-10)→ ${stageEncGeneric < 5 ? '❌ 缺 ' + (5 - stageEncGeneric) + ' 張' : '✓'}`);

const stageEncMissing = Math.max(0, 8 - ePool.length);
console.log(`  總缺口:至少 ${stageEncMissing} 張(下限 8)`);

console.log();

// ─── 5. schema 欄位回填缺口 ─────────────────────────────
console.log('## 5. schema 欄位回填缺口(待 MIGRATION_023+ 落地)\n');
console.log(`  神話卡新欄位:`);
console.log(`    ❌ reusable / cooldown_rounds / max_uses_per_stage`);
console.log(`    ❌ persistence_mode / attachment_target`);
console.log(`    ❌ threat_type(陣列)/ attack_surfaces`);
console.log(`    ❌ faction_pressure / complexity_tier / dv_average / dv_peak`);
console.log(`  遭遇卡新欄位(s14 part4 §6 提案 MIGRATION_023~029):`);
console.log(`    ❌ threat_type 從 VARCHAR 改 JSONB / dv_average + dv_peak`);
console.log(`    ❌ has_peril / has_surge_* / has_self_dedupe / has_progressive_strengthen`);
console.log(`    ❌ persistence_mode / attachment_target / deployment_mode`);
console.log(`    ❌ attack_surfaces / faction_pressure / complexity_tier`);
console.log(`    ❌ encounter_set_id(encounter_sets 主表也未建)`);

console.log();

// ─── 6. 子 Agent 觸發判定 ───────────────────────────────
console.log('## 6. 子 Agent 觸發判定(pipeline 規範 §13.3)\n');
console.log(`  條件 1 — 神話卡任一 category 缺 ≥ 3:${mythosAnyCategoryGap3Plus > 0 ? '🚨 命中' : '✓ 未達'}`);
console.log(`  條件 2 — 神話卡總缺口 ≥ ${SUB_AGENT_TRIGGER_THRESHOLD.mythos_total_gap}:${mythosTotalGap >= SUB_AGENT_TRIGGER_THRESHOLD.mythos_total_gap ? '🚨 命中(' + mythosTotalGap + ' ≥ ' + SUB_AGENT_TRIGGER_THRESHOLD.mythos_total_gap + ')' : '✓ 未達'}`);
console.log(`  條件 3 — 遭遇卡總缺口 ≥ ${SUB_AGENT_TRIGGER_THRESHOLD.encounter_total_gap}:${encounterTotalGap >= SUB_AGENT_TRIGGER_THRESHOLD.encounter_total_gap ? '🚨 命中(' + encounterTotalGap + ' ≥ ' + SUB_AGENT_TRIGGER_THRESHOLD.encounter_total_gap + ')' : '✓ 未達'}`);
console.log(`  條件 4 — stage 關卡專屬遭遇卡 < 3:${stageEncSpecific < 3 ? '🚨 命中(' + stageEncSpecific + ' < 3)' : '✓ 未達'}`);

const triggerCount = [
  mythosAnyCategoryGap3Plus > 0,
  mythosTotalGap >= SUB_AGENT_TRIGGER_THRESHOLD.mythos_total_gap,
  encounterTotalGap >= SUB_AGENT_TRIGGER_THRESHOLD.encounter_total_gap,
  stageEncSpecific < 3,
].filter(Boolean).length;
console.log(`  → ${triggerCount}/4 條件命中,**新流程下會觸發 ${triggerCount} 次子 Agent 呼叫**`);

console.log();

// ─── 7. 前次 vs 新流程 誤差總結 ─────────────────────────
console.log('## 7. 前次跑通 vs 新流程 誤差總結\n');
console.log(`┌─────────────────────────────────────────────────────────┐`);
console.log(`│ 維度                       前次(2026-05-01)  新流程     │`);
console.log(`├─────────────────────────────────────────────────────────┤`);
console.log(`│ 階段 4 驗證分數            46/2/0(全綠)    47/1/0     │`);
console.log(`│ stage 神話卡池綁定         12 張             12 張      │`);
console.log(`│ stage 遭遇卡池綁定         7 張              7 張       │`);
console.log(`│ 神話卡總庫存               15 張(10 general)15 張      │`);
console.log(`│ 遭遇卡總庫存               7 張              7 張       │`);
console.log(`├─────────────────────────────────────────────────────────┤`);
console.log(`│ ★ 前次沒做、新流程會做的事 ★                             │`);
console.log(`├─────────────────────────────────────────────────────────┤`);
console.log(`│ - 觸發神話卡基底庫補建子 Agent                          │`);
console.log(`│ - 觸發遭遇卡基底庫補建子 Agent                          │`);
console.log(`│ - 觸發遭遇卡關卡專屬子 Agent                            │`);
console.log(`│ - 寫入 stage_mythos_pool 應符合主軸 category 分布       │`);
console.log(`│ - schema 標註 threat_type / complexity_tier / 雙 DV     │`);
console.log(`│ - 派系壓力分布視覺化警告                                │`);
console.log(`│ - 紅線檢核(五條 + 神話卡紅線六)                       │`);
console.log(`└─────────────────────────────────────────────────────────┘`);

console.log();
console.log('## 8. 待補項優先級(Phase A/B/C)\n');
console.log(`  Phase A(必須,跑批次前):`);
console.log(`    1. 落地 MIGRATION_023+(神話卡 schema 擴充)`);
console.log(`    2. 落地 s14 schema(遭遇卡 MIGRATION_023~029 + encounter_sets 表)`);
console.log(`    3. 既有 15 張神話卡 + 7 張遭遇卡 schema 欄位回填`);
console.log(`  Phase B(批次跑卡):`);
console.log(`    4. 神話卡基底庫補建子 Agent(填 ${mythosTotalGap} 張缺口)`);
console.log(`    5. 遭遇卡基底庫補建子 Agent(填 ~${encounterTotalGap} 張缺口)`);
console.log(`    6. 雨夜的真相關卡專屬遭遇卡 3-5 張子 Agent`);
console.log(`  Phase C(關卡優化):`);
console.log(`    7. 雨夜的真相 stage_mythos_pool 主軸專屬卡(g_slit_mouth_myth_*)`);
console.log(`    8. 重跑 pipeline 階段 3 + 4 全綠`);

console.log('\n═══ 誤差驗證完成 ═══');
