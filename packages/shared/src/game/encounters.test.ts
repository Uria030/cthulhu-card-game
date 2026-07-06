/**
 * G-08 遭遇卡引擎測試 — 觸發/結算/AI 選項(合成內容,等 Gemini 量產接上)
 */
import {
  availableTalismansForEncounter,
  drawAndAutoResolveEncounter,
  drawEncounter,
  drawTriggeredEncounter,
  normaliseEncounterTriggerConfig,
  resolveEncounterOption,
  resolveEncounterWithTalisman,
  talismanTollCost,
  chooseEncounterOption,
} from './encounters';
import type { EncounterCardData } from './encounters';
import type { InvestigatorState, ScenarioState } from './state';
import type { EnemyDataLookup } from './monsterActions';
import type { CardDataLookup } from './ruleEngine';

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
  subroutines: [
    { id: 'sr1', encounter_card_id: 'ec1', sub_order: 1, effect_description: '低語鑽入', mechanics: {} },
    { id: 'sr2', encounter_card_id: 'ec1', sub_order: 2, effect_description: '影子追上', mechanics: {} },
  ],
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

const TALISMANS: CardDataLookup = {
  instant_amulet: {
    name_zh: '銀製護身符',
    card_type: 'asset',
    is_talisman: true,
    target_threat_types: ['mental'],
    break_timing: 'instant',
    break_strength_max: 5,
    break_charge_label: '神聖度',
    break_charge_max: 5,
  },
  test_badge: {
    name_zh: '警徽',
    card_type: 'asset',
    is_talisman: true,
    target_threat_types: ['mental'],
    break_timing: 'test',
    break_strength_max: 5,
    break_charge_label: '共鳴',
    break_charge_max: 3,
    break_test_attribute: 'willpower',
  },
  stockpile_crystal: {
    name_zh: '預兆水晶',
    card_type: 'asset',
    is_talisman: true,
    target_threat_types: ['mental'],
    break_timing: 'stockpile',
    break_charge_label: '預兆',
    break_charge_max: 6,
  },
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

test('逐人回合結束:每位調查員各抽 1 張,池空不炸', () => {
  const cfg = normaliseEncounterTriggerConfig({ draw_on_turn_end: true });
  let deck = [CARD, { ...CARD, id: 'ec2', name_zh: '第二張遭遇' }];
  let sc = makeScenario();

  const a = drawAndAutoResolveEncounter(deck, cfg, { path: 'turn_end' }, makeInv({ investigatorId: 'i1' }), sc, ENEMY, roll(1));
  deck = a.remaining;
  sc = a.scenario;
  assertEq(a.triggered, true);
  assertEq(a.effects.some((e) => e.type === 'encounter_drawn' && e.targetId === 'i1'), true);
  assertEq(deck.length, 1);

  const b = drawAndAutoResolveEncounter(deck, cfg, { path: 'turn_end' }, makeInv({ investigatorId: 'i2' }), sc, ENEMY, roll(1));
  deck = b.remaining;
  sc = b.scenario;
  assertEq(b.triggered, true);
  assertEq(b.effects.some((e) => e.type === 'encounter_drawn' && e.targetId === 'i2'), true);
  assertEq(deck.length, 0);

  const c = drawAndAutoResolveEncounter(deck, cfg, { path: 'turn_end' }, makeInv({ investigatorId: 'i3' }), sc, ENEMY, roll(1));
  assertEq(c.triggered, false, '空池不炸');
  assertEq(c.remaining.length, 0);
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

test('法器即時型:過路費 f(S,N)=ceil(S/2)+N,破除遭遇但不吃通用解懲罰', () => {
  const inv = makeInv({ assetsInPlay: ['instant_amulet'], assetState: { instant_amulet: { usesLeft: 5, exhausted: false } } });
  assertEq(talismanTollCost(TALISMANS.instant_amulet, CARD), 3);
  assertEq(availableTalismansForEncounter(inv, TALISMANS, CARD).length, 1);

  const r = resolveEncounterWithTalisman('instant_amulet', TALISMANS.instant_amulet, CARD, inv, makeScenario(), ENEMY, {
    fallbackOption: CARD.options[1],
  });
  assertEq(r.outcome, 'broken');
  assertEq(r.investigator.assetState?.instant_amulet.usesLeft, 2);
  assertEq(r.scenario.agendaProgress, 0, '法器破除不推通用解毀滅');
  assertEq(r.effects.some((e) => e.type === 'talisman_break_success'), true);

  const generic = resolveEncounterOption(CARD.options[1], makeInv(), makeScenario(), ENEMY, roll(10));
  assertEq(generic.scenario.agendaProgress, 1, '通用解會推 1 毀滅');
});

test('法器檢定型:固定付 1 費用,成功時完全破除', () => {
  const inv = makeInv({
    assetsInPlay: ['test_badge'],
    assetState: { test_badge: { usesLeft: 3, exhausted: false } },
  });
  const r = resolveEncounterWithTalisman('test_badge', TALISMANS.test_badge, CARD, inv, makeScenario(), ENEMY, {
    fallbackOption: CARD.options[0],
    rng: roll(19),
  });
  assertEq(r.outcome, 'broken');
  assertEq(r.tollCost, 1);
  assertEq(r.investigator.assetState?.test_badge.usesLeft, 2);
  assertEq(r.check?.outcome, 'success');
  assertEq(r.effects.some((e) => e.type === 'talisman_check'), true);
  assertEq(r.investigator.san, 9);
});

test('法器檢定型:失敗時費用照扣,遭遇卡照常觸發', () => {
  const inv = makeInv({
    attributes: { ...makeInv().attributes, willpower: 0 },
    assetsInPlay: ['test_badge'],
    assetState: { test_badge: { usesLeft: 3, exhausted: false } },
  });
  const r = resolveEncounterWithTalisman('test_badge', TALISMANS.test_badge, CARD, inv, makeScenario(), ENEMY, {
    fallbackOption: CARD.options[0],
    rng: roll(1),
  });
  assertEq(r.outcome, 'failed');
  assertEq(r.investigator.assetState?.test_badge.usesLeft, 2);
  assertEq(r.check?.outcome, 'fail');
  assertEq(r.investigator.san, 7, '失敗套用 fallback failure_effects');
});

test('法器檢定型:缺 break_test_attribute 時不可出現在可用候選,且不扣費', () => {
  const brokenLookup: CardDataLookup = {
    broken_badge: { ...TALISMANS.test_badge, break_test_attribute: null },
  };
  const inv = makeInv({
    assetsInPlay: ['broken_badge'],
    assetState: { broken_badge: { usesLeft: 3, exhausted: false } },
  });
  assertEq(availableTalismansForEncounter(inv, brokenLookup, CARD).length, 0);
  const r = resolveEncounterWithTalisman('broken_badge', brokenLookup.broken_badge, CARD, inv, makeScenario(), ENEMY);
  assertEq(r.outcome, 'unavailable');
  assertEq(r.reason, 'missing_test_attribute');
  assertEq(r.investigator.assetState?.broken_badge.usesLeft, 3);
});

test('法器儲蓄型:f(S,N)=S,用累積計量直接破除', () => {
  const inv = makeInv({
    assetsInPlay: ['stockpile_crystal'],
    assetState: { stockpile_crystal: { usesLeft: 6, exhausted: false } },
  });
  const r = resolveEncounterWithTalisman('stockpile_crystal', TALISMANS.stockpile_crystal, CARD, inv, makeScenario(), ENEMY);
  assertEq(r.outcome, 'broken');
  assertEq(r.tollCost, 2);
  assertEq(r.investigator.assetState?.stockpile_crystal.usesLeft, 4);
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
