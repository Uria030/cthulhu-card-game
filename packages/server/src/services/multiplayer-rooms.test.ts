import { CURRENT_MESSAGE_SCHEMA_VERSION } from '@cthulhu/shared';
import type { IntentMessage, InvestigatorState, ScenarioState, TurnState } from '@cthulhu/shared';
import { MultiplayerRoomService } from './multiplayer-rooms.js';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

function makeService(): MultiplayerRoomService {
  const codes = ['ABCDEF', 'GHIJKL', 'MNPQRS'];
  let index = 0;
  return new MultiplayerRoomService({
    codeFactory: () => codes[index++] ?? 'TVWXYZ',
    now: () => '2026-07-13T00:00:00.000Z',
  });
}

function makeInvestigator(id: string, over: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: id,
    investigatorDefinitionId: id,
    ownerPlayerId: id + '-owner',
    attributes: { strength: 3, agility: 3, constitution: 3, reflex: 3, intellect: 3, willpower: 3, perception: 3, charisma: 3 },
    combatStyle: '', specializations: [], deck: ['card-1'], hand: [], discardPile: [], removedPile: [], assetsInPlay: [],
    hp: 7, hpMax: 7, san: 7, sanMax: 7, actionPoints: 3, resources: 0, currentLocationId: 'loc-a',
    engagedWith: [], triggeredHorrorChecks: [], traumas: [], secretTaskState: null, permanentlyDead: false, startingXp: 0,
    ...over,
  };
}

function makeGame(p2: InvestigatorState = makeInvestigator('inv-2')) {
  const scenario: ScenarioState = {
    scenarioId: 'scenario-1', scenarioDefinitionId: 'scenario-1', campaignId: 'campaign-1',
    locations: [{ locationDefinitionId: 'loc-a', visibility: 'night', connectedTo: [], isObstacle: false }],
    unlockedLocations: ['loc-a'], enemies: [], tokens: [], agendaProgress: 0, objectiveProgress: 0,
    chaosBag: [], turnNumber: 1, phase: 'investigator',
  };
  const turn: TurnState = { turnNumber: 1, phase: 'investigator', actionPointsSpent: {}, pendingLegendaryActions: [], triggeredReactions: [] };
  return {
    scenario,
    investigators: { 'inv-1': makeInvestigator('inv-1'), 'inv-2': p2 },
    turn,
    playerInvestigators: { 'player-1': 'inv-1', 'player-2': 'inv-2' },
  };
}

function intent(playerId: string, investigatorId: string, id: string, actionType: IntentMessage['actionType'], payload: Record<string, unknown> = {}): IntentMessage {
  return {
    id,
    timestamp: '2026-07-13T00:00:00.000Z',
    schemaVersion: CURRENT_MESSAGE_SCHEMA_VERSION,
    source: playerId,
    kind: 'intent',
    playerId,
    investigatorId,
    actionType,
    payload,
  };
}

function activeTwoPlayerRoom(service: MultiplayerRoomService): string {
  const created = service.createRoom({ playerId: 'player-1', username: 'creator01' });
  if (!created.ok) throw new Error(created.error.message);
  const joined = service.joinRoom(created.data.roomCode, { playerId: 'player-2', username: 'creator02' });
  if (!joined.ok) throw new Error(joined.error.message);
  const active = service.activateGame(created.data.roomCode, 'player-1', makeGame());
  if (!active.ok) throw new Error(active.error.message);
  return created.data.roomCode;
}

test('房間生命週期:六碼、最多四席、房主關房', () => {
  const service = makeService();
  const created = service.createRoom({ playerId: 'host', username: 'creator01' });
  assertEq(created.ok, true);
  if (!created.ok) return;
  assertEq(created.data.roomCode, 'ABCDEF');
  assertEq(created.data.members.length, 1);
  assertEq(service.joinRoom('abcdef', { playerId: 'p2', username: 'two' }).ok, true, '房間碼不分大小寫');
  assertEq(service.joinRoom('ABCDEF', { playerId: 'p3', username: 'three' }).ok, true);
  assertEq(service.joinRoom('ABCDEF', { playerId: 'p4', username: 'four' }).ok, true);
  const full = service.joinRoom('ABCDEF', { playerId: 'p5', username: 'five' });
  assertEq(full.ok, false);
  if (!full.ok) assertEq(full.error.code, 'room_full');
  const denied = service.closeRoom('ABCDEF', 'p2');
  assertEq(denied.ok, false);
  if (!denied.ok) assertEq(denied.error.code, 'not_room_host');
  assertEq(service.closeRoom('ABCDEF', 'host').ok, true);
  const gone = service.getSnapshot('ABCDEF', 'host');
  assertEq(gone.ok, false);
  if (!gone.ok) assertEq(gone.error.code, 'room_not_found');
});

test('兩個模擬 client:共享 intent 只裁決一次，快照與效果完全一致', () => {
  const service = makeService();
  const roomCode = activeTwoPlayerRoom(service);
  const clientOne: string[] = [];
  const clientTwo: string[] = [];
  const one = service.subscribe(roomCode, 'player-1', (message) => clientOne.push(JSON.stringify(message)));
  const two = service.subscribe(roomCode, 'player-2', (message) => clientTwo.push(JSON.stringify(message)));
  assertEq(one.ok, true);
  assertEq(two.ok, true);

  const first = service.submitIntent(roomCode, 'player-1', 1, intent('player-1', 'inv-1', 'one-1', 'gain_resource'));
  assertEq(first.ok, true);
  if (!first.ok) return;
  assertEq(first.data.result.outcome, 'accepted');
  assertEq(first.data.snapshot.game?.investigators['inv-1'].resources, 1);
  assertEq(clientOne.length, 1);
  assertEq(clientTwo.length, 1);
  assertEq(clientOne[0], clientTwo[0], '兩端收到同一權威快照與效果');

  const replay = service.submitIntent(roomCode, 'player-1', 1, intent('player-1', 'inv-1', 'one-1', 'gain_resource'));
  assertEq(replay.ok, true);
  if (!replay.ok) return;
  assertEq(replay.data.duplicate, true, '重送只回既有結果');
  assertEq(replay.data.snapshot.game?.investigators['inv-1'].resources, 1, '重送不重複加資源');
  assertEq(clientOne.length, 1, '重送不廣播第二次');

  const outOfOrder = service.submitIntent(roomCode, 'player-2', 2, intent('player-2', 'inv-2', 'two-2', 'gain_resource'));
  assertEq(outOfOrder.ok, false);
  if (!outOfOrder.ok) assertEq(outOfOrder.error.code, 'intent_out_of_order');
  const ordered = service.submitIntent(roomCode, 'player-2', 1, intent('player-2', 'inv-2', 'two-1', 'gain_resource'));
  assertEq(ordered.ok, true, '補回序號 1 後可正常裁決');
  const next = service.submitIntent(roomCode, 'player-2', 2, intent('player-2', 'inv-2', 'two-2', 'gain_resource'));
  assertEq(next.ok, true, '序號 2 隨後可正常裁決');
  if (next.ok) assertEq(next.data.snapshot.game?.investigators['inv-2'].resources, 2);
});

test('updatedAllies 管線:穩定隊友的變動進入同一份權威 snapshot', () => {
  const service = makeService();
  const created = service.createRoom({ playerId: 'player-1', username: 'creator01' });
  if (!created.ok) throw new Error(created.error.message);
  const joined = service.joinRoom(created.data.roomCode, { playerId: 'player-2', username: 'creator02' });
  if (!joined.ok) throw new Error(joined.error.message);
  const downed = makeInvestigator('inv-2', { hp: 0, downed: true, deathSaveSuccesses: 0 });
  const active = service.activateGame(created.data.roomCode, 'player-1', makeGame(downed));
  if (!active.ok) throw new Error(active.error.message);
  const resolved = service.submitIntent(
    created.data.roomCode,
    'player-1',
    1,
    intent('player-1', 'inv-1', 'stabilize-1', 'stabilize', { targetInvestigatorId: 'inv-2' }),
  );
  assertEq(resolved.ok, true);
  if (!resolved.ok) return;
  assertEq(resolved.data.result.outcome, 'accepted');
  assertEq(resolved.data.snapshot.game?.investigators['inv-2'].deathSaveSuccesses, 1);
  assertEq(resolved.data.snapshot.game?.investigators['inv-1'].actionPoints, 2);
});

let passed = 0;
let failed = 0;
const failures: string[] = [];
for (const entry of tests) {
  try { entry.fn(); console.log('✓ ' + entry.name); passed += 1; }
  catch (error: unknown) {
    console.error('✗ ' + entry.name + '\n   ' + (error instanceof Error ? error.message : String(error)));
    failed += 1;
    failures.push(entry.name);
  }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
