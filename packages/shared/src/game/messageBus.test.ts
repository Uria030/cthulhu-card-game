/**
 * G-01 訊息匯流排單元測試
 *
 * 測試只用純 TypeScript,不依賴 Node API(避免引入 @types/node 到 shared)。
 * 跑法:從 cthulhu-card-game/ 根目錄執行
 *   ./packages/server/node_modules/.bin/tsx packages/shared/src/game/messageBus.test.ts
 */
import { createInMemoryMessageBus } from './messageBus';
import type { IntentMessage, ResultMessage, NotificationMessage } from './messages';
import { CURRENT_MESSAGE_SCHEMA_VERSION } from './messages';

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
function assertTrue(condition: unknown, msg?: string): void {
  if (!condition) throw new Error(msg ?? 'assertTrue 失敗');
}
function assertArrEq(actual: unknown[], expected: unknown[], msg?: string): void {
  if (actual.length !== expected.length) throw new Error((msg ?? 'arr length 不同') + ': ' + actual.length + ' vs ' + expected.length);
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) throw new Error((msg ?? 'arr[' + i + '] 不同') + ': ' + String(actual[i]) + ' vs ' + String(expected[i]));
  }
}

// ─── 測試 1:publish 自動補 id / timestamp / schemaVersion ──
test('publish 自動補欄位', () => {
  const bus = createInMemoryMessageBus();
  const received: IntentMessage[] = [];
  bus.subscribe('intent', (m) => received.push(m));

  bus.publish({
    kind: 'intent',
    source: 'player-1',
    actionType: 'attack',
    payload: { targetId: 'enemy-1' },
    playerId: 'player-1',
    investigatorId: 'inv-1',
  });

  assertEq(received.length, 1);
  assertTrue(received[0].id, 'id 應自動補');
  assertTrue(received[0].timestamp, 'timestamp 應自動補');
  assertEq(received[0].schemaVersion, CURRENT_MESSAGE_SCHEMA_VERSION);
  assertEq(received[0].actionType, 'attack');
});

// ─── 測試 2:三種 kind 各自只觸發對應 listener ────────
test('kind 分流正確', () => {
  const bus = createInMemoryMessageBus();
  const intents: IntentMessage[] = [];
  const results: ResultMessage[] = [];
  const notifications: NotificationMessage[] = [];

  bus.subscribe('intent', (m) => intents.push(m));
  bus.subscribe('result', (m) => results.push(m));
  bus.subscribe('notification', (m) => notifications.push(m));

  bus.publish({
    kind: 'intent',
    source: 'p1',
    actionType: 'move',
    payload: {},
    playerId: 'p1',
    investigatorId: 'inv-1',
  });
  bus.publish({
    kind: 'result',
    source: 'engine',
    inResponseTo: 'msg-x',
    outcome: 'accepted',
  });
  bus.publish({
    kind: 'notification',
    source: 'engine',
    notificationType: 'phase_changed',
    payload: { newPhase: 'mythos' },
  });

  assertEq(intents.length, 1);
  assertEq(results.length, 1);
  assertEq(notifications.length, 1);
});

// ─── 測試 3:unsubscribe 後不再收到訊息 ────────────
test('unsubscribe 生效', () => {
  const bus = createInMemoryMessageBus();
  const received: IntentMessage[] = [];
  const unsub = bus.subscribe('intent', (m) => received.push(m));

  bus.publish({
    kind: 'intent',
    source: 'p1',
    actionType: 'attack',
    payload: {},
    playerId: 'p1',
    investigatorId: 'inv-1',
  });
  assertEq(received.length, 1);

  unsub();

  bus.publish({
    kind: 'intent',
    source: 'p1',
    actionType: 'move',
    payload: {},
    playerId: 'p1',
    investigatorId: 'inv-1',
  });
  assertEq(received.length, 1, 'unsubscribe 後不應再收');
});

// ─── 測試 4:subscribeAll 收到所有訊息 ───────────
test('subscribeAll 涵蓋全部 kind', () => {
  const bus = createInMemoryMessageBus();
  const all: { kind: string }[] = [];
  bus.subscribeAll((m) => all.push({ kind: m.kind }));

  bus.publish({
    kind: 'intent',
    source: 'p1',
    actionType: 'attack',
    payload: {},
    playerId: 'p1',
    investigatorId: 'inv-1',
  });
  bus.publish({
    kind: 'result',
    source: 'engine',
    inResponseTo: 'msg-x',
    outcome: 'accepted',
  });
  bus.publish({
    kind: 'notification',
    source: 'engine',
    notificationType: 'turn_started',
    payload: {},
  });

  assertEq(all.length, 3);
  assertArrEq(
    all.map((x) => x.kind),
    ['intent', 'result', 'notification']
  );
});

// ─── 測試 5:clear 清除所有 listener ──────────────
test('clear 後 listener 全失效', () => {
  const bus = createInMemoryMessageBus();
  let count = 0;
  bus.subscribe('intent', () => count++);
  bus.subscribe('result', () => count++);
  bus.subscribeAll(() => count++);

  bus.clear();

  bus.publish({
    kind: 'intent',
    source: 'p1',
    actionType: 'attack',
    payload: {},
    playerId: 'p1',
    investigatorId: 'inv-1',
  });

  assertEq(count, 0);
});

// ─── runner(用 console + throw,不依賴 process API) ──
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
if (failed > 0) {
  // 拋錯讓 runner 收到 non-zero exit(tsx 會把 unhandled error 變成 exit code 1)
  throw new Error('Tests failed: ' + failures.join(', '));
}
