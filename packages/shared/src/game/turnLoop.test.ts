/**
 * G-01 回合狀態機單元測試
 */
import { createTurnLoop } from './turnLoop';
import { createInMemoryMessageBus } from './messageBus';
import type { NotificationMessage } from './messages';

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

// ─── 測試 1:預設從第 1 回合的 short_rest_decision 開始 ──
test('預設初始狀態', () => {
  const loop = createTurnLoop();
  const state = loop.getState();
  assertEq(state.turnNumber, 1);
  assertEq(state.phase, 'short_rest_decision');
});

// ─── 測試 2:advance 依序推進四階段 ──────────────
test('advance 推進四階段順序', () => {
  const loop = createTurnLoop();
  const phases: string[] = [loop.getState().phase];
  loop.advance();
  phases.push(loop.getState().phase);
  loop.advance();
  phases.push(loop.getState().phase);
  loop.advance();
  phases.push(loop.getState().phase);

  assertEq(phases[0], 'short_rest_decision');
  assertEq(phases[1], 'investigator');
  assertEq(phases[2], 'mythos');
  assertEq(phases[3], 'turn_end');
});

// ─── 測試 3:從 turn_end advance 進入下一回合 ──────
test('turn_end 後自動跳下一回合', () => {
  const loop = createTurnLoop();
  loop.setPhase('turn_end', 3);
  loop.advance(); // 進入第 4 回合的 short_rest_decision
  const state = loop.getState();
  assertEq(state.turnNumber, 4);
  assertEq(state.phase, 'short_rest_decision');
});

// ─── 測試 4:bus 收到 phase_changed notification ──
test('phase_changed 通知正確發送', () => {
  const bus = createInMemoryMessageBus();
  const notifs: NotificationMessage[] = [];
  bus.subscribe('notification', (m) => notifs.push(m));

  const loop = createTurnLoop({ bus });
  loop.advance(); // short_rest_decision → investigator

  const phaseChangedNotifs = notifs.filter((n) => n.notificationType === 'phase_changed');
  assertEq(phaseChangedNotifs.length, 1);
  const p = phaseChangedNotifs[0].payload as { prevPhase: string; newPhase: string };
  assertEq(p.prevPhase, 'short_rest_decision');
  assertEq(p.newPhase, 'investigator');
});

// ─── 測試 5:nextTurn 發 turn_ended + turn_started ──
test('nextTurn 發 turn_ended 與 turn_started 通知', () => {
  const bus = createInMemoryMessageBus();
  const notifs: NotificationMessage[] = [];
  bus.subscribe('notification', (m) => notifs.push(m));

  const loop = createTurnLoop({ bus, initialState: { turnNumber: 5, phase: 'turn_end' } });
  loop.nextTurn();

  const types = notifs.map((n) => n.notificationType);
  // 應包含 turn_ended、phase_changed、turn_started
  assertEq(types.includes('turn_ended'), true);
  assertEq(types.includes('phase_changed'), true);
  assertEq(types.includes('turn_started'), true);
  assertEq(loop.getState().turnNumber, 6);
});

// ─── 測試 6:setPhase 也發 phase_changed ────────
test('setPhase 也發通知', () => {
  const bus = createInMemoryMessageBus();
  const notifs: NotificationMessage[] = [];
  bus.subscribe('notification', (m) => notifs.push(m));

  const loop = createTurnLoop({ bus });
  loop.setPhase('mythos');

  const phaseChangedNotifs = notifs.filter((n) => n.notificationType === 'phase_changed');
  assertEq(phaseChangedNotifs.length, 1);
  const p = phaseChangedNotifs[0].payload as { newPhase: string };
  assertEq(p.newPhase, 'mythos');
  assertEq(loop.getState().phase, 'mythos');
});

// ─── runner ─────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];
for (const t of tests) {
  try {
    t.fn();
    console.log('✓ ' + t.name);
    passed++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('✗ ' + t.name + '\n   ' + msg);
    failed++;
    failures.push(t.name);
  }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
