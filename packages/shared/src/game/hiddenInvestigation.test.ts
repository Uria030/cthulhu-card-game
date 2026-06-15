/**
 * G-09 隱藏調查點測試 — §13 三層次 + 獎勵分配(每人各一次/限定品首位)
 */
import {
  hiddenPointFromRow, revealOnEnter, revealOnGeneralSuccess, claimHiddenReward, revealedUnclaimedAt,
} from './hiddenInvestigation';
import type { HiddenPoint } from './hiddenInvestigation';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

function pt(over: Partial<HiddenPoint> = {}): HiddenPoint {
  return {
    id: 'h1', locationId: 'A', title: '暗門', description: '...', threshold: 5,
    revealedTo: [], claimedBy: [], limitedClaimedBy: null, hasLimited: false,
    rewardType: 'effect', rewardParams: {},
    ...over,
  };
}

test('bootstrap:從 hidden_info row 建 HiddenPoint(門檻/限定判定)', () => {
  const p = hiddenPointFromRow({
    id: 'x', title_zh: '禁書區暗門', description_zh: '...',
    reveal_condition_params: { threshold: 5 }, reward_type: 'unique_card', reward_params: {},
  }, 'lib');
  assertEq(p.threshold, 5);
  assertEq(p.locationId, 'lib');
  assertEq(p.hasLimited, true, 'unique_card 視為限定品');
});

test('§13.2 進地點:感知 ≥ 門檻自動揭露,不足看不見', () => {
  const high = revealOnEnter([pt()], 'i1', 'A', 6);
  assertEq(high.points[0].revealedTo.includes('i1'), true);
  assertEq(high.newlyRevealed.length, 1);
  const low = revealOnEnter([pt()], 'i2', 'A', 3);
  assertEq(low.points[0].revealedTo.includes('i2'), false, '感知不足看不見');
});

test('§13.4 低感知:一般調查成功觸發發現一個未揭露的隱藏點', () => {
  const r = revealOnGeneralSuccess([pt()], 'i2', 'A');
  assertEq(r.discovered?.id, 'h1');
  assertEq(r.points[0].revealedTo.includes('i2'), true);
  // 已全部揭露 → 不再發現
  assertEq(revealOnGeneralSuccess(r.points, 'i2', 'A').discovered, null);
});

test('§13.3 領取:未揭露不能領;已揭露各領一次,重領被擋', () => {
  const revealed = pt({ revealedTo: ['i1'] });
  assertEq(claimHiddenReward([pt()], 'h1', 'i1').ok, false, '未揭露不能領');
  const first = claimHiddenReward([revealed], 'h1', 'i1');
  assertEq(first.ok, true);
  assertEq(first.points[0].claimedBy.includes('i1'), true);
  assertEq(claimHiddenReward(first.points, 'h1', 'i1').ok, false, '同一人重領被擋');
});

test('每人各領一次:兩個調查員都能領', () => {
  let pts = [pt({ revealedTo: ['i1', 'i2'] })];
  pts = claimHiddenReward(pts, 'h1', 'i1').points;
  const second = claimHiddenReward(pts, 'h1', 'i2');
  assertEq(second.ok, true, 'i2 也能各領一次');
  assertEq(second.points[0].claimedBy.length, 2);
});

test('限定品:首位拿限定品+旗標,後續領其他獎勵', () => {
  let pts = [pt({ revealedTo: ['i1', 'i2'], hasLimited: true, rewardParams: { limited_flag: 'story.gotcard' } })];
  const first = claimHiddenReward(pts, 'h1', 'i1');
  assertEq(first.gotLimited, true, '首位拿限定品');
  assertEq(first.limitedFlag, 'story.gotcard');
  pts = first.points;
  const second = claimHiddenReward(pts, 'h1', 'i2');
  assertEq(second.ok, true);
  assertEq(second.gotLimited, false, '後續領其他獎勵,不拿限定品');
  assertEq(second.limitedFlag, null);
});

test('revealedUnclaimedAt:列已揭露未領的點(供 UI 調查隱藏內容)', () => {
  const pts = [
    pt({ id: 'h1', revealedTo: ['i1'] }),
    pt({ id: 'h2', revealedTo: ['i1'], claimedBy: ['i1'] }),
    pt({ id: 'h3', revealedTo: [] }),
  ];
  const list = revealedUnclaimedAt(pts, 'A', 'i1');
  assertEq(list.length, 1);
  assertEq(list[0].id, 'h1');
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
