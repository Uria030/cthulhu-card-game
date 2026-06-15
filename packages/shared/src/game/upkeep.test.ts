/**
 * G-05 回合經濟測試 — ch2 §2.4 + ch6 §3.1/§8
 */
import { runTurnEndUpkeep, runTurnStartUpkeep, runShortRest, hpMaxFor, sanMaxFor, HAND_LIMIT, STARTING_RESOURCES } from './upkeep';
import type { InvestigatorState } from './state';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

function makeInv(over: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: 'i1', investigatorDefinitionId: 'd', ownerPlayerId: 'p',
    attributes: { strength: 1, agility: 2, constitution: 2, reflex: 1, intellect: 4, willpower: 2, perception: 1, charisma: 1 },
    combatStyle: '', specializations: [], deck: ['d1', 'd2'], hand: ['h1'], discardPile: [], removedPile: [], assetsInPlay: [],
    hp: 9, hpMax: 9, san: 9, sanMax: 9, actionPoints: 0, resources: 0, currentLocationId: 'A',
    engagedWith: [], triggeredHorrorChecks: [], traumas: [], secretTaskState: null, permanentlyDead: false, startingXp: 0,
    ...over,
  };
}

test('生命公式:體質×2+5 / 意志×2+5(ch6 §3.1)', () => {
  assertEq(hpMaxFor(1), 7);
  assertEq(hpMaxFor(5), 15);
  assertEq(hpMaxFor(10), 25);
  assertEq(sanMaxFor(3), 11);
});

test('經濟常數:起始 5 資源/手牌上限 8(ch6 §8)', () => {
  assertEq(STARTING_RESOURCES, 5);
  assertEq(HAND_LIMIT, 8);
});

test('回合結束:抽 1 卡 + 1 資源', () => {
  const r = runTurnEndUpkeep(makeInv());
  assertEq(r.investigator.hand.length, 2);
  assertEq(r.investigator.deck.length, 1);
  assertEq(r.investigator.resources, 1);
  assertEq(r.effects.filter((e) => e.type === 'upkeep_draw').length, 1);
  assertEq(r.effects.filter((e) => e.type === 'upkeep_income').length, 1);
});

test('回合結束:空牌庫抽牌 → 1 恐懼,不重洗(ch2 §3.3)', () => {
  const r = runTurnEndUpkeep(makeInv({ deck: [], discardPile: ['x1', 'x2'] }));
  assertEq(r.investigator.san, 8);
  assertEq(r.investigator.deck.length, 0, '不自動重洗');
  assertEq(r.effects.some((e) => e.type === 'deck_empty_horror'), true);
});

test('回合結束:手牌超過 8 棄至上限(棄最舊)', () => {
  const hand = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']; // 8 張 + 抽 1 = 9
  const r = runTurnEndUpkeep(makeInv({ hand }));
  assertEq(r.investigator.hand.length, HAND_LIMIT);
  assertEq(r.investigator.discardPile.includes('a'), true, '最舊的被棄');
  assertEq(r.investigator.hand.includes('d1'), true, '剛抽的留著');
});

test('倒地者不結算補給(§9 瀕死不能行動)', () => {
  const r = runTurnEndUpkeep(makeInv({ hp: 0 }));
  assertEq(r.investigator.resources, 0);
  assertEq(r.effects.length, 0);
});

test('短休息:棄牌堆洗回牌庫 + 放棄行動(§3.1)', () => {
  const r = runShortRest(makeInv({ deck: ['d1'], discardPile: ['x1', 'x2', 'x3'], hand: ['h1'], actionPoints: 3 }), () => 0);
  assertEq(r.investigator.deck.length, 4, '1 + 3 洗回');
  assertEq(r.investigator.discardPile.length, 0, '棄牌堆清空');
  assertEq(r.investigator.actionPoints, 0, '放棄整回合行動');
  assertEq(r.investigator.hand.length, 1, '手牌不動');
  assertEq(r.effects[0].type, 'short_rest');
});

// ─── 狀態效果整合(ch3 §6 接進回合首尾)──
test('回合結束:流血扣 HP + 狀態減 1 層,經濟照常', () => {
  const r = runTurnEndUpkeep(makeInv({ hp: 9, statusEffects: { bleed: 2 } }));
  assertEq(r.investigator.hp, 7, '流血 2 扣 HP');
  assertEq(r.investigator.statusEffects?.bleed ?? 0, 1, '回合末減 1 層');
  assertEq(r.investigator.resources, 1, '非疲勞 → 經濟照常');
  assertEq(r.effects.some((e) => e.type === 'status_bleed'), true);
});

test('回合結束:疲勞封鎖抽牌與收入(§6.2)', () => {
  const r = runTurnEndUpkeep(makeInv({ statusEffects: { fatigue: 2 } }));
  assertEq(r.investigator.resources, 0, '疲勞 → 不獲資源');
  assertEq(r.effects.some((e) => e.type === 'upkeep_draw'), false, '疲勞 → 不抽牌');
  assertEq(r.investigator.statusEffects?.fatigue ?? 0, 1, '疲勞仍減 1 層');
  assertEq(r.effects.some((e) => e.type === 'status_fatigue'), true);
});

test('回合開始:燃燒扣 HP(runTurnStartUpkeep)', () => {
  const r = runTurnStartUpkeep(makeInv({ hp: 9, statusEffects: { burning: 3 } }));
  assertEq(r.investigator.hp, 6);
  assertEq(r.effects.some((e) => e.type === 'status_burning'), true);
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
