/**
 * MP-N1 server-authoritative in-memory room service.
 *
 * A room owns one shared engine state. Clients never submit a state patch: they
 * submit a sequenced IntentMessage and receive a snapshot plus engine effects.
 */
import { createRequire } from 'node:module';
import type {
  IntentMessage,
  InvestigatorState,
  MultiplayerErrorMessage,
  MultiplayerAiTurnMessage,
  MultiplayerIntentResolvedMessage,
  MultiplayerPhaseChangedMessage,
  MultiplayerRoomClosedMessage,
  MultiplayerRoomMember,
  MultiplayerRoomSnapshot,
  MultiplayerRoomSnapshotMessage,
  MultiplayerCardView,
  MultiplayerPrivateState,
  MultiplayerSeatController,
  MultiplayerServerMessage,
  ResultMessage,
  ResultEffect,
  RuleContext,
  ScenarioState,
  TurnState,
  InvestigatorAIProfile,
  InvestigatorAIState,
  MythosCardData,
  KeeperProfile,
  AttackCardLookup,
  ActCardData,
  AgendaCardData,
  OutcomeData,
  EncounterCardData,
  EncounterEffect,
  EncounterTriggerConfig,
  EncounterTriggerContext,
  PendingReaction,
  ReactionDecision,
} from '@cthulhu/shared';

// @cthulhu/shared is emitted as CommonJS so the production Node server and the
// Vite client consume the same compiled engine contract.
const require = createRequire(import.meta.url);
const sharedRuntime = require('@cthulhu/shared') as typeof import('@cthulhu/shared');
const {
  CURRENT_MESSAGE_SCHEMA_VERSION,
  initInvestigatorAIState,
  runInvestigatorAITurn,
  initKeeperState,
  snapshotSituation,
  selectKeeperActivations,
  executeMythosCard,
  activateMonsters,
  runFearChecks,
  progressTick,
  evaluateOutcome,
  chooseEncounterOption,
  drawTriggeredEncounter,
  prepareEncounterOption,
  applyEncounterEffects,
  encounterReactionOperation,
  openReactionWindow,
  resolvePendingReaction,
  settleReactionOperation,
  runTurnEndUpkeep,
  runTurnStartUpkeep,
  resolveIntent,
} = sharedRuntime;

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const MAX_ROOM_MEMBERS = 4;

export interface RoomPlayer {
  playerId: string;
  username: string;
}

export interface AuthoritativeGameState {
  /** N2 lobby start writes the stage identity; N1 tests may omit it. */
  stageId?: string;
  scenario: ScenarioState;
  investigators: Record<string, InvestigatorState>;
  turn: TurnState;
  /** playerId -> controlled investigatorId. */
  playerInvestigators: Record<string, string>;
  /** playerId -> selected active investigator_saves row for server settlement. */
  playerSaveIds?: Record<string, string>;
  /** Per-investigator controller; a disconnected human is switched to AI. */
  controllerByInvestigator?: Record<string, MultiplayerSeatController>;
  /** Profiles and local AI planner state never leave the server snapshot. */
  aiProfilesByInvestigator?: Record<string, InvestigatorAIProfile>;
  aiStatesByInvestigator?: Record<string, InvestigatorAIState>;
  /** Explicit declarations replace the single-player AP-zero auto-end behavior. */
  declaredEndByInvestigator?: string[];
  /** Server-only phase data assembled from the trusted bootstrap. */
  roundRuntime?: {
    mythosCards: MythosCardData[];
    keeperProfile: KeeperProfile;
    attackCards: AttackCardLookup;
    actCards: ActCardData[];
    agendaCards: AgendaCardData[];
    outcomes: OutcomeData[];
    encounterDeck?: EncounterCardData[];
    encounterSource?: EncounterCardData[];
    encounterTriggerConfig?: EncounterTriggerConfig;
  };
  campaignFlags?: Record<string, unknown>;
  pendingEncounter?: PendingEncounter;
  /** A reaction pauses an already selected encounter-effect queue. */
  pendingReaction?: PendingReaction;
  pendingEncounterResolution?: PendingEncounterResolution;
  pendingTurnEndEncounterInvestigators?: string[];
  pendingMythosEncounterEntries?: QueuedEncounter[];
  resolution?: { outcomeCode: string; status: 'pending' | 'saved' | 'failed' };
  /** A server-only transaction callback installed by the N2 route. */
  onScenarioResolved?: (input: {
    stageId: string;
    outcome: OutcomeData;
    flags: Record<string, unknown>;
    players: Array<{ playerId: string; saveId: string; investigator: InvestigatorState }>;
  }) => Promise<void>;
  /** Server-only rule data; it is intentionally absent from snapshots. */
  ruleContext?: Omit<RuleContext, 'scenario' | 'investigator' | 'investigators' | 'turn'>;
}

interface PendingEncounter {
  id: string;
  targetInvestigatorId: string;
  card: EncounterCardData;
  context: EncounterTriggerContext;
}

interface PendingEncounterResolution {
  id: string;
  targetInvestigatorId: string;
  remainingEffects: EncounterEffect[];
}

interface QueuedEncounter {
  targetInvestigatorId: string;
  context: EncounterTriggerContext;
}

export interface RoomServiceError {
  code:
    | 'room_not_found'
    | 'room_closed'
    | 'room_full'
    | 'not_room_member'
    | 'not_room_host'
    | 'room_already_active'
    | 'selection_required'
    | 'save_required'
    | 'investigator_taken'
    | 'not_ready'
    | 'requires_two_players'
    | 'game_not_active'
    | 'investigator_not_controlled'
    | 'intent_out_of_order'
    | 'encounter_pending'
    | 'encounter_not_pending'
    | 'encounter_not_target'
    | 'encounter_option_invalid'
    | 'reaction_pending'
    | 'reaction_not_pending'
    | 'reaction_not_target'
    | 'reaction_decision_invalid'
    | 'invalid_room_code';
  message: string;
  snapshot?: MultiplayerRoomSnapshot;
}

export type RoomServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: RoomServiceError };

export interface MultiplayerRoomServiceOptions {
  codeFactory?: () => string;
  now?: () => string;
}

interface RoomRecord {
  code: string;
  hostPlayerId: string;
  phase: 'lobby' | 'active';
  version: number;
  members: Map<string, MultiplayerRoomMember>;
  game?: AuthoritativeGameState;
  connectionCountByPlayer: Map<string, number>;
  lastSequenceByPlayer: Map<string, number>;
  processedByPlayer: Map<string, Map<number, MultiplayerIntentResolvedMessage>>;
}

type RoomListener = (message: MultiplayerServerMessage) => void;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function defaultRoomCode(): string {
  let code = '';
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

function isRoomCode(code: string): boolean {
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code);
}

export class MultiplayerRoomService {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly listeners = new Map<string, Map<string, Set<RoomListener>>>();
  private readonly codeFactory: () => string;
  private readonly now: () => string;

  constructor(options: MultiplayerRoomServiceOptions = {}) {
    this.codeFactory = options.codeFactory ?? defaultRoomCode;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  createRoom(host: RoomPlayer): RoomServiceResult<MultiplayerRoomSnapshot> {
    let code = '';
    for (let attempt = 0; attempt < 32; attempt += 1) {
      code = normalizeRoomCode(this.codeFactory());
      if (isRoomCode(code) && !this.rooms.has(code)) break;
      code = '';
    }
    if (!code) {
      return { ok: false, error: { code: 'invalid_room_code', message: '無法產生可用房間碼，請重試。' } };
    }

    const member: MultiplayerRoomMember = {
      playerId: host.playerId,
      username: host.username,
      connected: false,
      joinedAt: this.now(),
      investigatorTemplateId: null,
      saveId: null,
      ready: false,
    };
    const room: RoomRecord = {
      code,
      hostPlayerId: host.playerId,
      phase: 'lobby',
      version: 0,
      members: new Map([[host.playerId, member]]),
      connectionCountByPlayer: new Map([[host.playerId, 0]]),
      lastSequenceByPlayer: new Map(),
      processedByPlayer: new Map(),
    };
    this.rooms.set(code, room);
    return { ok: true, data: this.snapshot(room) };
  }

  joinRoom(codeInput: string, player: RoomPlayer): RoomServiceResult<MultiplayerRoomSnapshot> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    if (room.data.phase === 'active') {
      return { ok: false, error: { code: 'room_already_active', message: '遊戲已開始，不能再加入新席位。', snapshot: this.snapshot(room.data) } };
    }
    const existing = room.data.members.get(player.playerId);
    if (!existing && room.data.members.size >= MAX_ROOM_MEMBERS) {
      return { ok: false, error: { code: 'room_full', message: '房間已滿（最多 4 人）。', snapshot: this.snapshot(room.data) } };
    }
    const connectionCount = room.data.connectionCountByPlayer.get(player.playerId) ?? 0;
    const changed = !existing || existing.username !== player.username;
    room.data.members.set(player.playerId, {
      playerId: player.playerId,
      username: player.username,
      connected: connectionCount > 0,
      joinedAt: existing?.joinedAt ?? this.now(),
      investigatorTemplateId: existing?.investigatorTemplateId ?? null,
      saveId: existing?.saveId ?? null,
      ready: existing?.ready ?? false,
    });
    room.data.connectionCountByPlayer.set(player.playerId, connectionCount);
    room.data.version += changed ? 1 : 0;
    const snapshot = this.snapshot(room.data);
    this.broadcast(room.data, { type: 'room_snapshot', snapshot });
    return { ok: true, data: snapshot };
  }

  leaveRoom(codeInput: string, playerId: string): RoomServiceResult<{ closed: boolean; snapshot?: MultiplayerRoomSnapshot }> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    if (!room.data.members.has(playerId)) return this.notMember(room.data);

    if (room.data.hostPlayerId === playerId) {
      this.closeRoomRecord(room.data);
      return { ok: true, data: { closed: true } };
    }

    room.data.members.delete(playerId);
    room.data.connectionCountByPlayer.delete(playerId);
    room.data.lastSequenceByPlayer.delete(playerId);
    room.data.processedByPlayer.delete(playerId);
    room.data.version += 1;
    const snapshot = this.snapshot(room.data);
    this.broadcast(room.data, { type: 'room_snapshot', snapshot });
    return { ok: true, data: { closed: false, snapshot } };
  }

  closeRoom(codeInput: string, playerId: string): RoomServiceResult<{ closed: true }> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    if (room.data.hostPlayerId !== playerId) {
      return { ok: false, error: { code: 'not_room_host', message: '只有房主可以關閉房間。', snapshot: this.snapshot(room.data) } };
    }
    this.closeRoomRecord(room.data);
    return { ok: true, data: { closed: true } };
  }

  getSnapshot(codeInput: string, playerId: string): RoomServiceResult<MultiplayerRoomSnapshot> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    if (!room.data.members.has(playerId)) return this.notMember(room.data);
    return { ok: true, data: this.snapshot(room.data) };
  }

  /**
   * Card names and actionable metadata are private to the owning seat. The
   * shared room snapshot deliberately remains a board-state contract only.
   */
  getPrivateState(codeInput: string, playerId: string): RoomServiceResult<MultiplayerPrivateState> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    if (!room.data.members.has(playerId)) return this.notMember(room.data);
    const game = room.data.game;
    if (!game || room.data.phase !== 'active') {
      return { ok: false, error: { code: 'game_not_active', message: '房間尚未啟動遊戲引擎。', snapshot: this.snapshot(room.data) } };
    }
    const investigatorId = game.playerInvestigators[playerId];
    const investigator = investigatorId ? game.investigators[investigatorId] : undefined;
    if (!investigator) {
      return { ok: false, error: { code: 'investigator_not_controlled', message: '找不到此玩家控制的調查員。', snapshot: this.snapshot(room.data) } };
    }
    const toCardView = (cardId: string): MultiplayerCardView => {
      const data = game.ruleContext?.cardLookup?.[cardId];
      const usesLeft = investigator.assetState?.[cardId]?.usesLeft;
      return {
        instanceId: cardId,
        nameZh: String(data?.name_zh ?? cardId),
        cardType: String(data?.card_type ?? 'unknown'),
        cost: Number(data?.cost ?? 0),
        commitIcons: { ...(data?.commit_icons ?? {}) },
        canConsume: data?.consume_enabled === true && !!data.consume_effect,
        actionCount: (data?.effects ?? []).filter((effect) => effect.trigger_type === 'action').length,
        usesLeft: typeof usesLeft === 'number' ? usesLeft : null,
      };
    };
    return {
      ok: true,
      data: {
        investigatorId,
        hand: investigator.hand.map(toCardView),
        assets: investigator.assetsInPlay.map(toCardView),
        pendingEncounter: game.pendingEncounter?.targetInvestigatorId === investigatorId
          ? {
              id: game.pendingEncounter.id,
              nameZh: game.pendingEncounter.card.name_zh,
              scenarioText: String(game.pendingEncounter.card.scenario_text_zh ?? ''),
              options: (game.pendingEncounter.card.options ?? []).map((option, index) => ({
                index,
                label: String(option.option_label ?? `選項 ${index + 1}`),
                text: String(option.option_text_zh ?? option.no_check_narrative_zh ?? ''),
              })),
            }
          : null,
        pendingReaction: game.pendingReaction?.targetInvestigatorId === investigatorId
          ? {
              id: game.pendingReaction.id,
              trigger: game.pendingReaction.trigger,
              operation: clone(game.pendingReaction.operation),
              candidates: game.pendingReaction.candidates.map((candidate) => ({ ...candidate })),
            }
          : null,
      },
    };
  }

  setConnection(codeInput: string, playerId: string, connected: boolean): RoomServiceResult<MultiplayerRoomSnapshot> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    const member = room.data.members.get(playerId);
    if (!member) return this.notMember(room.data);
    const currentCount = room.data.connectionCountByPlayer.get(playerId) ?? (member.connected ? 1 : 0);
    const nextCount = connected ? currentCount + 1 : Math.max(0, currentCount - 1);
    const nextConnected = nextCount > 0;
    room.data.connectionCountByPlayer.set(playerId, nextCount);
    if (member.connected === nextConnected) return { ok: true, data: this.snapshot(room.data) };
    room.data.members.set(playerId, { ...member, connected: nextConnected });
    const investigatorId = room.data.game?.playerInvestigators[playerId];
    if (investigatorId && room.data.game) {
      room.data.game.controllerByInvestigator = {
        ...(room.data.game.controllerByInvestigator ?? {}),
        [investigatorId]: nextConnected ? 'human' : 'ai',
      };
    }
    room.data.version += 1;
    const snapshot = this.snapshot(room.data);
    this.broadcast(room.data, { type: 'room_snapshot', snapshot });
    return { ok: true, data: snapshot };
  }

  selectInvestigator(
    codeInput: string,
    playerId: string,
    investigatorTemplateId: string,
    saveId: string,
  ): RoomServiceResult<MultiplayerRoomSnapshot> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    if (room.data.phase !== 'lobby') {
      return { ok: false, error: { code: 'room_already_active', message: '遊戲已開始，不能改選調查員。', snapshot: this.snapshot(room.data) } };
    }
    const member = room.data.members.get(playerId);
    if (!member) return this.notMember(room.data);
    const selected = investigatorTemplateId.trim();
    if (!selected) {
      return { ok: false, error: { code: 'selection_required', message: '請先選擇一位調查員。', snapshot: this.snapshot(room.data) } };
    }
    const selectedSave = saveId.trim();
    if (!selectedSave) {
      return { ok: false, error: { code: 'save_required', message: '請先選擇要寫入的調查員存檔。', snapshot: this.snapshot(room.data) } };
    }
    const owner = [...room.data.members.values()].find((seat) =>
      seat.playerId !== playerId && seat.investigatorTemplateId === selected,
    );
    if (owner) {
      return { ok: false, error: { code: 'investigator_taken', message: '這位調查員已被其他席位選走。', snapshot: this.snapshot(room.data) } };
    }
    room.data.members.set(playerId, { ...member, investigatorTemplateId: selected, saveId: selectedSave, ready: false });
    room.data.version += 1;
    const snapshot = this.snapshot(room.data);
    this.broadcast(room.data, { type: 'room_snapshot', snapshot });
    return { ok: true, data: snapshot };
  }

  setReady(codeInput: string, playerId: string, ready: boolean): RoomServiceResult<MultiplayerRoomSnapshot> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    if (room.data.phase !== 'lobby') {
      return { ok: false, error: { code: 'room_already_active', message: '遊戲已開始，不能改變 ready 狀態。', snapshot: this.snapshot(room.data) } };
    }
    const member = room.data.members.get(playerId);
    if (!member) return this.notMember(room.data);
    if (ready && (!member.investigatorTemplateId || !member.saveId)) {
      return { ok: false, error: { code: 'selection_required', message: '選擇調查員後才能 ready。', snapshot: this.snapshot(room.data) } };
    }
    if (member.ready === ready) return { ok: true, data: this.snapshot(room.data) };
    room.data.members.set(playerId, { ...member, ready });
    room.data.version += 1;
    const snapshot = this.snapshot(room.data);
    this.broadcast(room.data, { type: 'room_snapshot', snapshot });
    return { ok: true, data: snapshot };
  }

  canStart(codeInput: string, playerId: string): RoomServiceResult<MultiplayerRoomSnapshot> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    if (room.data.hostPlayerId !== playerId) {
      return { ok: false, error: { code: 'not_room_host', message: '只有房主可以開始關卡。', snapshot: this.snapshot(room.data) } };
    }
    if (room.data.phase !== 'lobby') {
      return { ok: false, error: { code: 'room_already_active', message: '此房間已經開始。', snapshot: this.snapshot(room.data) } };
    }
    if (room.data.members.size < 2) {
      return { ok: false, error: { code: 'requires_two_players', message: '多人 v1 需要至少兩位真人調查員。', snapshot: this.snapshot(room.data) } };
    }
    const incomplete = [...room.data.members.values()].find((member) => !member.investigatorTemplateId || !member.ready);
    if (incomplete) {
      return { ok: false, error: { code: 'not_ready', message: '所有真人席位都必須選人並 ready。', snapshot: this.snapshot(room.data) } };
    }
    return { ok: true, data: this.snapshot(room.data) };
  }

  /**
   * N2 will call this after server-side selection and ready validation. N1 exposes
   * it for the authority integration test without opening a client state-patch API.
   */
  activateGame(codeInput: string, hostPlayerId: string, game: AuthoritativeGameState): RoomServiceResult<MultiplayerRoomSnapshot> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    if (room.data.hostPlayerId !== hostPlayerId) {
      return { ok: false, error: { code: 'not_room_host', message: '只有房主可以啟動房間引擎。', snapshot: this.snapshot(room.data) } };
    }
    for (const [playerId, investigatorId] of Object.entries(game.playerInvestigators)) {
      if (!room.data.members.has(playerId) || !game.investigators[investigatorId]) {
        return { ok: false, error: { code: 'investigator_not_controlled', message: '房間席位與調查員控制權不一致。', snapshot: this.snapshot(room.data) } };
      }
    }
    room.data.game = {
      ...game,
      stageId: game.stageId ?? '',
      scenario: clone(game.scenario),
      investigators: clone(game.investigators),
      turn: clone(game.turn),
      playerInvestigators: { ...game.playerInvestigators },
      playerSaveIds: { ...(game.playerSaveIds ?? {}) },
      controllerByInvestigator: { ...(game.controllerByInvestigator ?? Object.fromEntries(Object.values(game.playerInvestigators).map((id) => [id, 'human' as const]))) },
      aiProfilesByInvestigator: { ...(game.aiProfilesByInvestigator ?? {}) },
      aiStatesByInvestigator: { ...(game.aiStatesByInvestigator ?? {}) },
      declaredEndByInvestigator: [...(game.declaredEndByInvestigator ?? [])],
      roundRuntime: game.roundRuntime,
      campaignFlags: { ...(game.campaignFlags ?? {}) },
      resolution: game.resolution,
      pendingEncounter: game.pendingEncounter ? clone(game.pendingEncounter) : undefined,
      pendingReaction: game.pendingReaction ? clone(game.pendingReaction) : undefined,
      pendingEncounterResolution: game.pendingEncounterResolution ? clone(game.pendingEncounterResolution) : undefined,
      pendingTurnEndEncounterInvestigators: [...(game.pendingTurnEndEncounterInvestigators ?? [])],
      pendingMythosEncounterEntries: game.pendingMythosEncounterEntries
        ? game.pendingMythosEncounterEntries.map((entry) => clone(entry))
        : undefined,
      onScenarioResolved: game.onScenarioResolved,
      // Rule context may contain an injected RNG for deterministic server tests;
      // it is server-only and must not be JSON-cloned into a snapshot.
      ruleContext: game.ruleContext,
    };
    room.data.phase = 'active';
    room.data.version += 1;
    const snapshot = this.snapshot(room.data);
    this.broadcast(room.data, { type: 'room_snapshot', snapshot });
    return { ok: true, data: snapshot };
  }

  declareActionEnd(codeInput: string, playerId: string, sequence: number): RoomServiceResult<MultiplayerIntentResolvedMessage> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    if (!room.data.members.has(playerId)) return this.notMember(room.data);
    if (!room.data.game || room.data.phase !== 'active') {
      return { ok: false, error: { code: 'game_not_active', message: '房間尚未啟動遊戲引擎。', snapshot: this.snapshot(room.data) } };
    }
    const game = room.data.game;
    const investigatorId = game.playerInvestigators[playerId];
    if (!investigatorId || game.controllerByInvestigator?.[investigatorId] === 'ai') {
      return { ok: false, error: { code: 'investigator_not_controlled', message: '此席目前由 AI 控制。', snapshot: this.snapshot(room.data) } };
    }
    if (game.pendingEncounter?.targetInvestigatorId === investigatorId) {
      return { ok: false, error: { code: 'encounter_pending', message: '眼前的遭遇尚待你選擇處置，不能宣告結束。', snapshot: this.snapshot(room.data) } };
    }
    if (game.pendingReaction?.targetInvestigatorId === investigatorId) {
      return { ok: false, error: { code: 'reaction_pending', message: '你尚未決定是否打出反應卡，不能宣告結束。', snapshot: this.snapshot(room.data) } };
    }
    const lastSequence = room.data.lastSequenceByPlayer.get(playerId) ?? 0;
    const prior = room.data.processedByPlayer.get(playerId)?.get(sequence);
    if (prior) return { ok: true, data: { ...clone(prior), duplicate: true } };
    if (!Number.isInteger(sequence) || sequence !== lastSequence + 1) {
      return { ok: false, error: { code: 'intent_out_of_order', message: `意圖序號失序：預期 ${lastSequence + 1}。`, snapshot: this.snapshot(room.data) } };
    }
    const declared = new Set(game.declaredEndByInvestigator ?? []);
    declared.add(investigatorId);
    game.declaredEndByInvestigator = [...declared];
    room.data.lastSequenceByPlayer.set(playerId, sequence);
    room.data.version += 1;
    this.advanceWhenEveryoneDeclared(room.data);
    const result: ResultMessage = {
      id: `room:${room.data.code}:declare:${playerId}:${sequence}`,
      timestamp: this.now(),
      schemaVersion: CURRENT_MESSAGE_SCHEMA_VERSION,
      source: 'server',
      kind: 'result',
      inResponseTo: `declare:${sequence}`,
      outcome: 'accepted',
      effects: [{ type: 'action_end_declared', params: { investigatorId } }],
    };
    const message: MultiplayerIntentResolvedMessage = {
      type: 'intent_resolved', actorPlayerId: playerId, sequence, result, snapshot: this.snapshot(room.data),
    };
    if (!room.data.processedByPlayer.has(playerId)) room.data.processedByPlayer.set(playerId, new Map());
    room.data.processedByPlayer.get(playerId)?.set(sequence, clone(message));
    this.broadcast(room.data, message);
    return { ok: true, data: message };
  }

  resolveEncounterChoice(
    codeInput: string,
    playerId: string,
    sequence: number,
    encounterId: string,
    optionIndex: number,
  ): RoomServiceResult<MultiplayerIntentResolvedMessage> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    if (!room.data.members.has(playerId)) return this.notMember(room.data);
    const game = room.data.game;
    if (!game || room.data.phase !== 'active') {
      return { ok: false, error: { code: 'game_not_active', message: '房間尚未啟動遊戲引擎。', snapshot: this.snapshot(room.data) } };
    }
    const lastSequence = room.data.lastSequenceByPlayer.get(playerId) ?? 0;
    const prior = room.data.processedByPlayer.get(playerId)?.get(sequence);
    if (prior) return { ok: true, data: { ...clone(prior), duplicate: true } };
    if (!Number.isInteger(sequence) || sequence !== lastSequence + 1) {
      return { ok: false, error: { code: 'intent_out_of_order', message: `意圖序號失序：預期 ${lastSequence + 1}。`, snapshot: this.snapshot(room.data) } };
    }
    const pending = game.pendingEncounter;
    if (!pending || pending.id !== encounterId) {
      return { ok: false, error: { code: 'encounter_not_pending', message: '這個遭遇已經結束或不再有效。', snapshot: this.snapshot(room.data) } };
    }
    if (game.playerInvestigators[playerId] !== pending.targetInvestigatorId) {
      return { ok: false, error: { code: 'encounter_not_target', message: '這個遭遇指定由另一位調查員處置。', snapshot: this.snapshot(room.data) } };
    }
    const option = pending.card.options?.[optionIndex];
    if (!option || !Number.isInteger(optionIndex) || optionIndex < 0) {
      return { ok: false, error: { code: 'encounter_option_invalid', message: '遭遇選項已不存在，請重新查看目前局面。', snapshot: this.snapshot(room.data) } };
    }
    const investigator = game.investigators[pending.targetInvestigatorId];
    if (!investigator) {
      return { ok: false, error: { code: 'investigator_not_controlled', message: '找不到遭遇指定的調查員。', snapshot: this.snapshot(room.data) } };
    }
    const continued = this.startEncounterResolution(room.data, pending, optionIndex, investigator);
    room.data.lastSequenceByPlayer.set(playerId, sequence);
    room.data.version += 1;
    const result: ResultMessage = {
      id: `room:${room.data.code}:encounter:${pending.id}:${sequence}`,
      timestamp: this.now(),
      schemaVersion: CURRENT_MESSAGE_SCHEMA_VERSION,
      source: 'server',
      kind: 'result',
      inResponseTo: `encounter:${encounterId}`,
      outcome: 'accepted',
      effects: continued.effects.map((effect) => effect.targetId ? effect : { ...effect, targetId: investigator.investigatorId }),
    };
    const message: MultiplayerIntentResolvedMessage = {
      type: 'intent_resolved', actorPlayerId: playerId, sequence, result, snapshot: this.snapshot(room.data),
    };
    if (!room.data.processedByPlayer.has(playerId)) room.data.processedByPlayer.set(playerId, new Map());
    room.data.processedByPlayer.get(playerId)?.set(sequence, clone(message));
    this.broadcast(room.data, message);
    if (continued.complete) this.resumeEncounterQueues(room.data);
    return { ok: true, data: message };
  }

  /** An abnormal disconnect hands a pending encounter to the same AI seat. */
  resolvePendingEncounterForAi(codeInput: string, investigatorId: string): RoomServiceResult<MultiplayerIntentResolvedMessage> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    const game = room.data.game;
    const pending = game?.pendingEncounter;
    if (!game || !pending || pending.targetInvestigatorId !== investigatorId) {
      return { ok: false, error: { code: 'encounter_not_pending', message: '此席沒有待處置的遭遇。', snapshot: this.snapshot(room.data) } };
    }
    if (game.controllerByInvestigator?.[investigatorId] !== 'ai') {
      return { ok: false, error: { code: 'investigator_not_controlled', message: '此席尚未由 AI 接管。', snapshot: this.snapshot(room.data) } };
    }
    const playerId = Object.entries(game.playerInvestigators).find(([, id]) => id === investigatorId)?.[0];
    const investigator = game.investigators[investigatorId];
    const options = pending.card.options ?? [];
    if (!playerId || !investigator || options.length === 0) {
      return { ok: false, error: { code: 'encounter_not_pending', message: '待處置遭遇資料不完整。', snapshot: this.snapshot(room.data) } };
    }
    const optionIndex = Math.max(0, Math.min(options.length - 1, chooseEncounterOption(pending.card, investigator)));
    const continued = this.startEncounterResolution(room.data, pending, optionIndex, investigator);
    const sequence = (room.data.lastSequenceByPlayer.get(playerId) ?? 0) + 1;
    room.data.lastSequenceByPlayer.set(playerId, sequence);
    room.data.version += 1;
    const result: ResultMessage = {
      id: `room:${room.data.code}:encounter-ai:${pending.id}:${sequence}`,
      timestamp: this.now(), schemaVersion: CURRENT_MESSAGE_SCHEMA_VERSION, source: 'server', kind: 'result',
      inResponseTo: `encounter:${pending.id}`,
      outcome: 'accepted',
      effects: continued.effects.map((effect) => effect.targetId ? effect : { ...effect, targetId: investigatorId }),
    };
    const message: MultiplayerIntentResolvedMessage = {
      type: 'intent_resolved', actorPlayerId: playerId, sequence, result, snapshot: this.snapshot(room.data),
    };
    this.broadcast(room.data, message);
    if (continued.complete) this.resumeEncounterQueues(room.data);
    return { ok: true, data: message };
  }

  resolveReactionDecision(
    codeInput: string,
    playerId: string,
    sequence: number,
    reactionId: string,
    decision: ReactionDecision,
  ): RoomServiceResult<MultiplayerIntentResolvedMessage> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    if (!room.data.members.has(playerId)) return this.notMember(room.data);
    const game = room.data.game;
    if (!game || room.data.phase !== 'active') {
      return { ok: false, error: { code: 'game_not_active', message: '房間尚未啟動遊戲引擎。', snapshot: this.snapshot(room.data) } };
    }
    const lastSequence = room.data.lastSequenceByPlayer.get(playerId) ?? 0;
    const prior = room.data.processedByPlayer.get(playerId)?.get(sequence);
    if (prior) return { ok: true, data: { ...clone(prior), duplicate: true } };
    if (!Number.isInteger(sequence) || sequence !== lastSequence + 1) {
      return { ok: false, error: { code: 'intent_out_of_order', message: `意圖序號失序：預期 ${lastSequence + 1}。`, snapshot: this.snapshot(room.data) } };
    }
    const pending = game.pendingReaction;
    if (!pending || pending.id !== reactionId) {
      return { ok: false, error: { code: 'reaction_not_pending', message: '這個反應窗口已結束或不再有效。', snapshot: this.snapshot(room.data) } };
    }
    if (game.playerInvestigators[playerId] !== pending.targetInvestigatorId) {
      return { ok: false, error: { code: 'reaction_not_target', message: '這個反應窗口指定由另一位調查員處置。', snapshot: this.snapshot(room.data) } };
    }
    const investigator = game.investigators[pending.targetInvestigatorId];
    if (!investigator) {
      return { ok: false, error: { code: 'investigator_not_controlled', message: '找不到反應窗口指定的調查員。', snapshot: this.snapshot(room.data) } };
    }
    const resolved = resolvePendingReaction(pending, decision, investigator, game.turn.triggeredReactions);
    // An invalid decision consumes neither the original damage nor this sequence.
    // The target receives the still-open private window and may retry or pass.
    if (resolved.outcome === 'invalid') {
      return { ok: false, error: { code: 'reaction_decision_invalid', message: '這張反應卡目前不能使用，請重新選擇或放棄。', snapshot: this.snapshot(room.data) } };
    }
    game.investigators = { ...game.investigators, [investigator.investigatorId]: resolved.investigator };
    if (resolved.triggeredCardInstanceId) {
      game.turn = {
        ...game.turn,
        triggeredReactions: [...game.turn.triggeredReactions, resolved.triggeredCardInstanceId],
      };
    }
    game.pendingReaction = undefined;
    const continued = this.continueEncounterResolution(room.data, [...resolved.effects]);
    room.data.lastSequenceByPlayer.set(playerId, sequence);
    room.data.version += 1;
    const result: ResultMessage = {
      id: `room:${room.data.code}:reaction:${reactionId}:${sequence}`,
      timestamp: this.now(), schemaVersion: CURRENT_MESSAGE_SCHEMA_VERSION, source: 'server', kind: 'result',
      inResponseTo: `reaction:${reactionId}`,
      outcome: 'accepted',
      effects: continued.effects,
    };
    const message: MultiplayerIntentResolvedMessage = {
      type: 'intent_resolved', actorPlayerId: playerId, sequence, result, snapshot: this.snapshot(room.data),
    };
    if (!room.data.processedByPlayer.has(playerId)) room.data.processedByPlayer.set(playerId, new Map());
    room.data.processedByPlayer.get(playerId)?.set(sequence, clone(message));
    this.broadcast(room.data, message);
    if (continued.complete) this.resumeEncounterQueues(room.data);
    return { ok: true, data: message };
  }

  /** A disconnected target picks its strongest legal reaction, then resumes the same queue. */
  resolvePendingReactionForAi(codeInput: string, investigatorId: string): RoomServiceResult<MultiplayerIntentResolvedMessage> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    const game = room.data.game;
    const pending = game?.pendingReaction;
    if (!game || !pending || pending.targetInvestigatorId !== investigatorId) {
      return { ok: false, error: { code: 'reaction_not_pending', message: '此席沒有待處置的反應窗口。', snapshot: this.snapshot(room.data) } };
    }
    if (game.controllerByInvestigator?.[investigatorId] !== 'ai') {
      return { ok: false, error: { code: 'investigator_not_controlled', message: '此席尚未由 AI 接管。', snapshot: this.snapshot(room.data) } };
    }
    const playerId = Object.entries(game.playerInvestigators).find(([, id]) => id === investigatorId)?.[0];
    const investigator = game.investigators[investigatorId];
    if (!playerId || !investigator) {
      return { ok: false, error: { code: 'reaction_not_pending', message: '待處置反應資料不完整。', snapshot: this.snapshot(room.data) } };
    }
    const best = [...pending.candidates].sort((a, b) => (b.preventAmount - b.resourceCost - b.useCost) - (a.preventAmount - a.resourceCost - a.useCost))[0];
    const decision: ReactionDecision = best
      ? { kind: 'play', cardInstanceId: best.cardInstanceId, effectIndex: best.effectIndex }
      : { kind: 'pass' };
    const resolved = resolvePendingReaction(pending, decision, investigator, game.turn.triggeredReactions);
    if (resolved.outcome === 'invalid') {
      return { ok: false, error: { code: 'reaction_decision_invalid', message: 'AI 無法使用待處置的反應卡。', snapshot: this.snapshot(room.data) } };
    }
    game.investigators = { ...game.investigators, [investigatorId]: resolved.investigator };
    if (resolved.triggeredCardInstanceId) {
      game.turn = { ...game.turn, triggeredReactions: [...game.turn.triggeredReactions, resolved.triggeredCardInstanceId] };
    }
    game.pendingReaction = undefined;
    const continued = this.continueEncounterResolution(room.data, [...resolved.effects]);
    const sequence = (room.data.lastSequenceByPlayer.get(playerId) ?? 0) + 1;
    room.data.lastSequenceByPlayer.set(playerId, sequence);
    room.data.version += 1;
    const message: MultiplayerIntentResolvedMessage = {
      type: 'intent_resolved', actorPlayerId: playerId, sequence,
      result: {
        id: `room:${room.data.code}:reaction-ai:${pending.id}:${sequence}`,
        timestamp: this.now(), schemaVersion: CURRENT_MESSAGE_SCHEMA_VERSION, source: 'server', kind: 'result',
        inResponseTo: `reaction:${pending.id}`, outcome: 'accepted', effects: continued.effects,
      },
      snapshot: this.snapshot(room.data),
    };
    this.broadcast(room.data, message);
    if (continued.complete) this.resumeEncounterQueues(room.data);
    return { ok: true, data: message };
  }

  private startEncounterResolution(
    room: RoomRecord,
    pending: PendingEncounter,
    optionIndex: number,
    investigator: InvestigatorState,
  ): { effects: ResultEffect[]; complete: boolean } {
    const game = room.game;
    const option = pending.card.options?.[optionIndex];
    if (!game || !option) return { effects: [], complete: true };
    const prepared = prepareEncounterOption(option, investigator);
    game.investigators = { ...game.investigators, [investigator.investigatorId]: prepared.investigator };
    game.pendingEncounter = undefined;
    game.pendingEncounterResolution = {
      id: `encounter-resolution:${pending.id}`,
      targetInvestigatorId: investigator.investigatorId,
      remainingEffects: prepared.pendingEffects.map((effect) => ({ ...effect })),
    };
    return this.continueEncounterResolution(room, [...prepared.effects]);
  }

  /** Runs a selected encounter one effect at a time and pauses only at a private reaction window. */
  private continueEncounterResolution(
    room: RoomRecord,
    effects: ResultEffect[],
  ): { effects: ResultEffect[]; complete: boolean } {
    const game = room.game;
    const continuation = game?.pendingEncounterResolution;
    if (!game || !continuation) return { effects, complete: true };
    let investigator = game.investigators[continuation.targetInvestigatorId];
    if (!investigator) {
      game.pendingEncounterResolution = undefined;
      return { effects, complete: true };
    }

    while (continuation.remainingEffects.length > 0) {
      const effect = continuation.remainingEffects.shift();
      if (!effect) continue;
      const operation = encounterReactionOperation(effect, investigator);
      if (operation && operation.amount > 0) {
        const pending = openReactionWindow(
          `reaction:${room.code}:${continuation.id}:${continuation.remainingEffects.length}`,
          investigator,
          game.ruleContext?.cardLookup ?? {},
          operation,
        );
        if (pending && game.controllerByInvestigator?.[investigator.investigatorId] !== 'ai') {
          game.investigators = { ...game.investigators, [investigator.investigatorId]: investigator };
          game.pendingReaction = pending;
          effects.push({ type: 'reaction_window_opened', params: { reactionId: pending.id, trigger: pending.trigger }, targetId: investigator.investigatorId });
          return { effects, complete: false };
        }
        if (pending) {
          const candidate = [...pending.candidates]
            .sort((a, b) => (b.preventAmount - b.resourceCost - b.useCost) - (a.preventAmount - a.resourceCost - a.useCost))[0];
          const decision: ReactionDecision = candidate
            ? { kind: 'play', cardInstanceId: candidate.cardInstanceId, effectIndex: candidate.effectIndex }
            : { kind: 'pass' };
          const resolved = resolvePendingReaction(pending, decision, investigator, game.turn.triggeredReactions);
          if (resolved.outcome !== 'invalid') {
            investigator = resolved.investigator;
            if (resolved.triggeredCardInstanceId) {
              game.turn = { ...game.turn, triggeredReactions: [...game.turn.triggeredReactions, resolved.triggeredCardInstanceId] };
            }
            effects.push(...resolved.effects);
          }
        } else {
          investigator = settleReactionOperation(investigator, operation, effects);
        }
      } else {
        const applied = applyEncounterEffects([effect], investigator, game.scenario, game.ruleContext?.enemyStats ?? {});
        investigator = applied.investigator;
        game.scenario = applied.scenario;
        effects.push(...applied.effects);
      }
      game.investigators = { ...game.investigators, [investigator.investigatorId]: investigator };
    }
    game.pendingEncounterResolution = undefined;
    return { effects, complete: true };
  }

  private resumeEncounterQueues(room: RoomRecord): void {
    const game = room.game;
    if (!game || game.pendingEncounter || game.pendingReaction || game.pendingEncounterResolution) return;
    if (game.pendingMythosEncounterEntries) this.continueMythosEncounters(room);
    else if (game.pendingTurnEndEncounterInvestigators) this.continueTurnEndEncounters(room);
  }

  runAiTurn(codeInput: string, investigatorId: string): RoomServiceResult<MultiplayerAiTurnMessage> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    if (!room.data.game || room.data.phase !== 'active') {
      return { ok: false, error: { code: 'game_not_active', message: '房間尚未啟動遊戲引擎。', snapshot: this.snapshot(room.data) } };
    }
    const game = room.data.game;
    if (game.controllerByInvestigator?.[investigatorId] !== 'ai') {
      return { ok: false, error: { code: 'investigator_not_controlled', message: '此調查員目前不是 AI 控制。', snapshot: this.snapshot(room.data) } };
    }
    const investigator = game.investigators[investigatorId];
    const profile = game.aiProfilesByInvestigator?.[investigatorId];
    if (!investigator || !profile) {
      return { ok: false, error: { code: 'investigator_not_controlled', message: 'AI 席位缺少調查員或人格資料。', snapshot: this.snapshot(room.data) } };
    }
    const aiState = game.aiStatesByInvestigator?.[investigatorId] ?? initInvestigatorAIState();
    const run = runInvestigatorAITurn({
      ...(game.ruleContext ?? {}),
      scenario: game.scenario,
      investigator,
      allies: game.investigators,
      turnNumber: game.turn.turnNumber,
      locationStats: game.ruleContext?.locationStats ?? {},
      enemyStats: game.ruleContext?.enemyStats ?? {},
      cardLookup: game.ruleContext?.cardLookup ?? {},
      stylePools: game.ruleContext?.stylePools ?? {},
    }, profile, aiState);
    game.investigators = {
      ...game.investigators,
      [investigatorId]: run.investigator,
      ...run.updatedAllies,
    };
    game.scenario = run.scenario;
    game.aiStatesByInvestigator = { ...(game.aiStatesByInvestigator ?? {}), [investigatorId]: run.aiState };
    game.declaredEndByInvestigator = [...new Set([...(game.declaredEndByInvestigator ?? []), investigatorId])];
    room.data.version += 1;
    this.advanceWhenEveryoneDeclared(room.data);
    const message: MultiplayerAiTurnMessage = {
      type: 'ai_turn_completed',
      investigatorId,
      lines: run.steps.filter((step: any) => step.outcome === 'accepted').map((step: any) => step.intentNarrative),
      snapshot: this.snapshot(room.data),
    };
    this.broadcast(room.data, message);
    return { ok: true, data: message };
  }

  submitIntent(
    codeInput: string,
    playerId: string,
    sequence: number,
    intent: IntentMessage,
  ): RoomServiceResult<MultiplayerIntentResolvedMessage> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    if (!room.data.members.has(playerId)) return this.notMember(room.data);
    if (!room.data.game || room.data.phase !== 'active') {
      return { ok: false, error: { code: 'game_not_active', message: '房間尚未啟動遊戲引擎。', snapshot: this.snapshot(room.data) } };
    }
    if (!Number.isInteger(sequence) || sequence < 1) {
      return { ok: false, error: { code: 'intent_out_of_order', message: '意圖序號必須從 1 開始遞增。', snapshot: this.snapshot(room.data) } };
    }
    if (intent.playerId !== playerId) {
      return { ok: false, error: { code: 'investigator_not_controlled', message: '意圖的玩家身分與登入身分不符。', snapshot: this.snapshot(room.data) } };
    }
    const expectedInvestigatorId = room.data.game.playerInvestigators[playerId];
    if (!expectedInvestigatorId || intent.investigatorId !== expectedInvestigatorId) {
      return { ok: false, error: { code: 'investigator_not_controlled', message: '此玩家不控制指定的調查員。', snapshot: this.snapshot(room.data) } };
    }
    if (room.data.game.controllerByInvestigator?.[expectedInvestigatorId] === 'ai') {
      return { ok: false, error: { code: 'investigator_not_controlled', message: '此席目前由 AI 接管，重連後會交還操作權。', snapshot: this.snapshot(room.data) } };
    }
    if (room.data.game.pendingEncounter?.targetInvestigatorId === expectedInvestigatorId) {
      return { ok: false, error: { code: 'encounter_pending', message: '眼前的遭遇尚待你選擇處置，不能執行其他行動。', snapshot: this.snapshot(room.data) } };
    }
    if (room.data.game.pendingReaction?.targetInvestigatorId === expectedInvestigatorId) {
      return { ok: false, error: { code: 'reaction_pending', message: '你尚未決定是否打出反應卡，不能執行其他行動。', snapshot: this.snapshot(room.data) } };
    }

    const lastSequence = room.data.lastSequenceByPlayer.get(playerId) ?? 0;
    const processed = room.data.processedByPlayer.get(playerId);
    const prior = processed?.get(sequence);
    if (prior) {
      return { ok: true, data: { ...clone(prior), duplicate: true } };
    }
    if (sequence !== lastSequence + 1) {
      return {
        ok: false,
        error: {
          code: 'intent_out_of_order',
          message: `意圖序號失序：預期 ${lastSequence + 1}，收到 ${sequence}。`,
          snapshot: this.snapshot(room.data),
        },
      };
    }

    const game = room.data.game;
    const actor = game.investigators[expectedInvestigatorId];
    if (!actor) {
      return { ok: false, error: { code: 'investigator_not_controlled', message: '找不到此玩家控制的調查員。', snapshot: this.snapshot(room.data) } };
    }

    const resolved = resolveIntent(intent, {
      ...(game.ruleContext ?? {}),
      scenario: game.scenario,
      investigator: actor,
      investigators: game.investigators,
      turn: game.turn,
    });
    const result: ResultMessage = {
      ...resolved.result,
      id: `room:${room.data.code}:${intent.id}`,
      timestamp: this.now(),
      schemaVersion: CURRENT_MESSAGE_SCHEMA_VERSION,
      kind: 'result',
    };

    if (result.outcome === 'accepted') {
      game.investigators = {
        ...game.investigators,
        [expectedInvestigatorId]: resolved.newState?.investigator ?? actor,
        ...(resolved.newState?.updatedAllies ?? {}),
      };
      game.scenario = resolved.newState?.scenario ?? game.scenario;
      game.turn = resolved.newState?.turn ?? game.turn;
      const movedTo = result.effects?.find((effect) => effect.type === 'move')?.params?.to;
      const headlineDrawn = result.effects?.some((effect) => effect.type === 'headline_drawn') === true;
      const encounterEffects = this.triggerEncounter(room.data, expectedInvestigatorId, headlineDrawn
        ? { path: 'chaos_headline', chaosTokenType: 'headline' }
        : {
            path: 'player_action',
            actionType: intent.actionType,
            locationId: intent.actionType === 'move' && typeof movedTo === 'string' ? movedTo : null,
          });
      if (encounterEffects.length > 0) result.effects = [...(result.effects ?? []), ...encounterEffects];
      room.data.version += 1;
    }

    room.data.lastSequenceByPlayer.set(playerId, sequence);
    if (!room.data.processedByPlayer.has(playerId)) room.data.processedByPlayer.set(playerId, new Map());
    const message: MultiplayerIntentResolvedMessage = {
      type: 'intent_resolved',
      actorPlayerId: playerId,
      sequence,
      result,
      snapshot: this.snapshot(room.data),
    };
    room.data.processedByPlayer.get(playerId)?.set(sequence, clone(message));

    // Accepted actions affect shared state, so every connected client receives both
    // the authoritative snapshot and the same effect list for local animation.
    if (result.outcome === 'accepted') this.broadcast(room.data, message);
    return { ok: true, data: message };
  }

  subscribe(codeInput: string, playerId: string, listener: RoomListener): RoomServiceResult<() => void> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    if (!room.data.members.has(playerId)) return this.notMember(room.data);
    if (!this.listeners.has(room.data.code)) this.listeners.set(room.data.code, new Map());
    const byPlayer = this.listeners.get(room.data.code)!;
    if (!byPlayer.has(playerId)) byPlayer.set(playerId, new Set());
    const set = byPlayer.get(playerId)!;
    set.add(listener);
    return {
      ok: true,
      data: () => {
        set.delete(listener);
        if (set.size === 0) byPlayer.delete(playerId);
        if (byPlayer.size === 0) this.listeners.delete(room.data.code);
      },
    };
  }

  private roomFor(codeInput: string): RoomServiceResult<RoomRecord> {
    const code = normalizeRoomCode(codeInput);
    if (!isRoomCode(code)) {
      return { ok: false, error: { code: 'invalid_room_code', message: '房間碼格式不正確。' } };
    }
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: { code: 'room_not_found', message: '找不到此房間。' } };
    return { ok: true, data: room };
  }

  private notMember(room: RoomRecord): RoomServiceResult<never> {
    return { ok: false, error: { code: 'not_room_member', message: '你不在此房間中。', snapshot: this.snapshot(room) } };
  }

  /** Continues a post-mythos encounter queue until a human choice is needed. */
  private continueTurnEndEncounters(room: RoomRecord): void {
    const game = room.game;
    if (!game || game.pendingEncounter || game.pendingReaction || game.pendingEncounterResolution) return;
    const queue = game.pendingTurnEndEncounterInvestigators ?? [];
    while (queue.length > 0) {
      const investigatorId = queue.shift();
      if (!investigatorId) continue;
      const investigator = game.investigators[investigatorId];
      if (!investigator || investigator.dead || investigator.permanentlyDead) continue;
      const effects = this.triggerEncounter(room, investigatorId, { path: 'turn_end' });
      if (effects.length > 0) {
        room.version += 1;
        this.broadcast(room, {
          type: 'encounter_triggered',
          targetInvestigatorId: investigatorId,
          effects,
          snapshot: this.snapshot(room),
        });
      }
      if (game.pendingEncounter || game.pendingReaction || game.pendingEncounterResolution) return;
    }
    game.pendingTurnEndEncounterInvestigators = undefined;
    this.finishTurnEnd(room);
  }

  /** Runs queued keeper-mythos encounters before the turn-end encounter queue. */
  private continueMythosEncounters(room: RoomRecord): void {
    const game = room.game;
    if (!game || game.pendingEncounter || game.pendingReaction || game.pendingEncounterResolution) return;
    const queue = game.pendingMythosEncounterEntries ?? [];
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) continue;
      const investigator = game.investigators[entry.targetInvestigatorId];
      if (!investigator || investigator.dead || investigator.permanentlyDead) continue;
      const effects = this.triggerEncounter(room, entry.targetInvestigatorId, entry.context);
      if (effects.length > 0) {
        room.version += 1;
        this.broadcast(room, {
          type: 'encounter_triggered',
          targetInvestigatorId: entry.targetInvestigatorId,
          effects,
          snapshot: this.snapshot(room),
        });
      }
      if (game.pendingEncounter || game.pendingReaction || game.pendingEncounterResolution) return;
    }
    game.pendingMythosEncounterEntries = undefined;
    this.beginTurnEndEncounterSequence(room);
  }

  private beginTurnEndEncounterSequence(room: RoomRecord): void {
    const game = room.game;
    const runtime = game?.roundRuntime;
    if (!game || !runtime) return;
    const turnEndTargets = Object.values(game.investigators)
      .filter((investigator) => !investigator.dead && !investigator.permanentlyDead)
      .map((investigator) => investigator.investigatorId);
    if (runtime.encounterTriggerConfig?.draw_on_turn_end === true && (runtime.encounterDeck?.length ?? runtime.encounterSource?.length ?? 0) > 0) {
      game.pendingTurnEndEncounterInvestigators = turnEndTargets;
      this.continueTurnEndEncounters(room);
      return;
    }
    this.finishTurnEnd(room);
  }

  /** Applies upkeep only after every scheduled turn-end encounter has resolved. */
  private finishTurnEnd(room: RoomRecord): void {
    const game = room.game;
    if (!game) return;
    const investigators = { ...game.investigators };
    let scenario = game.scenario;
    for (const [id, investigator] of Object.entries(investigators)) {
      const ending = runTurnEndUpkeep(investigator);
      const started = runTurnStartUpkeep(
        { ...ending.investigator, actionPoints: 3 },
        { scenario, cardLookup: game.ruleContext?.cardLookup ?? {} },
      );
      investigators[id] = started.investigator;
      scenario = started.scenario ?? scenario;
    }
    const nextTurn = game.scenario.turnNumber + 1;
    game.scenario = { ...scenario, phase: 'investigator', turnNumber: nextTurn };
    game.investigators = investigators;
    game.turn = {
      turnNumber: nextTurn,
      phase: 'investigator',
      actionPointsSpent: {},
      pendingLegendaryActions: [],
      triggeredReactions: [],
    };
    game.declaredEndByInvestigator = [];
    room.version += 1;
    this.broadcast(room, { type: 'phase_changed', phase: 'investigator', snapshot: this.snapshot(room) });
  }

  /**
   * Draws from server-owned encounter state. Human choices become a single
   * pending interaction; AI-controlled seats resolve with the existing shared
   * lowest-risk chooser without exposing a second client-side state machine.
   */
  private triggerEncounter(
    room: RoomRecord,
    targetInvestigatorId: string,
    context: EncounterTriggerContext,
  ): NonNullable<ResultMessage['effects']> {
    const game = room.game;
    const runtime = game?.roundRuntime;
    if (!game || !runtime || game.pendingEncounter || game.pendingReaction || game.pendingEncounterResolution || !runtime.encounterDeck || !runtime.encounterSource || !runtime.encounterTriggerConfig) return [];
    const draw = drawTriggeredEncounter(
      runtime.encounterDeck,
      runtime.encounterTriggerConfig,
      context,
      Math.random,
      runtime.encounterSource,
    );
    if (!draw.triggered || !draw.card) return [];
    runtime.encounterDeck = draw.remaining;
    const effects: NonNullable<ResultMessage['effects']> = [];
    if (draw.reshuffled) {
      effects.push({
        type: 'encounter_deck_reshuffled',
        params: { reason: draw.reason, path: context.path, sourceSize: draw.reshuffleSourceSize ?? runtime.encounterSource.length },
        targetId: targetInvestigatorId,
      });
    }
    effects.push({
      type: 'encounter_drawn',
      params: { name: draw.card.name_zh, reason: draw.reason, path: context.path },
      targetId: targetInvestigatorId,
    });
    const target = game.investigators[targetInvestigatorId];
    const options = draw.card.options ?? [];
    if (!target || options.length === 0) {
      effects.push({ type: 'encounter_no_options', params: { name: draw.card.name_zh }, targetId: targetInvestigatorId });
      return effects;
    }
    if (game.controllerByInvestigator?.[targetInvestigatorId] === 'ai') {
      const optionIndex = Math.max(0, Math.min(options.length - 1, chooseEncounterOption(draw.card, target)));
      const continued = this.startEncounterResolution(room, {
        id: `encounter:${room.code}:${room.version + 1}:${targetInvestigatorId}:${draw.card.id}`,
        targetInvestigatorId,
        card: draw.card,
        context,
      }, optionIndex, target);
      return [...effects, ...continued.effects.map((effect) => effect.targetId ? effect : { ...effect, targetId: targetInvestigatorId })];
    }
    game.pendingEncounter = {
      id: `encounter:${room.code}:${room.version + 1}:${targetInvestigatorId}:${draw.card.id}`,
      targetInvestigatorId,
      card: draw.card,
      context,
    };
    return effects;
  }

  private snapshot(room: RoomRecord): MultiplayerRoomSnapshot {
    return clone({
      roomCode: room.code,
      version: room.version,
      phase: room.phase,
      hostPlayerId: room.hostPlayerId,
      members: [...room.members.values()],
      nextSequenceByPlayer: Object.fromEntries(
        [...room.members.keys()].map((playerId) => [playerId, (room.lastSequenceByPlayer.get(playerId) ?? 0) + 1]),
      ),
      game: room.game
        ? {
            stageId: room.game.stageId ?? '',
            scenario: room.game.scenario,
            investigators: room.game.investigators,
            turn: room.game.turn,
            playerInvestigators: room.game.playerInvestigators,
            controllerByInvestigator: room.game.controllerByInvestigator ?? {},
            declaredEndByInvestigator: room.game.declaredEndByInvestigator ?? [],
            resolution: room.game.resolution,
            pendingEncounter: room.game.pendingEncounter
              ? { targetInvestigatorId: room.game.pendingEncounter.targetInvestigatorId }
              : undefined,
            pendingReaction: room.game.pendingReaction
              ? { targetInvestigatorId: room.game.pendingReaction.targetInvestigatorId }
              : undefined,
          }
        : undefined,
    });
  }

  private advanceWhenEveryoneDeclared(room: RoomRecord): void {
    const game = room.game;
    if (!game || game.scenario.phase !== 'investigator') return;
    const activeInvestigators = Object.values(game.investigators)
      .filter((investigator) => !investigator.dead && !investigator.permanentlyDead)
      .map((investigator) => investigator.investigatorId);
    const declared = new Set(game.declaredEndByInvestigator ?? []);
    if (activeInvestigators.length === 0 || !activeInvestigators.every((id) => declared.has(id))) return;
    game.scenario = { ...game.scenario, phase: 'mythos' };
    game.turn = { ...game.turn, phase: 'mythos' };
    room.version += 1;
    const mythosMessage: MultiplayerPhaseChangedMessage = {
      type: 'phase_changed',
      phase: 'mythos',
      snapshot: this.snapshot(room),
    };
    this.broadcast(room, mythosMessage);

    const runtime = game.roundRuntime;
    if (!runtime) return;
    const partySize = Object.keys(game.investigators).length;
    const anchor = Object.values(game.investigators).find((investigator) => !investigator.dead && !investigator.permanentlyDead);
    if (!anchor) return;
    let scenario = game.scenario;
    let investigators = { ...game.investigators };
    const situation = snapshotSituation(scenario, anchor, null, null);
    const selection = selectKeeperActivations(
      runtime.mythosCards,
      situation,
      scenario.keeperState ?? initKeeperState(runtime.keeperProfile),
      runtime.keeperProfile,
    );
    scenario = { ...scenario, keeperState: selection.state };
    const keeperEncounterEntries: QueuedEncounter[] = [];
    for (const card of selection.activations) {
      const currentAnchor = investigators[anchor.investigatorId] ?? anchor;
      const resolved = executeMythosCard(card, scenario, currentAnchor, game.ruleContext?.enemyStats ?? {}, Math.random, partySize, investigators);
      scenario = resolved.scenario;
      investigators = {
        ...investigators,
        [currentAnchor.investigatorId]: resolved.investigator,
        ...(resolved.updatedInvestigators ?? {}),
      };
      if (resolved.attachments.length > 0) {
        scenario = { ...scenario, keeperAttachments: [...(scenario.keeperAttachments ?? []), ...resolved.attachments] };
      }
      if (String(card.card_category ?? '') === 'encounter') {
        keeperEncounterEntries.push({
          targetInvestigatorId: currentAnchor.investigatorId,
          context: { path: 'keeper_mythos', mythosCardCategory: String(card.card_category ?? '') },
        });
      }
    }
    const monsters = activateMonsters(
      scenario,
      investigators,
      game.ruleContext?.enemyStats ?? {},
      runtime.attackCards,
    );
    scenario = monsters.scenario;
    investigators = monsters.investigators;
    for (const [id, investigator] of Object.entries(investigators)) {
      const fear = runFearChecks(investigator, scenario, game.ruleContext?.enemyStats ?? {});
      investigators[id] = fear.investigator;
    }
    const progressed = progressTick(
      scenario,
      game.campaignFlags ?? {},
      runtime.actCards,
      runtime.agendaCards,
      game.ruleContext?.enemyStats ?? {},
      partySize,
      investigators,
    );
    scenario = progressed.scenario;
    game.campaignFlags = progressed.flags;
    game.investigators = investigators;
    const outcome = (progressed.victory || progressed.defeat)
      ? evaluateOutcome(runtime.outcomes, progressed.flags)
      : null;
    if (outcome) {
      game.scenario = { ...scenario, phase: 'turn_end' };
      game.turn = { ...game.turn, phase: 'turn_end' };
      game.resolution = { outcomeCode: String(outcome.outcome_code), status: 'pending' };
      room.version += 1;
      this.broadcast(room, { type: 'room_snapshot', snapshot: this.snapshot(room) });
      const players = Object.entries(game.playerInvestigators).flatMap(([playerId, investigatorId]) => {
        const saveId = game.playerSaveIds?.[playerId];
        const investigator = game.investigators[investigatorId];
        return saveId && investigator ? [{ playerId, saveId, investigator }] : [];
      });
      if (!game.onScenarioResolved || players.length !== Object.keys(game.playerInvestigators).length) {
        game.resolution = { ...game.resolution, status: 'failed' };
        room.version += 1;
        this.broadcast(room, { type: 'room_snapshot', snapshot: this.snapshot(room) });
        return;
      }
      void game.onScenarioResolved({
        stageId: game.stageId ?? '', outcome,
        flags: { ...progressed.flags }, players,
      }).then(() => {
        if (room.game !== game || game.resolution?.status !== 'pending') return;
        game.resolution = { ...game.resolution, status: 'saved' };
        room.version += 1;
        this.broadcast(room, { type: 'room_snapshot', snapshot: this.snapshot(room) });
      }).catch(() => {
        if (room.game !== game || game.resolution?.status !== 'pending') return;
        game.resolution = { ...game.resolution, status: 'failed' };
        room.version += 1;
        this.broadcast(room, { type: 'room_snapshot', snapshot: this.snapshot(room) });
      });
      return;
    }
    game.scenario = scenario;
    if (keeperEncounterEntries.length > 0) {
      game.pendingMythosEncounterEntries = keeperEncounterEntries;
      this.continueMythosEncounters(room);
      return;
    }
    this.beginTurnEndEncounterSequence(room);
  }

  private broadcast(room: RoomRecord, message: MultiplayerServerMessage): void {
    const byPlayer = this.listeners.get(room.code);
    if (!byPlayer) return;
    for (const callbacks of byPlayer.values()) {
      for (const callback of callbacks) {
        try {
          callback(clone(message));
        } catch {
          // A dropped client callback must not affect the authoritative room state.
        }
      }
    }
  }

  private closeRoomRecord(room: RoomRecord): void {
    this.rooms.delete(room.code);
    const message: MultiplayerRoomClosedMessage = { type: 'room_closed', roomCode: room.code };
    this.broadcast(room, message);
    this.listeners.delete(room.code);
  }
}

/** One server process owns one in-memory room registry. */
export const multiplayerRooms = new MultiplayerRoomService();

export function roomErrorMessage(error: RoomServiceError): MultiplayerErrorMessage {
  return { type: 'error', code: error.code, message: error.message, snapshot: error.snapshot };
}
