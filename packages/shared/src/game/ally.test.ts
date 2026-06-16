/**
 * G-08 盟友傷害分配測試 — ch3 §11(Modal 玩家選擇)
 */
import { allocatableTargets, applyIncomingDamageToPlayer, applyDamageAllocation, autoAllocateDamage } from './ally';
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

test('autoAllocateDamage:AI 自動把傷害塞給盟友(貪婪填到容量上限)', () => {
  // 受擊前 hp=10,受 5 物理 → hp=5;肉盾(hp3)吸 3,AI 回到 8(≤ 受擊前 10,不過量)
  const hit = applyIncomingDamageToPlayer(makeInv({ allies: [mk({ hp: 3, san: 1 })] }), 5, 0);
  const p = (hit.effects.find((e) => e.type === 'damage_allocatable')?.params) as { physical: number };
  const r = autoAllocateDamage(hit.investigator, p.physical, 0);
  assertEq(r.investigator.hp, 8, 'AI 回血 3(5+3)');
  assertEq(r.investigator.allies?.length, 0, '盟友 HP 0 → 離場');
  assertEq(r.effects.some((e) => e.type === 'ally_soak'), true);
});

test('autoAllocateDamage:無盟友 → 不動、無效果', () => {
  const ai = makeInv({ hp: 4, allies: [] });
  const r = autoAllocateDamage(ai, 5, 0);
  assertEq(r.investigator.hp, 4, '無盟友不回血');
  assertEq(r.effects.length, 0);
});

test('autoAllocateDamage:恐懼→精神支柱、物理→肉盾(各依容量),回血不超過受擊前', () => {
  // 受擊前 hp=2/san=2;受 2 物理 + 2 恐懼 → 歸 0。肉盾(hp2)擋物理、支柱(san2)擋恐懼,回到受擊前值
  const pre = makeInv({ hp: 2, san: 2, allies: [mk({ hp: 2, san: 0 }), mk({ cardInstanceId: 'a2', hp: 0, san: 2 })] });
  const hit = applyIncomingDamageToPlayer(pre, 2, 2);
  const p = (hit.effects.find((e) => e.type === 'damage_allocatable')?.params) as { physical: number; horror: number };
  const r = autoAllocateDamage(hit.investigator, p.physical, p.horror);
  assertEq(r.investigator.hp, 2, '物理由肉盾擋 → 回 HP 2(受擊前值)');
  assertEq(r.investigator.san, 2, '恐懼由支柱擋 → 回 SAN 2(受擊前值)');
});

test('overkill 防護:可分配量夾到實際損失,soak 不把調查員治到比受擊前更高', () => {
  // 受擊前 hp=2,怪攻物理=6(overkill)。實際只損失 2,盟友最多只能吸 2 → AI 回到 2,不是被打反而 +4
  const pre = makeInv({ hp: 2, hpMax: 10, allies: [mk({ hp: 6, san: 1 })] });
  const hit = applyIncomingDamageToPlayer(pre, 6, 0);
  assertEq(hit.investigator.hp, 0, '受擊後歸 0');
  const p = (hit.effects.find((e) => e.type === 'damage_allocatable')?.params) as { physical: number };
  assertEq(p.physical, 2, '放出的可分配量 = 實際損失 2(非完整入傷 6)');
  const auto = autoAllocateDamage(hit.investigator, p.physical, 0);
  assertEq(auto.investigator.hp, 2, 'soak 後回到受擊前 hp=2,不過量回血');
});

// ─── runner ─────────────────────────
let passed = 0; let failed = 0; const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed += 1; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('✗ ' + t.name + '\n   ' + msg); failed += 1; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
