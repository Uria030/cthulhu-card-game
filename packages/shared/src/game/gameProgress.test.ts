/**
 * G-02 幕/議程/結局單元測試 — 對齊裂嘴女資料形狀
 */
import { progressTick, evaluateOutcome, applyOutcomeFlags, addDoom, allInvestigatorsDown } from './gameProgress';
import type { ActCardData, AgendaCardData, OutcomeData } from './gameProgress';
import type { ScenarioState, InvestigatorState } from './state';
import type { EnemyDataLookup } from './monsterActions';

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
  assertEq(r.scenario.enemies[0].modifiers.includes('regen_boost'), true);
});

test('議程三翻面:defeat 訊號', () => {
  const sc = makeScenario({ agendaIndex: 2, agendaProgress: 4 });
  const r = progressTick(sc, {}, ACTS, AGENDAS, ENEMY_DATA);
  assertEq(r.defeat, true);
});

test('addDoom 累積', () => {
  const r = addDoom(makeScenario({ agendaProgress: 2 }), 1);
  assertEq(r.scenario.agendaProgress, 3);
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
