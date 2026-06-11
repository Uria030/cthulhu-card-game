/**
 * G-02 檢定管線單元測試 — 逐條對齊 02_rulebook_ch2.md §4/§5/§12.1
 */
import {
  resolveCheck,
  commitValueFor,
  visibilityModifier,
  drawChaosToken,
  resolveSpellSideEffect,
} from './checks';
import type { ChaosToken } from './state';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error((msg ?? 'assertEq 失敗') + ': expected=' + String(expected) + ', actual=' + String(actual));
  }
}

/** 固定骰值的 rng:rollD20 = Math.floor(rng()*20)+1 */
const rngForRoll = (roll: number) => () => (roll - 1) / 20;
/** 固定抽第 idx 顆(bag 長度 n):Math.floor(rng()*n) === idx */
const rngForIndex = (idx: number, n: number) => () => idx / n + 0.001;

// ─── §4.1-4.3 d20 修正棧 ──────────────────────
test('修正棧五層加總', () => {
  const r = resolveCheck(10, { attribute: 3, proficiency: 1, equipment: 2, commit: 2, situational: -2 }, rngForRoll(7));
  assertEq(r.roll, 7);
  assertEq(r.total, 7 + 3 + 1 + 2 + 2 - 2);
  assertEq(r.outcome, 'success');
});

test('total < DC 失敗', () => {
  const r = resolveCheck(15, { attribute: 2 }, rngForRoll(5));
  assertEq(r.outcome, 'fail');
});

test('自然 20/1 旗標', () => {
  assertEq(resolveCheck(10, {}, rngForRoll(20)).natural20, true);
  assertEq(resolveCheck(10, {}, rngForRoll(1)).natural1, true);
});

// ─── §3 加值 commit ──────────────────────────
test('commit 對應屬性 + 萬能 all 都生效', () => {
  const v = commitValueFor('perception', [
    { perception: 2 },
    { strength: 3 },        // 不對應 → 不算
    { all: 1 },             // 萬能 → 算
  ]);
  assertEq(v, 3);
});

// ─── §12.1 光照 ─────────────────────────────
test('光照修正:夜間攻擊 -2 / 黑暗閃避 +2 / 白天無', () => {
  assertEq(visibilityModifier('attack', 'night'), -2);
  assertEq(visibilityModifier('attack', 'darkness'), -2);
  assertEq(visibilityModifier('attack', 'day'), 0);
  assertEq(visibilityModifier('attack', 'fire'), 0);
  assertEq(visibilityModifier('evade', 'darkness'), 2);
  assertEq(visibilityModifier('evade', 'day'), 0);
});

// ─── §5 混沌袋 ──────────────────────────────
const numToken = (id: string, value: number): ChaosToken => ({ tokenId: id, type: 'numeric', value });

test('混沌袋:抽數字標記', () => {
  const bag = [numToken('a', -1), numToken('b', 0)];
  const d = drawChaosToken(bag, rngForIndex(0, 2));
  assertEq(d.finalToken.tokenId, 'a');
  assertEq(d.value, -1);
  assertEq(d.removedTokenIds.length, 0);
});

test('混沌袋:祝福連鎖再抽且移出袋', () => {
  const bag: ChaosToken[] = [
    { tokenId: 'bless1', type: 'bless', value: 1 },
    numToken('n0', -2),
  ];
  // 先抽 idx0(bless) → 移出後剩 1 顆,再抽 idx0(n0)
  const d = drawChaosToken(bag, rngForIndex(0, 2));
  assertEq(d.drawn.length, 2);
  assertEq(d.finalToken.tokenId, 'n0');
  assertEq(d.value, 1 + -2); // bless +1 連鎖 + 最終 -2
  assertEq(d.removedTokenIds[0], 'bless1');
});

test('混沌袋:觸手 auto worst / 遠古印記 auto best', () => {
  const t = drawChaosToken([{ tokenId: 't', type: 'tentacle', value: null }], rngForIndex(0, 1));
  assertEq(t.auto, 'worst');
  const e = drawChaosToken([{ tokenId: 'e', type: 'elder_sign', value: null }], rngForIndex(0, 1));
  assertEq(e.auto, 'best');
});

// ─── §5.7 副作用減輕分級 ──────────────────────
const drawOf = (type: string, value: number) => ({
  drawn: [], finalToken: { tokenId: 'x', type, value }, value, auto: null as null, removedTokenIds: [],
});

test('§5.7 數值 ≥ 防禦 → 全免', () => {
  const r = resolveSpellSideEffect(drawOf('numeric', 0), 0);
  assertEq(r.sceneEffectFires, false);
  assertEq(r.casterSanDelta, 0);
});

test('§5.7 差值 1-2 → 場景取消 + SAN-1', () => {
  const r = resolveSpellSideEffect(drawOf('skull', -1), 1); // 防禦1 - (-1) = 2
  assertEq(r.sceneEffectFires, false);
  assertEq(r.casterSanDelta, -1);
});

test('§5.7 差值 3-4 → 場景全額', () => {
  const r = resolveSpellSideEffect(drawOf('skull', -2), 2); // 2-(-2)=4
  assertEq(r.sceneEffectFires, true);
  assertEq(r.casterSanDelta, 0);
});

test('§5.7 差值 5+ → 場景全額 + SAN-1', () => {
  const r = resolveSpellSideEffect(drawOf('skull', -3), 5); // 5-(-3)=8
  assertEq(r.sceneEffectFires, true);
  assertEq(r.casterSanDelta, -1);
});

test('§5.5 神話標記場景效果無視防禦一律發動', () => {
  const immune = resolveSpellSideEffect(drawOf('doom', 1), 0); // 數值≥防禦
  assertEq(immune.sceneEffectFires, true, '神話標記在 immune 級仍發動');
  const cancelled = resolveSpellSideEffect(drawOf('gate', -1), 1); // 差值2
  assertEq(cancelled.sceneEffectFires, true, '神話標記在 cancelled 級仍發動');
});

test('§5.6 觸手:全額 + SAN-1;遠古印記:全免 + SAN+1', () => {
  const t = resolveSpellSideEffect({ ...drawOf('tentacle', 0), auto: 'worst' as const }, 9);
  assertEq(t.sceneEffectFires, true);
  assertEq(t.casterSanDelta, -1);
  const e = resolveSpellSideEffect({ ...drawOf('elder_sign', 0), auto: 'best' as const }, 0);
  assertEq(e.sceneEffectFires, false);
  assertEq(e.casterSanDelta, 1);
});

// ─── runner ─────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];
for (const t of tests) {
  try {
    t.fn();
    console.log('✓ ' + t.name);
    passed += 1;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('✗ ' + t.name + '\n   ' + msg);
    failed += 1;
    failures.push(t.name);
  }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
