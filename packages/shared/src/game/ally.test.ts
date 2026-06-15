/**
 * G-08 盟友傷害分配測試 — ch3 §11(v0 自動吸收)
 */
import { allocateIncomingDamage, applyDamageWithAllies } from './ally';
import type { AllyState, InvestigatorState } from './state';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

const mk = (over: Partial<AllyState> = {}): AllyState => ({ cardInstanceId: 'a1', name: '老兵', hp: 3, hpMax: 3, san: 1, sanMax: 1, attack: 0, exhausted: false, ...over });
function makeInv(over: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: 'i1', investigatorDefinitionId: 'd', ownerPlayerId: 'p',
    attributes: { strength: 2, agility: 2, constitution: 2, reflex: 2, intellect: 2, willpower: 2, perception: 2, charisma: 2 },
    combatStyle: '', specializations: [], deck: [], hand: [], discardPile: [], removedPile: [], assetsInPlay: [],
    hp: 10, hpMax: 10, san: 10, sanMax: 10, actionPoints: 3, resources: 0, currentLocationId: 'A',
    engagedWith: [], triggeredHorrorChecks: [], traumas: [], secretTaskState: null, permanentlyDead: false, startingXp: 0,
    ...over,
  };
}

test('物理:最高HP盟友吸,吸滿陣亡 overflow 給調查員', () => {
  const r = allocateIncomingDamage([mk({ hp: 3, san: 2 })], 5, 0);
  assertEq(r.toInvestigator.physical, 2, '5-3 overflow');
  assertEq(r.allies.length, 0, 'HP 0 → 離場');
  assertEq(r.effects.some((e) => e.type === 'ally_soak'), true);
  assertEq(r.effects.some((e) => e.type === 'ally_defeated'), true);
});

test('恐懼:最高SAN盟友吸,未歸0留場', () => {
  const r = allocateIncomingDamage([mk({ hp: 2, san: 3 })], 0, 2);
  assertEq(r.allies[0]?.san, 1);
  assertEq(r.toInvestigator.horror, 0);
  assertEq(r.allies.length, 1, '兩池都>0 留場');
});

test('多盟友:物理找最高HP那個', () => {
  const r = allocateIncomingDamage([mk({ cardInstanceId: 'x', hp: 1, san: 3 }), mk({ cardInstanceId: 'y', hp: 4, san: 3 })], 2, 0);
  const y = r.allies.find((a) => a.cardInstanceId === 'y');
  assertEq(y?.hp, 2, '最高HP的 y 吸 2');
  assertEq(r.allies.find((a) => a.cardInstanceId === 'x')?.hp, 1, 'x 不受影響');
});

test('無盟友:原樣給調查員', () => {
  const r = allocateIncomingDamage([], 4, 2);
  assertEq(r.toInvestigator.physical, 4);
  assertEq(r.toInvestigator.horror, 2);
});

test('applyDamageWithAllies:盟友吸後調查員只受 overflow', () => {
  const r = applyDamageWithAllies(makeInv({ allies: [mk({ hp: 3, san: 2 })] }), 5, 0);
  assertEq(r.investigator.hp, 8, '盟友吸3,調查員受 overflow 2');
  assertEq(r.investigator.allies?.length, 0, '盟友陣亡離場');
});

// ─── runner ─────────────────────────
let passed = 0; let failed = 0; const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed += 1; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('✗ ' + t.name + '\n   ' + msg); failed += 1; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
