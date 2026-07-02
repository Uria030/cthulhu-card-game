/**
 * G-08 遭遇卡引擎測試 — 觸發/結算/AI 選項(合成內容,等 Gemini 量產接上)
 */
import {
  drawEncounter,
  drawTriggeredEncounter,
  normaliseEncounterTriggerConfig,
  resolveEncounterOption,
  chooseEncounterOption,
} from './encounters';
import type { EncounterCardData } from './encounters';
import type { InvestigatorState, ScenarioState } from './state';
import type { EnemyDataLookup } from './monsterActions';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

function makeInv(over: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: 'i1', investigatorDefinitionId: 'd', ownerPlayerId: 'p',
    attributes: { strength: 1, agility: 2, constitution: 2, reflex: 1, intellect: 4, willpower: 2, perception: 3, charisma: 1 },
    combatStyle: '', specializations: [], deck: ['x1'], hand: [], discardPile: [], removedPile: [], assetsInPlay: [],
    hp: 9, hpMax: 9, san: 9, sanMax: 9, actionPoints: 3, resources: 0, currentLocationId: 'A',
    engagedWith: [], triggeredHorrorChecks: [], traumas: [], secretTaskState: null, permanentlyDead: false, startingXp: 0,
    ...over,
  };
}
function makeScenario(): ScenarioState {
  return {
    scenarioId: 's', scenarioDefinitionId: 's', campaignId: 'c',
    locations: [{ locationDefinitionId: 'A', visibility: 'night', connectedTo: [], isObstacle: false }],
    unlockedLocations: ['A'], enemies: [], tokens: [], agendaProgress: 0, objectiveProgress: 0,
    chaosBag: [], turnNumber: 1, phase: 'investigator',
  };
}
const ENEMY: EnemyDataLookup = { rev: { name_zh: '深潛者亡靈', tier: 1, hp_base: 4 } };
const roll = (n: number) => () => (n - 1) / 20;

// 合成遭遇卡(資料形狀對齊 DB,內容是測試用)
const CARD: EncounterCardData = {
  id: 'ec1', name_zh: '磚牆異響', threat_type: 'mental', threat_strength: 2,
  options: [
    {
      option_label: 'A', requires_check: true, check_attribute: 'willpower', check_dc: 13,
      success_narrative_zh: '你穩住了心神。',
      failure_narrative_zh: '低語鑽進了你的腦子。',
      success_effects: [{ effect_code: 'discover_clue', amount: 1 }],
      failure_effects: [{ effect_code: 'deal_horror', amount: 2 }],
    },
    {
      option_label: 'B', requires_check: false,
      no_check_narrative_zh: '你選擇繞道而行。',
      no_check_effects: [{ effect_code: 'place_doom', amount: 1 }],
    },
  ],
};

test('抽卡:從牌堆抽 1 張,不洗回(抽完即無)', () => {
  const deck = [CARD, { ...CARD, id: 'ec2', name_zh: '低語入耳' }];
  const d = drawEncounter(deck, roll(1));
  assertEq(d.card?.id, 'ec1');
  assertEq(d.remaining.length, 1);
  assertEq(drawEncounter([], roll(1)).card, null);
});

test('觸發:四條路徑都能抽遭遇', () => {
  const cfg = normaliseEncounterTriggerConfig({
    draw_on_turn_end: true,
    trigger_locations: ['B'],
    trigger_actions: ['search'],
  });
  assertEq(drawTriggeredEncounter([CARD], cfg, { path: 'turn_end' }, roll(1)).triggered, true);
  assertEq(drawTriggeredEncounter([CARD], cfg, { path: 'chaos_headline', chaosTokenType: 'headline' }, roll(1)).triggered, true);
  assertEq(drawTriggeredEncounter([CARD], cfg, { path: 'keeper_mythos', mythosCardCategory: 'encounter' }, roll(1)).triggered, true);
  assertEq(drawTriggeredEncounter([CARD], cfg, { path: 'player_action', locationId: 'B' }, roll(1)).triggered, true);
  assertEq(drawTriggeredEncounter([CARD], cfg, { path: 'player_action', actionType: 'search' }, roll(1)).triggered, true);
});

test('觸發:未命中條件時不消耗牌堆', () => {
  const deck = [CARD];
  const d = drawTriggeredEncounter(deck, normaliseEncounterTriggerConfig({ trigger_locations: ['B'] }), {
    path: 'player_action',
    locationId: 'A',
  }, roll(1));
  assertEq(d.triggered, false);
  assertEq(d.card, null);
  assertEq(d.remaining.length, 1);
});

test('結算:檢定成功 → success_effects(得線索)', () => {
  // 意志 2 + roll 19 = 21 ≥ 13 → 成功
  const r = resolveEncounterOption(CARD.options[0], makeInv(), makeScenario(), ENEMY, roll(19));
  assertEq(r.scenario.objectiveProgress, 1);
  assertEq(r.effects.some((e) => e.type === 'gain_clue'), true);
});

test('結算:檢定失敗 → failure_effects(受恐懼)', () => {
  // 意志 2 + roll 2 = 4 < 13 → 失敗
  const r = resolveEncounterOption(CARD.options[0], makeInv(), makeScenario(), ENEMY, roll(2));
  assertEq(r.investigator.san, 7, '受 2 恐懼');
  assertEq(r.effects.some((e) => e.type === 'fear_damage'), true);
});

test('結算:無檢定選項 → no_check_effects(推毀滅)', () => {
  const r = resolveEncounterOption(CARD.options[1], makeInv(), makeScenario(), ENEMY, roll(10));
  assertEq(r.scenario.agendaProgress, 1);
});

test('結算:spawn_enemy 生成怪物', () => {
  const card = { option_label: 'X', requires_check: false, no_check_effects: [{ effect_code: 'spawn_enemy', variant_code: 'rev', location_code: 'A' }] };
  const r = resolveEncounterOption(card, makeInv(), makeScenario(), ENEMY, roll(10));
  assertEq(r.scenario.enemies.length, 1);
  assertEq(r.scenario.enemies[0].enemyDefinitionId, 'rev');
});

test('AI 選項:高意志選檢定(賭得過),低意志選繞道避傷', () => {
  // 高 DC 卡:讓成功率對屬性敏感
  const hardCard = { ...CARD, options: [{ ...CARD.options[0], check_dc: 18 }, CARD.options[1]] };
  // 意志 5 vs DC18:成功率尚可,期望得線索 → 選 A
  const smart = chooseEncounterOption(hardCard, makeInv({ attributes: { ...makeInv().attributes, willpower: 5 } }));
  assertEq(smart, 0);
  // 意志 1 vs DC18:成功率極低,失敗吃 2 恐懼 → 繞道(B 只推 1 毀滅,對個人無傷)
  const weak = chooseEncounterOption(hardCard, makeInv({ attributes: { ...makeInv().attributes, willpower: 1 } }));
  assertEq(weak, 1);
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
