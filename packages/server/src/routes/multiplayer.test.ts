import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import jwt from 'jsonwebtoken';
import { PLAYER_JWT_SECRET } from '../middleware/player-auth.js';
import { multiplayerRoutes } from './multiplayer.js';
import { MultiplayerRoomService } from '../services/multiplayer-rooms.js';

type TestFn = () => Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

function token(playerId: string, username: string): string {
  return jwt.sign({ playerId, username, kind: 'player' }, PLAYER_JWT_SECRET);
}

async function makeApp() {
  let counter = 0;
  const codes = ['ABCDEF', 'GHIJKL'];
  const rooms = new MultiplayerRoomService({ codeFactory: () => codes[counter++] ?? 'MNPQRS' });
  const app = Fastify({ logger: false });
  await app.register(websocket);
  await app.register(multiplayerRoutes, { roomService: rooms });
  return app;
}

function waitForSocketEvent(socket: any, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket timeout: ' + type)), 3000);
    socket.addEventListener(type, (event: any) => {
      clearTimeout(timer);
      resolve(event);
    });
  });
}

test('多人房 API:需要玩家 token，開房、加入、離開與關房均依身分裁決', async () => {
  const app = await makeApp();
  try {
    const denied = await app.inject({ method: 'POST', url: '/api/multiplayer/rooms' });
    assertEq(denied.statusCode, 401);

    const hostToken = token('host-id', 'creator01');
    const create = await app.inject({
      method: 'POST', url: '/api/multiplayer/rooms', headers: { authorization: `Bearer ${hostToken}` },
    });
    assertEq(create.statusCode, 201);
    const roomCode = create.json().data.roomCode;
    assertEq(roomCode, 'ABCDEF');

    const guestToken = token('guest-id', 'creator02');
    const join = await app.inject({
      method: 'POST', url: `/api/multiplayer/rooms/${roomCode}/join`, headers: { authorization: `Bearer ${guestToken}` },
    });
    assertEq(join.statusCode, 200);
    assertEq(join.json().data.members.length, 2);

    const outsider = await app.inject({
      method: 'GET', url: `/api/multiplayer/rooms/${roomCode}`,
      headers: { authorization: `Bearer ${token('outsider-id', 'outsider')}` },
    });
    assertEq(outsider.statusCode, 403);

    const guestClose = await app.inject({
      method: 'DELETE', url: `/api/multiplayer/rooms/${roomCode}`, headers: { authorization: `Bearer ${guestToken}` },
    });
    assertEq(guestClose.statusCode, 403);

    const leave = await app.inject({
      method: 'POST', url: `/api/multiplayer/rooms/${roomCode}/leave`, headers: { authorization: `Bearer ${guestToken}` },
    });
    assertEq(leave.statusCode, 200);

    const close = await app.inject({
      method: 'DELETE', url: `/api/multiplayer/rooms/${roomCode}`, headers: { authorization: `Bearer ${hostToken}` },
    });
    assertEq(close.statusCode, 200);
  } finally {
    await app.close();
  }
});

test('多人 WebSocket:認證後回傳權威房間快照', async () => {
  const app = await makeApp();
  const hostToken = token('host-id', 'creator01');
  try {
    const create = await app.inject({
      method: 'POST', url: '/api/multiplayer/rooms', headers: { authorization: `Bearer ${hostToken}` },
    });
    const roomCode = create.json().data.roomCode;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as { port: number };
    const Socket = (globalThis as any).WebSocket;
    if (!Socket) throw new Error('Node runtime lacks WebSocket client');
    const socket = new Socket(`ws://127.0.0.1:${address.port}/api/multiplayer/rooms/${roomCode}/ws`);
    await waitForSocketEvent(socket, 'open');
    socket.send(JSON.stringify({ type: 'authenticate', token: hostToken }));
    const message = await waitForSocketEvent(socket, 'message');
    const payload = JSON.parse(String(message.data));
    assertEq(payload.type, 'room_snapshot');
    assertEq(payload.snapshot.roomCode, roomCode);
    assertEq(payload.snapshot.members[0].playerId, 'host-id');
    socket.close();
  } finally {
    await app.close();
  }
});

let passed = 0;
let failed = 0;
const failures: string[] = [];
for (const entry of tests) {
  try { await entry.fn(); console.log('✓ ' + entry.name); passed += 1; }
  catch (error: unknown) {
    console.error('✗ ' + entry.name + '\n   ' + (error instanceof Error ? error.message : String(error)));
    failed += 1;
    failures.push(entry.name);
  }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
