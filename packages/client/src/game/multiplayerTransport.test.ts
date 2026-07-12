import { openMultiplayerTransport, type MultiplayerSocketLike } from './multiplayerTransport';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) throw new Error((message ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

class FakeSocket implements MultiplayerSocketLike {
  readyState = 1;
  sent: string[] = [];
  private listeners = new Map<string, Array<(event: any) => void>>();
  send(payload: string): void { this.sent.push(payload); }
  close(): void { this.readyState = 3; }
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: any) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: 'open' | 'message' | 'close' | 'error', event: any = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

test('reaction transport:認證後送出權威 resolve_reaction 訊息', () => {
  const socket = new FakeSocket();
  const transport = openMultiplayerTransport({
    roomCode: 'ABCDEF', token: 'player-token', apiBase: 'https://example.test',
    createSocket: () => socket, onMessage: () => {},
  });
  assertEq(transport.resolveReaction(3, 'reaction-1', { kind: 'pass' }), false, '未認證不能送出');
  socket.emit('open');
  assertEq(JSON.parse(socket.sent[0]).type, 'authenticate');
  assertEq(transport.resolveReaction(3, 'reaction-1', { kind: 'play', cardInstanceId: 'guard-1', effectIndex: 0 }), true);
  assertEq(socket.sent.length, 2);
  const message = JSON.parse(socket.sent[1]);
  assertEq(message.type, 'resolve_reaction');
  assertEq(message.sequence, 3);
  assertEq(message.reactionId, 'reaction-1');
  assertEq(message.decision.cardInstanceId, 'guard-1');
});

let passed = 0;
let failed = 0;
for (const entry of tests) {
  try { entry.fn(); console.log('✓ ' + entry.name); passed += 1; }
  catch (error: unknown) { console.error('✗ ' + entry.name + '\n  ' + (error instanceof Error ? error.message : String(error))); failed += 1; }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('multiplayer transport tests failed');
