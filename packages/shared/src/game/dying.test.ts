/**
 * G-07 瀕死與救援測試 — ch2 §9 全規格
 */
import {
  isDowned, isStanding, syncDownedState, runDeathSave, applyStabilize, allInvestigatorsDead,
} from './dying';
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
    combatStyle: '', specializations: [], deck: [], hand: [], discardPile: [], removedPile: [], assetsInPlay: [],
    hp: 9, hpMax: 9, san: 9, sanMax: 9, actionPoints: 0, resources: 0, currentLocationId: 'A',
    engagedWith: [], triggeredHorrorChecks: [], traumas: [], secretTaskState: null, permanentlyDead: false, startingXp: 0,
    ...over,
  };
}

// rng 注入:rollD20 = floor(rng*20)+1 → 要骰 N 給 (N-1)/20
const roll = (n: number) => () => (n - 1) / 20;

test('倒地同步:HP 歸零 → downed + 計數歸零(冪等)', () => {
  const r = syncDownedState(makeInv({ hp: 0 }));
  assertEq(r.investigator.downed, true);
  assertEq(r.effects.some((e) => e.type === 'investigator_downed'), true);
  const again = syncDownedState(r.investigator);
  assertEq(again.effects.length, 0, '已倒地不重複敘事');
});

test('治療拉起:兩值回正 → 解除瀕死(§9.5)', () => {
  const downed = syncDownedState(makeInv({ hp: 0 })).investigator;
  const healed = syncDownedState({ ...downed, hp: 3 });
  assertEq(healed.investigator.downed, false);
  assertEq(healed.effects.some((e) => e.type === 'investigator_revived'), true);
});

test('瀕死檢定:≥10 成功累積;3 次站起,歸零值恢復 1', () => {
  let inv = syncDownedState(makeInv({ hp: 0 })).investigator;
  inv = runDeathSave(inv, roll(15)).investigator;
  inv = runDeathSave(inv, roll(10)).investigator;
  assertEq(inv.deathSaveSuccesses, 2);
  const third = runDeathSave(inv, roll(12));
  assertEq(third.investigator.downed, false);
  assertEq(third.investigator.hp, 1, '歸零值恢復 1');
  assertEq(third.effects.some((e) => e.type === 'death_save_stand'), true);
});

test('瀕死檢定:天 20 直接站起(§9.3)', () => {
  const inv = syncDownedState(makeInv({ san: 0 })).investigator;
  const r = runDeathSave(inv, roll(20));
  assertEq(r.investigator.downed, false);
  assertEq(r.investigator.san, 1);
});

test('瀕死檢定:天 1 算 2 次失敗;3 失敗死亡,歸零項上限 -1 + 創傷', () => {
  let inv = syncDownedState(makeInv({ hp: 0 })).investigator;
  inv = runDeathSave(inv, roll(1)).investigator; // 2 failures
  assertEq(inv.deathSaveFailures, 2);
  const r = runDeathSave(inv, roll(3)); // 第 3 次失敗
  assertEq(r.investigator.dead, true);
  assertEq(r.investigator.hpMax, 8, '歸零項上限 -1');
  assertEq(r.investigator.traumas.length, 1);
  assertEq(r.investigator.traumas[0].type, 'physical');
  assertEq(r.investigator.permanentlyDead, false, '上限未歸零,非永久死亡');
});

test('雙歸零:死亡時 HP/SAN 上限各 -1;上限減至 0 → 永久死亡(§9.4/9.6)', () => {
  let inv = syncDownedState(makeInv({ hp: 0, san: 0, hpMax: 1, sanMax: 9 })).investigator;
  inv = runDeathSave(inv, roll(2)).investigator;
  inv = runDeathSave(inv, roll(2)).investigator;
  const r = runDeathSave(inv, roll(2));
  assertEq(r.investigator.dead, true);
  assertEq(r.investigator.hpMax, 0);
  assertEq(r.investigator.sanMax, 8);
  assertEq(r.investigator.traumas.length, 2, '雙創傷');
  assertEq(r.investigator.permanentlyDead, true, 'HP 上限歸零 → 永久死亡');
});

test('穩定:+1 成功自動成功;湊滿 3 站起(§9.5)', () => {
  let inv = syncDownedState(makeInv({ hp: 0 })).investigator;
  inv = { ...inv, deathSaveSuccesses: 2 };
  const r = applyStabilize(inv);
  assertEq(r.investigator.downed, false, '第 3 次成功 → 站起');
  assertEq(r.investigator.hp, 1);
  assertEq(applyStabilize(makeInv()).effects.length, 0, '站著的人不需穩定');
});

test('全滅判定:倒地不算敗(還有瀕死檢定),全員死亡才敗', () => {
  const downed = syncDownedState(makeInv({ hp: 0 })).investigator;
  const dead = { ...makeInv(), dead: true };
  assertEq(allInvestigatorsDead({ a: downed, b: makeInv() }), false);
  assertEq(allInvestigatorsDead({ a: downed }), false, '全倒地仍可自救');
  assertEq(allInvestigatorsDead({ a: dead }), true);
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
