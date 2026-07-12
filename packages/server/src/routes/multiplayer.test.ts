import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import jwt from 'jsonwebtoken';
import { PLAYER_JWT_SECRET } from '../middleware/player-auth.js';
import { multiplayerRoutes } from './multiplayer.js';
import { MultiplayerRoomService } from '../services/multiplayer-rooms.js';
import type { StageBootstrap } from '@cthulhu/shared';

type TestFn = () => Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

function token(playerId: string, username: string): string {
  return jwt.sign({ playerId, username, kind: 'player' }, PLAYER_JWT_SECRET);
}

async function makeApp(overrides: Record<string, unknown> = {}) {
  let counter = 0;
  const codes = ['ABCDEF', 'GHIJKL'];
  const rooms = new MultiplayerRoomService({ codeFactory: () => codes[counter++] ?? 'MNPQRS' });
  const app = Fastify({ logger: false });
  await app.register(websocket);
  await app.register(multiplayerRoutes, { roomService: rooms, ...overrides });
  return app;
}

function bootstrap(templateId: string): StageBootstrap {
  return {
    stage: { id: 'stage-rain', code: 'rain', name_zh: '雨夜的真相', scenarios: [{ id: 'scenario-rain', scenario_order: 1, name_zh: '雨夜', narrative: '', initial_location_codes: ['street'], initial_connections: [], investigator_spawn_location: 'street', initial_environment: { main: '夜間' }, initial_enemies: [] }], act_cards: [], agenda_cards: [], chaos_bag: { number_markers: { '0': 1 }, scenario_markers: {} }, encounter_trigger_config: { trigger_actions: ['gain_resource'] } },
    campaign: { id: 'campaign-rain', code: 'rain', name_zh: '雨夜' }, chapter: null,
    locations: [{ id: 'loc-street', code: 'street', name_zh: '雨街', shroud: 10, clues_base: 1, clues_per_player: 0 }],
    mythos_cards: [], encounter_cards: [{ id: 'enc-1', name_zh: '雨巷裡的低語', scenario_text_zh: '濕牆後傳來了呼吸聲。', options: [{ option_label: '直視陰影', option_text_zh: '往前一步。', no_check_effects: [{ effect_code: 'discover_clue', amount: 1 }] }] }], monsters: [], monster_attack_cards: [], combat_style_pools: [],
    investigator: { id: templateId, code: templateId.slice(0, 8), name_zh: templateId, attr_strength: 3, attr_agility: 3, attr_constitution: 3, attr_reflex: 3, attr_intellect: 3, attr_willpower: 3, attr_perception: 3, attr_charisma: 3, proficiency_ids: [], starting_deck: [{ deck_entry_id: `${templateId}-deck`, quantity: 6, slot_order: 1, card_definition_id: `${templateId}-card`, signature_card_id: null, weakness_id: null, card: { id: `${templateId}-card`, name_zh: '調查筆記', card_type: 'event', cost: 0, effects: [] }, signature_card: null, weakness: null }] },
  };
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

function waitForSocketMessage(socket: any, predicate: (payload: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket message timeout')), 3000);
    socket.addEventListener('message', (event: any) => {
      const payload = JSON.parse(String(event.data));
      if (!predicate(payload)) return;
      clearTimeout(timer);
      resolve(payload);
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

test('多人 WebSocket:指定遭遇只鎖 target，隊友照常行動並由 target 權威結算', async () => {
  const app = await makeApp({
    isPlayableTemplate: async () => true,
    isActiveSaveForSelection: async () => true,
    bootstrapForTemplate: async (_stageId: string, templateId: string) => bootstrap(templateId),
  });
  const hostToken = token('host-id', 'creator01');
  const guestToken = token('guest-id', 'creator02');
  try {
    const created = await app.inject({ method: 'POST', url: '/api/multiplayer/rooms', headers: { authorization: `Bearer ${hostToken}` } });
    const roomCode = created.json().data.roomCode;
    await app.inject({ method: 'POST', url: `/api/multiplayer/rooms/${roomCode}/join`, headers: { authorization: `Bearer ${guestToken}` } });
    await app.inject({ method: 'POST', url: `/api/multiplayer/rooms/${roomCode}/select-investigator`, headers: { authorization: `Bearer ${hostToken}` }, payload: { investigator_template_id: 'human-one', save_id: 'save-one' } });
    await app.inject({ method: 'POST', url: `/api/multiplayer/rooms/${roomCode}/select-investigator`, headers: { authorization: `Bearer ${guestToken}` }, payload: { investigator_template_id: 'human-two', save_id: 'save-two' } });
    await app.inject({ method: 'POST', url: `/api/multiplayer/rooms/${roomCode}/ready`, headers: { authorization: `Bearer ${hostToken}` }, payload: { ready: true } });
    await app.inject({ method: 'POST', url: `/api/multiplayer/rooms/${roomCode}/ready`, headers: { authorization: `Bearer ${guestToken}` }, payload: { ready: true } });
    const started = await app.inject({ method: 'POST', url: `/api/multiplayer/rooms/${roomCode}/start`, headers: { authorization: `Bearer ${hostToken}` }, payload: { stage_id: 'stage-rain' } });
    const game = started.json().data.game;
    const hostInvestigatorId = game.playerInvestigators['host-id'];
    const guestInvestigatorId = game.playerInvestigators['guest-id'];

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as { port: number };
    const Socket = (globalThis as any).WebSocket;
    if (!Socket) throw new Error('Node runtime lacks WebSocket client');
    const hostSocket = new Socket(`ws://127.0.0.1:${address.port}/api/multiplayer/rooms/${roomCode}/ws`);
    const guestSocket = new Socket(`ws://127.0.0.1:${address.port}/api/multiplayer/rooms/${roomCode}/ws`);
    await Promise.all([waitForSocketEvent(hostSocket, 'open'), waitForSocketEvent(guestSocket, 'open')]);
    const hostSnapshot = waitForSocketMessage(hostSocket, (payload) => payload.type === 'room_snapshot');
    hostSocket.send(JSON.stringify({ type: 'authenticate', token: hostToken }));
    const guestSnapshot = waitForSocketMessage(guestSocket, (payload) => payload.type === 'room_snapshot');
    guestSocket.send(JSON.stringify({ type: 'authenticate', token: guestToken }));
    await Promise.all([hostSnapshot, guestSnapshot]);

    const hostPending = waitForSocketMessage(hostSocket, (payload) => payload.type === 'intent_resolved' && payload.actorPlayerId === 'host-id');
    const guestPending = waitForSocketMessage(guestSocket, (payload) => payload.type === 'intent_resolved' && payload.actorPlayerId === 'host-id');
    hostSocket.send(JSON.stringify({ type: 'intent', sequence: 1, intent: { id: 'host-1', timestamp: 'now', schemaVersion: 1, source: 'host-id', kind: 'intent', playerId: 'host-id', investigatorId: hostInvestigatorId, actionType: 'gain_resource', payload: {} } }));
    const [hostEncounter, guestEncounter] = await Promise.all([hostPending, guestPending]);
    assertEq(hostEncounter.snapshot.game.pendingEncounter.targetInvestigatorId, hostInvestigatorId);
    assertEq(guestEncounter.snapshot.game.pendingEncounter.targetInvestigatorId, hostInvestigatorId);
    const objectiveBeforeEncounter = hostEncounter.snapshot.game.scenario.objectiveProgress;
    const privateEncounter = await app.inject({
      method: 'GET',
      url: `/api/multiplayer/rooms/${roomCode}/private-state`,
      headers: { authorization: `Bearer ${hostToken}` },
    });
    assertEq(privateEncounter.statusCode, 200);
    const encounterId = privateEncounter.json().data.pendingEncounter.id;

    const guestAction = waitForSocketMessage(guestSocket, (payload) => payload.type === 'intent_resolved' && payload.actorPlayerId === 'guest-id');
    guestSocket.send(JSON.stringify({ type: 'intent', sequence: 1, intent: { id: 'guest-1', timestamp: 'now', schemaVersion: 1, source: 'guest-id', kind: 'intent', playerId: 'guest-id', investigatorId: guestInvestigatorId, actionType: 'gain_resource', payload: {} } }));
    await guestAction;

    const wrongSeat = waitForSocketMessage(guestSocket, (payload) => payload.type === 'error' && payload.code === 'encounter_not_target');
    guestSocket.send(JSON.stringify({ type: 'resolve_encounter', sequence: 2, encounterId, optionIndex: 0 }));
    await wrongSeat;

    const resolved = waitForSocketMessage(hostSocket, (payload) => payload.type === 'intent_resolved' && payload.actorPlayerId === 'host-id' && payload.sequence === 2);
    hostSocket.send(JSON.stringify({ type: 'resolve_encounter', sequence: 2, encounterId, optionIndex: 0 }));
    const resolvedPayload = await resolved;
    assertEq(resolvedPayload.snapshot.game.pendingEncounter, undefined, 'target 結算後向所有連線同步清除 pending');
    assertEq(resolvedPayload.snapshot.game.scenario.objectiveProgress, objectiveBeforeEncounter + 1, '遭遇效果由 server 同步到全房');
    hostSocket.close();
    guestSocket.close();
  } finally {
    await app.close();
  }
});

test('多人 v1 路由:選人互斥、ready 後由 server bootstrap 成四席並填入 AI', async () => {
  const app = await makeApp({
    isPlayableTemplate: async () => true,
    isActiveSaveForSelection: async () => true,
    bootstrapForTemplate: async (_stageId: string, templateId: string) => bootstrap(templateId),
  });
  const hostToken = token('host-id', 'creator01');
  const guestToken = token('guest-id', 'creator02');
  try {
    const created = await app.inject({ method: 'POST', url: '/api/multiplayer/rooms', headers: { authorization: `Bearer ${hostToken}` } });
    const roomCode = created.json().data.roomCode;
    await app.inject({ method: 'POST', url: `/api/multiplayer/rooms/${roomCode}/join`, headers: { authorization: `Bearer ${guestToken}` } });
    const hostSelect = await app.inject({ method: 'POST', url: `/api/multiplayer/rooms/${roomCode}/select-investigator`, headers: { authorization: `Bearer ${hostToken}` }, payload: { investigator_template_id: 'human-one', save_id: 'save-one' } });
    assertEq(hostSelect.statusCode, 200);
    const collision = await app.inject({ method: 'POST', url: `/api/multiplayer/rooms/${roomCode}/select-investigator`, headers: { authorization: `Bearer ${guestToken}` }, payload: { investigator_template_id: 'human-one', save_id: 'save-two' } });
    assertEq(collision.statusCode, 409);
    await app.inject({ method: 'POST', url: `/api/multiplayer/rooms/${roomCode}/select-investigator`, headers: { authorization: `Bearer ${guestToken}` }, payload: { investigator_template_id: 'human-two', save_id: 'save-two' } });
    await app.inject({ method: 'POST', url: `/api/multiplayer/rooms/${roomCode}/ready`, headers: { authorization: `Bearer ${hostToken}` }, payload: { ready: true } });
    await app.inject({ method: 'POST', url: `/api/multiplayer/rooms/${roomCode}/ready`, headers: { authorization: `Bearer ${guestToken}` }, payload: { ready: true } });
    const started = await app.inject({ method: 'POST', url: `/api/multiplayer/rooms/${roomCode}/start`, headers: { authorization: `Bearer ${hostToken}` }, payload: { stage_id: 'stage-rain' } });
    assertEq(started.statusCode, 200);
    assertEq(started.json().data.phase, 'active');
    assertEq(Object.keys(started.json().data.game.investigators).length, 4);
    assertEq(Object.values(started.json().data.game.controllerByInvestigator).filter((value: unknown) => value === 'ai').length, 2);
    const privateState = await app.inject({
      method: 'GET',
      url: `/api/multiplayer/rooms/${roomCode}/private-state`,
      headers: { authorization: `Bearer ${hostToken}` },
    });
    assertEq(privateState.statusCode, 200, '真人席可取得自己的手牌與場上卡片 view');
    assertEq(privateState.json().data.investigatorId, started.json().data.game.playerInvestigators['host-id']);
    assertEq(Array.isArray(privateState.json().data.hand), true);
  } finally { await app.close(); }
});

test('多人 v1 路由:選擇存檔必須由 server 驗證玩家與調查員歸屬', async () => {
  const app = await makeApp({
    isPlayableTemplate: async () => true,
    isActiveSaveForSelection: async ({ saveId, playerId, templateId }: { saveId: string; playerId: string; templateId: string }) => (
      saveId === 'save-owned' && playerId === 'host-id' && templateId === 'human-one'
    ),
  });
  const hostToken = token('host-id', 'creator01');
  try {
    const created = await app.inject({ method: 'POST', url: '/api/multiplayer/rooms', headers: { authorization: `Bearer ${hostToken}` } });
    const roomCode = created.json().data.roomCode;
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/multiplayer/rooms/${roomCode}/select-investigator`,
      headers: { authorization: `Bearer ${hostToken}` },
      payload: { investigator_template_id: 'human-one', save_id: 'save-not-owned' },
    });
    assertEq(rejected.statusCode, 400, '他人或不相符的存檔不得進入房間狀態');
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/multiplayer/rooms/${roomCode}/select-investigator`,
      headers: { authorization: `Bearer ${hostToken}` },
      payload: { investigator_template_id: 'human-one', save_id: 'save-owned' },
    });
    assertEq(accepted.statusCode, 200, '自己的 active 存檔才能被綁定');
  } finally { await app.close(); }
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
