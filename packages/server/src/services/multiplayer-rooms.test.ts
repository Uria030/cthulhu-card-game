import { CURRENT_MESSAGE_SCHEMA_VERSION, defaultKeeperProfile } from '@cthulhu/shared';
import type { EncounterTriggerConfig, IntentMessage, InvestigatorState, ScenarioState, TurnState } from '@cthulhu/shared';
import { MultiplayerRoomService } from './multiplayer-rooms.js';
import type { AuthoritativeGameState } from './multiplayer-rooms.js';

type TestFn = () => void | Promise<void>;
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

function makeEncounterGame(): AuthoritativeGameState {
  const game = makeGame();
  const encounterTriggerConfig: EncounterTriggerConfig = { trigger_actions: ['gain_resource'] };
  const encounter = {
    id: 'enc-1',
    name_zh: '雨巷裡的低語',
    scenario_text_zh: '潮濕的磚牆後傳來不該存在的呼吸聲。',
    options: [{
      option_label: '直視陰影',
      option_text_zh: '你握緊手中的燈，逼自己向前一步。',
      no_check_narrative_zh: '陰影退去，地上留下了一張線索。',
      no_check_effects: [{ effect_code: 'discover_clue', amount: 1 }],
    }],
  };
  const roundRuntime: NonNullable<AuthoritativeGameState['roundRuntime']> = {
    mythosCards: [],
    keeperProfile: defaultKeeperProfile(undefined, 2),
    attackCards: {},
    actCards: [],
    agendaCards: [],
    outcomes: [],
    encounterDeck: [encounter],
    encounterSource: [encounter],
    encounterTriggerConfig,
  };
  return {
    ...game,
    roundRuntime,
    ruleContext: { enemyStats: {} },
  };
}

function makeReactionEncounterGame(): AuthoritativeGameState {
  const game = makeEncounterGame();
  if (!game.roundRuntime) throw new Error('missing encounter runtime');
  const encounter = game.roundRuntime.encounterDeck?.[0];
  if (!encounter) throw new Error('missing encounter card');
  encounter.options = [{
    option_label: '硬闖窄巷',
    option_text_zh: '你踏進濕冷的黑暗裡。',
    no_check_narrative_zh: '某種力量撲面而來。',
    no_check_effects: [{ effect_code: 'deal_damage', amount: 2 }],
  }];
  game.investigators['inv-1'] = makeInvestigator('inv-1', { hand: ['guard-1'], resources: 1 });
  game.ruleContext = {
    enemyStats: {},
    cardLookup: {
      'guard-1': {
        name_zh: '緊急格擋', card_type: 'event', cost: 1,
        effects: [{ trigger_type: 'reaction', condition: 'before_take_damage', effect_code: 'heal_hp', effect_params: { amount: 1 } }],
      },
    },
  };
  return game;
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

test('多人 v1 大廳:64 選 1 互斥、全員 ready 與兩真人開局門檻由 server 裁決', () => {
  const service = makeService();
  const created = service.createRoom({ playerId: 'player-1', username: 'creator01' });
  if (!created.ok) throw new Error(created.error.message);
  assertEq(service.canStart(created.data.roomCode, 'player-1').ok, false, '單人不得開始多人 v1');
  const joined = service.joinRoom(created.data.roomCode, { playerId: 'player-2', username: 'creator02' });
  if (!joined.ok) throw new Error(joined.error.message);
  assertEq(service.selectInvestigator(created.data.roomCode, 'player-1', 'template-a', 'save-a').ok, true);
  const duplicate = service.selectInvestigator(created.data.roomCode, 'player-2', 'template-a', 'save-b');
  assertEq(duplicate.ok, false);
  if (!duplicate.ok) assertEq(duplicate.error.code, 'investigator_taken');
  assertEq(service.selectInvestigator(created.data.roomCode, 'player-2', 'template-b', 'save-b').ok, true);
  assertEq(service.setReady(created.data.roomCode, 'player-1', true).ok, true);
  assertEq(service.canStart(created.data.roomCode, 'player-1').ok, false, '另一席尚未 ready');
  assertEq(service.setReady(created.data.roomCode, 'player-2', true).ok, true);
  const ready = service.canStart(created.data.roomCode, 'player-1');
  assertEq(ready.ok, true);
  if (ready.ok) {
    assertEq(ready.data.members[0].investigatorTemplateId, 'template-a');
    assertEq(ready.data.members[1].ready, true);
  }
});

test('斷線代打:控制權切給 AI，重連後交還真人且不改變同一份調查員狀態', () => {
  const service = makeService();
  const roomCode = activeTwoPlayerRoom(service);
  assertEq(service.setConnection(roomCode, 'player-2', true).ok, true);
  const disconnected = service.setConnection(roomCode, 'player-2', false);
  assertEq(disconnected.ok, true);
  if (!disconnected.ok) return;
  assertEq(disconnected.data.members.find((member) => member.playerId === 'player-2')?.connected, false);
  assertEq(disconnected.data.game?.controllerByInvestigator['inv-2'], 'ai');
  const reconnected = service.setConnection(roomCode, 'player-2', true);
  assertEq(reconnected.ok, true);
  if (!reconnected.ok) return;
  assertEq(reconnected.data.game?.controllerByInvestigator['inv-2'], 'human');
  assertEq(reconnected.data.game?.investigators['inv-2'].investigatorId, 'inv-2');
});

test('宣告制結束:AP 未歸零也必須明確宣告，兩席都宣告後才進神話階段', () => {
  const service = makeService();
  const roomCode = activeTwoPlayerRoom(service);
  const first = service.declareActionEnd(roomCode, 'player-1', 1);
  assertEq(first.ok, true);
  if (!first.ok) return;
  assertEq(first.data.snapshot.game?.scenario.phase, 'investigator');
  assertEq(first.data.snapshot.game?.declaredEndByInvestigator.includes('inv-1'), true);
  const second = service.declareActionEnd(roomCode, 'player-2', 1);
  assertEq(second.ok, true);
  if (!second.ok) return;
  assertEq(second.data.snapshot.game?.scenario.phase, 'mythos');
});

test('關卡結束:兩位真人的存檔結算必須由同一份權威狀態一起送出', async () => {
  const service = makeService();
  const created = service.createRoom({ playerId: 'player-1', username: 'creator01' });
  if (!created.ok) throw new Error(created.error.message);
  const joined = service.joinRoom(created.data.roomCode, { playerId: 'player-2', username: 'creator02' });
  if (!joined.ok) throw new Error(joined.error.message);

  const game = makeGame();
  const settled: Array<{ playerId: string; saveId: string; investigator: InvestigatorState }> = [];
  const activated = service.activateGame(created.data.roomCode, 'player-1', {
    ...game,
    stageId: 'stage-settlement',
    playerSaveIds: { 'player-1': 'save-1', 'player-2': 'save-2' },
    roundRuntime: {
      mythosCards: [],
      keeperProfile: defaultKeeperProfile(undefined, 2),
      attackCards: {},
      actCards: [{
        card_order: 1,
        name_zh: '結算驗證幕',
        front_advance_condition: { type: 'clue_threshold', count: 0 },
        back_flag_sets: [{ flag_code: 'victory', value: true }],
        back_resolution_code: 'stage_complete',
      }],
      agendaCards: [],
      outcomes: [{
        outcome_code: 'victory',
        condition_expression: { type: 'flag_check', flag_code: 'victory', expected: true },
      }],
    },
    onScenarioResolved: async ({ players }) => { settled.push(...players); },
  });
  if (!activated.ok) throw new Error(activated.error.message);

  const first = service.declareActionEnd(created.data.roomCode, 'player-1', 1);
  const second = service.declareActionEnd(created.data.roomCode, 'player-2', 1);
  if (!first.ok || !second.ok) throw new Error('human end declaration failed');
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  assertEq(settled.length, 2, '結算 callback 必須收到兩位真人');
  assertEq(settled[0]?.saveId, 'save-1', '第一席使用自己選定的存檔');
  assertEq(settled[1]?.saveId, 'save-2', '第二席使用自己選定的存檔');
  const snapshot = service.getSnapshot(created.data.roomCode, 'player-1');
  assertEq(snapshot.ok, true);
  if (snapshot.ok) assertEq(snapshot.data.game?.resolution?.status, 'saved', '交易成功後才向所有 client 宣告完成');
});

test('指定遭遇:只鎖 target，隊友仍可行動且只有 target 能回應選項', () => {
  const service = makeService();
  const created = service.createRoom({ playerId: 'player-1', username: 'creator01' });
  if (!created.ok) throw new Error(created.error.message);
  const joined = service.joinRoom(created.data.roomCode, { playerId: 'player-2', username: 'creator02' });
  if (!joined.ok) throw new Error(joined.error.message);
  const active = service.activateGame(created.data.roomCode, 'player-1', makeEncounterGame());
  if (!active.ok) throw new Error(active.error.message);

  const drawn = service.submitIntent(created.data.roomCode, 'player-1', 1, intent('player-1', 'inv-1', 'draw-encounter', 'gain_resource'));
  assertEq(drawn.ok, true);
  if (!drawn.ok) return;
  assertEq(drawn.data.snapshot.game?.pendingEncounter?.targetInvestigatorId, 'inv-1', '遭遇指定觸發者');
  const ownerView = service.getPrivateState(created.data.roomCode, 'player-1');
  const teammateView = service.getPrivateState(created.data.roomCode, 'player-2');
  assertEq(ownerView.ok, true);
  assertEq(teammateView.ok, true);
  if (ownerView.ok) assertEq(ownerView.data.pendingEncounter?.nameZh, '雨巷裡的低語', '只有 target 收到選項卡面');
  if (teammateView.ok) assertEq(teammateView.data.pendingEncounter, null, '隊友私有 view 不含他人的選項');

  const blocked = service.submitIntent(created.data.roomCode, 'player-1', 2, intent('player-1', 'inv-1', 'blocked', 'gain_resource'));
  assertEq(blocked.ok, false);
  if (!blocked.ok) assertEq(blocked.error.code, 'encounter_pending', 'target 未選擇前不能偷做其他 action');
  const teammateAction = service.submitIntent(created.data.roomCode, 'player-2', 1, intent('player-2', 'inv-2', 'teammate-free', 'gain_resource'));
  assertEq(teammateAction.ok, true, '另一位真人不會被 target 的 Modal 卡住');
  const encounterId = ownerView.ok ? ownerView.data.pendingEncounter?.id ?? '' : '';
  const wrongSeat = service.resolveEncounterChoice(created.data.roomCode, 'player-2', 2, encounterId, 0);
  assertEq(wrongSeat.ok, false);
  if (!wrongSeat.ok) assertEq(wrongSeat.error.code, 'encounter_not_target', '隊友不可替 target 選選項');
  const resolved = service.resolveEncounterChoice(created.data.roomCode, 'player-1', 2, encounterId, 0);
  assertEq(resolved.ok, true);
  if (resolved.ok) {
    assertEq(resolved.data.snapshot.game?.pendingEncounter, undefined, '選項結算後清除 pending state');
    assertEq(resolved.data.snapshot.game?.scenario.objectiveProgress, 1, '遭遇選項效果由 server 寫入共享局面');
  }
});

test('指定遭遇斷線:AI 接管後會結算 pending，房間不會卡住', () => {
  const service = makeService();
  const created = service.createRoom({ playerId: 'player-1', username: 'creator01' });
  if (!created.ok) throw new Error(created.error.message);
  const joined = service.joinRoom(created.data.roomCode, { playerId: 'player-2', username: 'creator02' });
  if (!joined.ok) throw new Error(joined.error.message);
  const active = service.activateGame(created.data.roomCode, 'player-1', makeEncounterGame());
  if (!active.ok) throw new Error(active.error.message);
  service.setConnection(created.data.roomCode, 'player-1', true);
  const drawn = service.submitIntent(created.data.roomCode, 'player-1', 1, intent('player-1', 'inv-1', 'draw-then-drop', 'gain_resource'));
  if (!drawn.ok) throw new Error(drawn.error.message);
  const disconnected = service.setConnection(created.data.roomCode, 'player-1', false);
  if (!disconnected.ok) throw new Error(disconnected.error.message);
  const fallback = service.resolvePendingEncounterForAi(created.data.roomCode, 'inv-1');
  assertEq(fallback.ok, true, 'AI 接管可選擇既有遭遇選項');
  if (fallback.ok) {
    assertEq(fallback.data.snapshot.game?.pendingEncounter, undefined, 'AI 結算後不保留 pending');
    assertEq(fallback.data.snapshot.game?.scenario.objectiveProgress, 1, 'AI 使用 shared encounter resolver 寫入結果');
  }
});

test('遭遇傷害 reaction:私有候選、隊友自由、invalid 不吞傷害且 pass 才續跑', () => {
  const service = makeService();
  const created = service.createRoom({ playerId: 'player-1', username: 'creator01' });
  if (!created.ok) throw new Error(created.error.message);
  if (!service.joinRoom(created.data.roomCode, { playerId: 'player-2', username: 'creator02' }).ok) throw new Error('join failed');
  if (!service.activateGame(created.data.roomCode, 'player-1', makeReactionEncounterGame()).ok) throw new Error('activate failed');
  const drawn = service.submitIntent(created.data.roomCode, 'player-1', 1, intent('player-1', 'inv-1', 'reaction-draw', 'gain_resource'));
  if (!drawn.ok) throw new Error(drawn.error.message);
  const encounter = service.getPrivateState(created.data.roomCode, 'player-1');
  if (!encounter.ok) throw new Error(encounter.error.message);
  const selected = service.resolveEncounterChoice(created.data.roomCode, 'player-1', 2, encounter.data.pendingEncounter?.id ?? '', 0);
  if (!selected.ok) throw new Error(selected.error.message);
  assertEq(selected.data.snapshot.game?.pendingReaction?.targetInvestigatorId, 'inv-1', '選項傷害先開 reaction window');
  assertEq(selected.data.snapshot.game?.investigators['inv-1']?.hp, 7, '傷害尚未落地');
  const owner = service.getPrivateState(created.data.roomCode, 'player-1');
  const teammate = service.getPrivateState(created.data.roomCode, 'player-2');
  if (!owner.ok || !teammate.ok) throw new Error('private state failed');
  assertEq(owner.data.pendingReaction?.candidates[0]?.name, '緊急格擋', '只有 target 看見候選卡');
  assertEq(teammate.data.pendingReaction, null, '隊友私有資料不含候選卡');
  const blocked = service.submitIntent(created.data.roomCode, 'player-1', 3, intent('player-1', 'inv-1', 'reaction-blocked', 'gain_resource'));
  assertEq(blocked.ok, false);
  if (!blocked.ok) assertEq(blocked.error.code, 'reaction_pending');
  const teammateAction = service.submitIntent(created.data.roomCode, 'player-2', 1, intent('player-2', 'inv-2', 'reaction-teammate-free', 'gain_resource'));
  assertEq(teammateAction.ok, true, '隊友不被別人的 reaction window 鎖住');
  const reactionId = owner.data.pendingReaction?.id ?? '';
  const invalid = service.resolveReactionDecision(created.data.roomCode, 'player-1', 3, reactionId, { kind: 'play', cardInstanceId: 'guard-1', effectIndex: 9 });
  assertEq(invalid.ok, false);
  if (!invalid.ok) assertEq(invalid.error.code, 'reaction_decision_invalid');
  const afterInvalid = service.getSnapshot(created.data.roomCode, 'player-1');
  if (!afterInvalid.ok) throw new Error(afterInvalid.error.message);
  assertEq(afterInvalid.data.game?.pendingReaction?.targetInvestigatorId, 'inv-1', 'invalid 保留同一窗口');
  assertEq(afterInvalid.data.game?.investigators['inv-1']?.hp, 7, 'invalid 不結算原傷害');
  const passed = service.resolveReactionDecision(created.data.roomCode, 'player-1', 3, reactionId, { kind: 'pass' });
  assertEq(passed.ok, true, 'invalid 不消耗 sequence，可用同序號重試');
  if (passed.ok) {
    assertEq(passed.data.snapshot.game?.pendingReaction, undefined, 'pass 後清除窗口');
    assertEq(passed.data.snapshot.game?.investigators['inv-1']?.hp, 5, 'pass 才結算原傷害');
  }
});

test('遭遇傷害 reaction:斷線後 AI 使用合法反應並完成續作', () => {
  const service = makeService();
  const created = service.createRoom({ playerId: 'player-1', username: 'creator01' });
  if (!created.ok) throw new Error(created.error.message);
  if (!service.joinRoom(created.data.roomCode, { playerId: 'player-2', username: 'creator02' }).ok) throw new Error('join failed');
  if (!service.activateGame(created.data.roomCode, 'player-1', makeReactionEncounterGame()).ok) throw new Error('activate failed');
  service.setConnection(created.data.roomCode, 'player-1', true);
  const drawn = service.submitIntent(created.data.roomCode, 'player-1', 1, intent('player-1', 'inv-1', 'reaction-ai-draw', 'gain_resource'));
  if (!drawn.ok) throw new Error(drawn.error.message);
  const encounter = service.getPrivateState(created.data.roomCode, 'player-1');
  if (!encounter.ok) throw new Error(encounter.error.message);
  const selected = service.resolveEncounterChoice(created.data.roomCode, 'player-1', 2, encounter.data.pendingEncounter?.id ?? '', 0);
  if (!selected.ok) throw new Error(selected.error.message);
  if (!service.setConnection(created.data.roomCode, 'player-1', false).ok) throw new Error('disconnect failed');
  const fallback = service.resolvePendingReactionForAi(created.data.roomCode, 'inv-1');
  assertEq(fallback.ok, true, 'AI 接管可處置 reaction window');
  if (fallback.ok) {
    assertEq(fallback.data.snapshot.game?.pendingReaction, undefined, 'AI 完成後不保留 reaction');
    assertEq(fallback.data.snapshot.game?.investigators['inv-1']?.hp, 6, 'AI 使用格擋，2 傷害減為 1');
    assertEq(fallback.data.snapshot.game?.investigators['inv-1']?.discardPile.includes('guard-1'), true, 'AI 付款後照常棄牌');
  }
});

test('回合結束遭遇:依序等每位真人處置後才補給並開新回合', () => {
  const service = makeService();
  const created = service.createRoom({ playerId: 'player-1', username: 'creator01' });
  if (!created.ok) throw new Error(created.error.message);
  const joined = service.joinRoom(created.data.roomCode, { playerId: 'player-2', username: 'creator02' });
  if (!joined.ok) throw new Error(joined.error.message);
  const game = makeEncounterGame();
  if (!game.roundRuntime) throw new Error('missing encounter runtime');
  game.roundRuntime.encounterTriggerConfig = { draw_on_turn_end: true };
  const active = service.activateGame(created.data.roomCode, 'player-1', game);
  if (!active.ok) throw new Error(active.error.message);

  const firstEnd = service.declareActionEnd(created.data.roomCode, 'player-1', 1);
  const secondEnd = service.declareActionEnd(created.data.roomCode, 'player-2', 1);
  if (!firstEnd.ok || !secondEnd.ok) throw new Error('human end declaration failed');
  const firstPending = service.getPrivateState(created.data.roomCode, 'player-1');
  if (!firstPending.ok) throw new Error(firstPending.error.message);
  assertEq(firstPending.data.pendingEncounter?.nameZh, '雨巷裡的低語', '第一席先收到回合結束遭遇');
  const firstResolved = service.resolveEncounterChoice(created.data.roomCode, 'player-1', 2, firstPending.data.pendingEncounter?.id ?? '', 0);
  assertEq(firstResolved.ok, true);
  const secondPending = service.getPrivateState(created.data.roomCode, 'player-2');
  if (!secondPending.ok) throw new Error(secondPending.error.message);
  assertEq(secondPending.data.pendingEncounter?.nameZh, '雨巷裡的低語', '第一席完成後才輪到第二席');
  const secondResolved = service.resolveEncounterChoice(created.data.roomCode, 'player-2', 2, secondPending.data.pendingEncounter?.id ?? '', 0);
  assertEq(secondResolved.ok, true);
  const settled = service.getSnapshot(created.data.roomCode, 'player-1');
  if (!settled.ok) throw new Error(settled.error.message);
  assertEq(settled.data.game?.scenario.phase, 'investigator', '所有回合結束遭遇完成後才開始下一回合');
  assertEq(settled.data.game?.turn.turnNumber, 2, '補給後推進至下一回合');
});

test('城主遭遇:神話派發會進同一 pending resolver，再進入下一回合', () => {
  const service = makeService();
  const created = service.createRoom({ playerId: 'player-1', username: 'creator01' });
  if (!created.ok) throw new Error(created.error.message);
  const joined = service.joinRoom(created.data.roomCode, { playerId: 'player-2', username: 'creator02' });
  if (!joined.ok) throw new Error(joined.error.message);
  const game = makeEncounterGame();
  if (!game.roundRuntime) throw new Error('missing encounter runtime');
  game.scenario = { ...game.scenario, turnNumber: 3 };
  game.turn = { ...game.turn, turnNumber: 3 };
  game.roundRuntime.encounterTriggerConfig = { keeper_mythos: true };
  game.roundRuntime.mythosCards = [{
    id: 'keeper-encounter', name_zh: '城主的耳語', card_category: 'encounter', action_cost: 0,
    intensity_tag: 'small', activation_timing: 'keeper_phase', reusable: false, effects: [],
  }];
  const active = service.activateGame(created.data.roomCode, 'player-1', game);
  if (!active.ok) throw new Error(active.error.message);
  const firstEnd = service.declareActionEnd(created.data.roomCode, 'player-1', 1);
  const secondEnd = service.declareActionEnd(created.data.roomCode, 'player-2', 1);
  if (!firstEnd.ok || !secondEnd.ok) throw new Error('human end declaration failed');
  const pending = service.getPrivateState(created.data.roomCode, 'player-1');
  if (!pending.ok) throw new Error(pending.error.message);
  assertEq(pending.data.pendingEncounter?.nameZh, '雨巷裡的低語', '城主 encounter 會抽遭遇池並指定 anchor');
  const resolved = service.resolveEncounterChoice(created.data.roomCode, 'player-1', 2, pending.data.pendingEncounter?.id ?? '', 0);
  assertEq(resolved.ok, true);
  const after = service.getSnapshot(created.data.roomCode, 'player-1');
  if (!after.ok) throw new Error(after.error.message);
  assertEq(after.data.game?.scenario.phase, 'investigator', '城主遭遇處置後才進下一回合');
});

test('混沌頭條:施法抽到 headline 時會開啟同一份 pending encounter', () => {
  const service = makeService();
  const created = service.createRoom({ playerId: 'player-1', username: 'creator01' });
  if (!created.ok) throw new Error(created.error.message);
  const joined = service.joinRoom(created.data.roomCode, { playerId: 'player-2', username: 'creator02' });
  if (!joined.ok) throw new Error(joined.error.message);
  const game = makeEncounterGame();
  if (!game.roundRuntime) throw new Error('missing encounter runtime');
  game.roundRuntime.encounterTriggerConfig = { chaos_headline: true };
  game.investigators['inv-1'] = makeInvestigator('inv-1', { hand: ['spell-1'], resources: 1 });
  game.scenario = { ...game.scenario, chaosBag: [{ tokenId: 'headline-1', type: 'headline', value: null }] };
  game.ruleContext = {
    enemyStats: {},
    cardLookup: {
      'spell-1': {
        name_zh: '霧中的咒語', card_type: 'event', combat_style: 'arcane', cost: 0,
        effects: [{ trigger_type: 'action', effect_code: 'deal_damage', effect_params: { amount: 1 } }],
      },
    },
  };
  const active = service.activateGame(created.data.roomCode, 'player-1', game);
  if (!active.ok) throw new Error(active.error.message);
  const cast = service.submitIntent(created.data.roomCode, 'player-1', 1, intent('player-1', 'inv-1', 'cast-headline', 'play_card', { cardInstanceId: 'spell-1' }));
  assertEq(cast.ok, true);
  if (!cast.ok) return;
  assertEq(cast.data.snapshot.game?.pendingEncounter?.targetInvestigatorId, 'inv-1', 'headline 由 server 轉成 target pending');
  const pending = service.getPrivateState(created.data.roomCode, 'player-1');
  if (!pending.ok) throw new Error(pending.error.message);
  assertEq(pending.data.pendingEncounter?.nameZh, '雨巷裡的低語', 'headline 不由 client 抽卡');
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
