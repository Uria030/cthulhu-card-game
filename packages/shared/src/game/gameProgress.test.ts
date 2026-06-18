/**
 * G-02 幕/議程/結局單元測試 — 對齊裂嘴女資料形狀
 */
import { progressTick, evaluateOutcome, applyOutcomeFlags, addDoom, allInvestigatorsDown } from './gameProgress';
import type { ActCardData, AgendaCardData, OutcomeData } from './gameProgress';
import type { ScenarioState, InvestigatorState } from './state';
import type { EnemyDataLookup } from './monsterActions';
import { tickEnemyRegen } from './monsterActions';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

function makeScenario(over: Partial<ScenarioState> = {}): ScenarioState {
  return {
    scenarioId: 's', scenarioDefinitionId: 's', campaignId: 'c',
    locations: [
      { locationDefinitionId: 'A', visibility: 'night', connectedTo: ['B'], isObstacle: false },
      { locationDefinitionId: 'B', visibility: 'night', connectedTo: ['A'], isObstacle: false },
    ],
    unlockedLocations: ['A', 'B'],
    enemies: [], tokens: [], agendaProgress: 0, objectiveProgress: 0,
    chaosBag: [], turnNumber: 1, phase: 'investigator',
    ...over,
  };
}

const ENEMY_DATA: EnemyDataLookup = {
  boss: { name_zh: '深潛者裂嘴女', dc: 14, hp_base: 23, tier: 3, fear_radius: 2, fear_value: 3 },
};

const ACTS: ActCardData[] = [
  {
    card_order: 1, name_zh: '牆上的真相',
    front_advance_condition: { type: 'clue_threshold', count: 2 },
    back_narrative: '沙啞的聲音從背後傳來……',
    back_flag_sets: [],
    back_map_operations: [
      { verb: 'switch_scenario', params: { scenario_order: 2 } },
      { verb: 'spawn_enemy', params: { variant_code: 'boss', location_code: 'B' } },
    ],
    back_resolution_code: null,
  },
  {
    card_order: 2, name_zh: '終結傳說',
    front_advance_condition: { type: 'enemy_defeated', variant_code: 'boss' },
    back_narrative: '恐怖終於倒下。',
    back_flag_sets: [{ flag_code: 'outcome.victory', value: true }],
    back_map_operations: [],
    back_resolution_code: 'stage_complete',
  },
];

const AGENDAS: AgendaCardData[] = [
  { card_order: 1, name_zh: '滂沱', front_doom_threshold: 4, back_narrative: '暴雨封路', back_penalties: [{ type: 'heavy_rain' }] },
  { card_order: 2, name_zh: '潮汐', front_doom_threshold: 4, back_narrative: '傷口癒合', back_penalties: [{ type: 'enemy_regen', variant_code: 'boss', amount: 1 }] },
  { card_order: 3, name_zh: '包圍', front_doom_threshold: 4, back_narrative: '退路斷絕', back_penalties: [{ type: 'investigators_defeated' }], back_resolution_code: 'investigators_defeated' },
];

const OUTCOMES: OutcomeData[] = [
  { outcome_code: 'A', condition_expression: { type: 'flag_check', flag_code: 'outcome.victory', expected: true }, narrative_text: '勝利', flag_sets: [{ flag_code: 'outcome.victory', value: true }, { flag_code: 'choice.innsmouth_lead', value: true }] },
  { outcome_code: 'B', condition_expression: { type: 'flag_check', flag_code: 'outcome.victory', expected: false }, narrative_text: '失敗' },
];

// ─── 幕推進 ─────────────────────────────────
test('幕一:線索達標 → 翻面 + 切場景訊號 + 生成 boss(帶召喚失調)', () => {
  const sc = makeScenario({ objectiveProgress: 2 });
  const r = progressTick(sc, {}, ACTS, AGENDAS, ENEMY_DATA);
  assertEq(r.scenario.actIndex, 1);
  assertEq(r.switchScenario, 2);
  assertEq(r.scenario.enemies.length, 1);
  assertEq(r.scenario.enemies[0].enemyDefinitionId, 'boss');
  assertEq(r.scenario.enemies[0].modifiers.includes('summon_sickness'), true);
  assertEq(r.effects.some((e) => e.type === 'act_advanced'), true);
  assertEq(r.victory, false);
});

test('幕一未達標不動', () => {
  const sc = makeScenario({ objectiveProgress: 1 });
  const r = progressTick(sc, {}, ACTS, AGENDAS, ENEMY_DATA);
  assertEq(r.scenario.actIndex ?? 0, 0);
  assertEq(r.switchScenario, null);
});

test('線索消費:幕翻面扣除需求量(花費而非累積)', () => {
  const sc = makeScenario({ objectiveProgress: 3 }); // 門檻 2,多 1 顆
  const r = progressTick(sc, {}, ACTS, AGENDAS, ENEMY_DATA, 1);
  assertEq(r.scenario.actIndex, 1);
  assertEq(r.scenario.objectiveProgress, 1, '花掉 2 顆剩 1 顆');
  assertEq(r.effects.some((e) => e.type === 'clues_spent'), true);
});

test('人數縮放:四人隊門檻 ×4(技術原則 4)', () => {
  // 4 人 × 2 = 8;7 顆不夠
  const notYet = progressTick(makeScenario({ objectiveProgress: 7 }), {}, ACTS, AGENDAS, ENEMY_DATA, 4);
  assertEq(notYet.scenario.actIndex ?? 0, 0, '7 < 8 不翻面');
  // 8 顆達標,翻面後歸 0
  const ok = progressTick(makeScenario({ objectiveProgress: 8 }), {}, ACTS, AGENDAS, ENEMY_DATA, 4);
  assertEq(ok.scenario.actIndex, 1);
  assertEq(ok.scenario.objectiveProgress, 0);
});

test('幕二:擊敗 boss → 翻面 + 勝利旗標 + victory 訊號', () => {
  const sc = makeScenario({
    actIndex: 1,
    enemies: [{ instanceId: 'e1', enemyDefinitionId: 'boss', locationId: 'B', hp: 0, engagedWith: [], modifiers: [] }],
  });
  const r = progressTick(sc, {}, ACTS, AGENDAS, ENEMY_DATA);
  assertEq(r.victory, true);
  assertEq(r.flags['outcome.victory'], true);
});

// ─── 議程推進 ───────────────────────────────
test('毀滅達門檻:翻面 + 毀滅扣除進下一張', () => {
  const sc = makeScenario({ agendaProgress: 5 });
  const r = progressTick(sc, {}, ACTS, AGENDAS, ENEMY_DATA);
  assertEq(r.scenario.agendaIndex, 1);
  assertEq(r.scenario.agendaProgress, 1); // 5 - 4
  assertEq(r.effects.some((e) => e.type === 'agenda_advanced'), true);
  assertEq(r.defeat, false);
});

test('議程二翻面:boss 獲得再生標記', () => {
  const sc = makeScenario({
    agendaIndex: 1, agendaProgress: 4,
    enemies: [{ instanceId: 'e1', enemyDefinitionId: 'boss', locationId: 'B', hp: 10, engagedWith: [], modifiers: [] }],
  });
  const r = progressTick(sc, {}, ACTS, AGENDAS, ENEMY_DATA);
  assertEq(r.scenario.enemies[0].modifiers.some((m) => m.startsWith('regen_boost:')), true);
});

test('議程三翻面:defeat 訊號', () => {
  const sc = makeScenario({ agendaIndex: 2, agendaProgress: 4 });
  const r = progressTick(sc, {}, ACTS, AGENDAS, ENEMY_DATA);
  assertEq(r.defeat, true);
});

test('enemy_regen_or_spawn:裂嘴女在場→回血', () => {
  const ags = [{ card_order: 1, name_zh: '潮汐', front_doom_threshold: 4, back_penalties: [{ type: 'enemy_regen_or_spawn', variant_code: 'boss', location_code: 'B' }] }];
  const sc = makeScenario({ agendaProgress: 4, enemies: [{ instanceId: 'e1', enemyDefinitionId: 'boss', locationId: 'B', hp: 10, engagedWith: [], modifiers: [] }] });
  const r = progressTick(sc, {}, [], ags, ENEMY_DATA);
  assertEq(r.scenario.enemies[0].modifiers.some((m) => m.startsWith('regen_boost:')), true);
  assertEq(r.scenario.enemies.length, 1, '在場不補生成');
});

test('enemy_regen_or_spawn:裂嘴女不在場→生成在指定地點', () => {
  const ags = [{ card_order: 1, name_zh: '潮汐', front_doom_threshold: 4, back_penalties: [{ type: 'enemy_regen_or_spawn', variant_code: 'boss', location_code: 'B' }] }];
  const sc = makeScenario({ agendaProgress: 4, enemies: [] }); // 不在場
  const r = progressTick(sc, {}, [], ags, ENEMY_DATA);
  assertEq(r.scenario.enemies.length, 1, '補位生成');
  assertEq(r.scenario.enemies[0].enemyDefinitionId, 'boss');
  assertEq(r.scenario.enemies[0].locationId, 'B');
  assertEq(r.effects.some((e) => e.type === 'enemy_spawned'), true);
});

test('addDoom 累積', () => {
  const r = addDoom(makeScenario({ agendaProgress: 2 }), 1);
  assertEq(r.scenario.agendaProgress, 3);
});

// ─── 議程背面效果生效(Uria 2026-06-18:讓議程真的有牙)──────
test('議程一翻面:heavy_rain → 全域移動成本 +1', () => {
  const sc = makeScenario({ agendaIndex: 0, agendaProgress: 4 });
  const r = progressTick(sc, {}, ACTS, AGENDAS, ENEMY_DATA);
  assertEq(r.scenario.globalMoveCostBonus, 1);
});

test('tickEnemyRegen:帶 regen_boost:N 的怪每回合回 N,封頂於最大 HP;無標記不回', () => {
  const sc = makeScenario({ enemies: [{ instanceId: 'e1', enemyDefinitionId: 'boss', locationId: 'B', hp: 20, engagedWith: [], modifiers: ['regen_boost:1'] }] });
  assertEq(tickEnemyRegen(sc, ENEMY_DATA, 1).scenario.enemies[0].hp, 21, '回 1');
  const scMax = makeScenario({ enemies: [{ instanceId: 'e1', enemyDefinitionId: 'boss', locationId: 'B', hp: 23, engagedWith: [], modifiers: ['regen_boost:1'] }] });
  assertEq(tickEnemyRegen(scMax, ENEMY_DATA, 1).scenario.enemies[0].hp, 23, '已滿(max 23)不超過');
  const scNo = makeScenario({ enemies: [{ instanceId: 'e1', enemyDefinitionId: 'boss', locationId: 'B', hp: 10, engagedWith: [], modifiers: [] }] });
  assertEq(tickEnemyRegen(scNo, ENEMY_DATA, 1).scenario.enemies[0].hp, 10, '無標記不回血');
});

// ─── 結局判定 ───────────────────────────────
test('勝利旗標 → 結局 A;無旗標 → 結局 B', () => {
  assertEq(evaluateOutcome(OUTCOMES, { 'outcome.victory': true })?.outcome_code, 'A');
  assertEq(evaluateOutcome(OUTCOMES, {})?.outcome_code, 'B');
});

test('applyOutcomeFlags 寫回戰役旗標', () => {
  const fl = applyOutcomeFlags(OUTCOMES[0], {});
  assertEq(fl['choice.innsmouth_lead'], true);
});

// ─── 全滅 ───────────────────────────────────
test('allInvestigatorsDown:HP 或 SAN 歸零視為倒下', () => {
  const inv = (hp: number, san: number): InvestigatorState => ({
    investigatorId: 'i', investigatorDefinitionId: 'd', ownerPlayerId: 'p',
    attributes: { strength: 1, agility: 1, constitution: 1, reflex: 1, intellect: 1, willpower: 1, perception: 1, charisma: 1 },
    combatStyle: '', specializations: [], deck: [], hand: [], discardPile: [], removedPile: [], assetsInPlay: [],
    hp, hpMax: 7, san, sanMax: 7, actionPoints: 0, resources: 0, currentLocationId: 'A',
    engagedWith: [], triggeredHorrorChecks: [], traumas: [], secretTaskState: null, permanentlyDead: false, startingXp: 0,
  });
  assertEq(allInvestigatorsDown({ a: inv(0, 5) }), true);
  assertEq(allInvestigatorsDown({ a: inv(5, 5) }), false);
});

// ─── §14.1 五大任務類型 ─────────────────────
function makeInv(over: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: 'i1', investigatorDefinitionId: 'd', ownerPlayerId: 'p',
    attributes: { strength: 1, agility: 1, constitution: 1, reflex: 1, intellect: 1, willpower: 1, perception: 1, charisma: 1 },
    combatStyle: '', specializations: [], deck: [], hand: [], discardPile: [], removedPile: [], assetsInPlay: [],
    hp: 7, hpMax: 7, san: 7, sanMax: 7, actionPoints: 0, resources: 0, currentLocationId: 'A',
    engagedWith: [], triggeredHorrorChecks: [], traumas: [], secretTaskState: null, permanentlyDead: false, startingXp: 0,
    ...over,
  };
}

const TITAN_DATA: EnemyDataLookup = {
  ...ENEMY_DATA,
  titan: { name_zh: '舊日支配者', dc: 18, hp_base: 60, tier: 5, fear_radius: 3, fear_value: 5 },
};

function actWith(cond: Record<string, unknown>): ActCardData[] {
  return [{
    card_order: 1, name_zh: '任務目標',
    front_advance_condition: cond,
    back_flag_sets: [{ flag_code: 'outcome.victory', value: true }],
    back_map_operations: [], back_resolution_code: 'stage_complete',
  }];
}

test('seal_gate:線索達標 + 旗標(通過儀式)兩者皆需 → 翻面並花線索', () => {
  const acts = actWith({ type: 'seal_gate', count: 2, required_flag: 'ritual.sealed' });
  // 只有線索不夠(缺旗標)
  const notYet = progressTick(makeScenario({ objectiveProgress: 2 }), {}, acts, [], ENEMY_DATA, 1);
  assertEq(notYet.scenario.actIndex ?? 0, 0, '缺旗標不推進');
  // 線索 + 旗標 → 推進,並花掉 2 顆線索
  const ok = progressTick(makeScenario({ objectiveProgress: 3 }), { 'ritual.sealed': true }, acts, [], ENEMY_DATA, 1);
  assertEq(ok.scenario.actIndex, 1);
  assertEq(ok.scenario.objectiveProgress, 1, '花掉 2 顆剩 1');
  assertEq(ok.victory, true);
});

test('seal_gate:線索需求隨人數縮放(雙人 ×2)', () => {
  const acts = actWith({ type: 'seal_gate', count: 2 }); // 無旗標需求
  const notYet = progressTick(makeScenario({ objectiveProgress: 3 }), {}, acts, [], ENEMY_DATA, 2);
  assertEq(notYet.scenario.actIndex ?? 0, 0, '雙人需 4 顆,3 不夠');
  const ok = progressTick(makeScenario({ objectiveProgress: 4 }), {}, acts, [], ENEMY_DATA, 2);
  assertEq(ok.scenario.actIndex, 1);
});

test('defeat_titan:巨頭(tier≥5)倒下 → 翻面;非巨頭不算', () => {
  const acts = actWith({ type: 'defeat_titan' });
  const titanDown = makeScenario({ enemies: [{ instanceId: 'e1', enemyDefinitionId: 'titan', locationId: 'B', hp: 0, engagedWith: [], modifiers: [] }] });
  assertEq(progressTick(titanDown, {}, acts, [], TITAN_DATA, 1).scenario.actIndex, 1);
  const bossDown = makeScenario({ enemies: [{ instanceId: 'e1', enemyDefinitionId: 'boss', locationId: 'B', hp: 0, engagedWith: [], modifiers: [] }] });
  assertEq(progressTick(bossDown, {}, acts, [], TITAN_DATA, 1).scenario.actIndex ?? 0, 0, 'tier 3 boss 不是巨頭');
});

test('defeat_titan:指定 variant_code → 只認該隻', () => {
  const acts = actWith({ type: 'defeat_titan', variant_code: 'titan' });
  const sc = makeScenario({ enemies: [{ instanceId: 'e1', enemyDefinitionId: 'titan', locationId: 'B', hp: 0, engagedWith: [], modifiers: [] }] });
  assertEq(progressTick(sc, {}, acts, [], TITAN_DATA, 1).scenario.actIndex, 1);
});

test('uncover_truth:真相旗標 → 翻面(不花線索)', () => {
  const acts = actWith({ type: 'uncover_truth', truth_flag: 'truth.revealed', count: 3 });
  const r = progressTick(makeScenario({ objectiveProgress: 0 }), { 'truth.revealed': true }, acts, [], ENEMY_DATA, 1);
  assertEq(r.scenario.actIndex, 1, '旗標到位即翻面');
  assertEq(r.scenario.objectiveProgress, 0, 'uncover_truth 不消費線索');
});

test('uncover_truth:無旗標但線索累積達標 → 翻面', () => {
  const acts = actWith({ type: 'uncover_truth', truth_flag: 'truth.revealed', count: 3 });
  const r = progressTick(makeScenario({ objectiveProgress: 3 }), {}, acts, [], ENEMY_DATA, 1);
  assertEq(r.scenario.actIndex, 1);
});

test('escape:全員存活調查員抵達目標地點 → 翻面;有人未到不算', () => {
  const acts = actWith({ type: 'escape', location_code: 'B' });
  const allAtB = { i1: makeInv({ investigatorId: 'i1', currentLocationId: 'B' }), i2: makeInv({ investigatorId: 'i2', currentLocationId: 'B' }) };
  assertEq(progressTick(makeScenario(), {}, acts, [], ENEMY_DATA, 2, allAtB).scenario.actIndex, 1);
  const oneAtA = { i1: makeInv({ investigatorId: 'i1', currentLocationId: 'B' }), i2: makeInv({ investigatorId: 'i2', currentLocationId: 'A' }) };
  assertEq(progressTick(makeScenario(), {}, acts, [], ENEMY_DATA, 2, oneAtA).scenario.actIndex ?? 0, 0, '一人沒到不算逃脫');
});

test('escape:已死亡調查員不納入「全員到位」判定', () => {
  const acts = actWith({ type: 'escape', location_code: 'B' });
  // i2 已永久死亡留在 A,只看存活的 i1 在 B → 逃脫成功
  const party = { i1: makeInv({ investigatorId: 'i1', currentLocationId: 'B' }), i2: makeInv({ investigatorId: 'i2', currentLocationId: 'A', permanentlyDead: true }) };
  assertEq(progressTick(makeScenario(), {}, acts, [], ENEMY_DATA, 2, party).scenario.actIndex, 1);
});

test('endurance:撐到指定回合 → 翻面;未到回合不算', () => {
  const acts = actWith({ type: 'endurance', turns: 5 });
  assertEq(progressTick(makeScenario({ turnNumber: 5 }), {}, acts, [], ENEMY_DATA, 1).scenario.actIndex, 1);
  assertEq(progressTick(makeScenario({ turnNumber: 4 }), {}, acts, [], ENEMY_DATA, 1).scenario.actIndex ?? 0, 0, '第 4 回合還沒到');
});

// ─── runner ─────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed += 1; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('✗ ' + t.name + '\n   ' + msg); failed += 1; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
