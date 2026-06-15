/**
 * G-08 盟友傷害分配測試 — ch3 §11(Modal 玩家選擇)
 */
import { allocatableTargets, applyIncomingDamageToPlayer, applyDamageAllocation } from './ally';
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

test('allocatableTargets:列場上盟友的吸收上限(=HP/SAN)', () => {
  const t = allocatableTargets(makeInv({ allies: [mk({ hp: 3, san: 1 })] }));
  assertEq(t.length, 1);
  assertEq(t[0].physicalCapacity, 3);
  assertEq(t[0].horrorCapacity, 1);
});

test('applyIncomingDamageToPlayer:結在玩家 + 有盟友且非direct → emit damage_allocatable', () => {
  const r = applyIncomingDamageToPlayer(makeInv({ allies: [mk()] }), 5, 0);
  assertEq(r.investigator.hp, 5, '先全部結在玩家(10-5)');
  assertEq(r.effects.some((e) => e.type === 'damage_allocatable'), true);
});

test('applyIncomingDamageToPlayer:direct → 不可分配,無 modal', () => {
  const r = applyIncomingDamageToPlayer(makeInv({ allies: [mk()] }), 5, 0, { direct: true });
  assertEq(r.effects.some((e) => e.type === 'damage_allocatable'), false, 'direct 不跳 Modal');
});

test('applyIncomingDamageToPlayer:無可分配卡 → 不 emit', () => {
  const r = applyIncomingDamageToPlayer(makeInv({ allies: [] }), 5, 0);
  assertEq(r.effects.length, 0);
});

test('applyDamageAllocation:把傷害移到盟友 → 玩家回血、盟友扣血', () => {
  // 玩家已受 5 傷(hp 5),選把 3 分給盟友
  const inv = makeInv({ hp: 5, allies: [mk({ hp: 3, san: 1 })] });
  const r = applyDamageAllocation(inv, [{ cardInstanceId: 'a1', physical: 3 }]);
  assertEq(r.investigator.hp, 8, '回血 3(5+3,不超上限)');
  assertEq(r.investigator.allies?.length, 0, '盟友 HP 0 → 離場');
  assertEq(r.effects.some((e) => e.type === 'ally_soak'), true);
  assertEq(r.effects.some((e) => e.type === 'ally_defeated'), true);
});

test('applyDamageAllocation:分配量夾在盟友剩餘上限', () => {
  const inv = makeInv({ hp: 0, allies: [mk({ hp: 2, san: 2 })] });
  const r = applyDamageAllocation(inv, [{ cardInstanceId: 'a1', physical: 9 }]); // 想分 9 但盟友只 2 HP
  assertEq(r.investigator.hp, 2, '只回血 2(夾盟友上限)');
  assertEq(r.investigator.allies?.length, 0, '盟友 HP 0 → 離場');
});

// ─── runner ─────────────────────────
let passed = 0; let failed = 0; const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed += 1; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('✗ ' + t.name + '\n   ' + msg); failed += 1; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
