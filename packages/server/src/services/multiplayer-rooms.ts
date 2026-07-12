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
  MultiplayerIntentResolvedMessage,
  MultiplayerRoomClosedMessage,
  MultiplayerRoomMember,
  MultiplayerRoomSnapshot,
  MultiplayerRoomSnapshotMessage,
  MultiplayerServerMessage,
  ResultMessage,
  RuleContext,
  ScenarioState,
  TurnState,
} from '@cthulhu/shared';

// @cthulhu/shared is emitted as CommonJS so the production Node server and the
// Vite client consume the same compiled engine contract.
const require = createRequire(import.meta.url);
const sharedRuntime = require('@cthulhu/shared') as typeof import('@cthulhu/shared');
const { CURRENT_MESSAGE_SCHEMA_VERSION, resolveIntent } = sharedRuntime;

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const MAX_ROOM_MEMBERS = 4;

export interface RoomPlayer {
  playerId: string;
  username: string;
}

export interface AuthoritativeGameState {
  scenario: ScenarioState;
  investigators: Record<string, InvestigatorState>;
  turn: TurnState;
  /** playerId -> controlled investigatorId. N2 will populate this after role selection. */
  playerInvestigators: Record<string, string>;
  /** Server-only rule data; it is intentionally absent from snapshots. */
  ruleContext?: Omit<RuleContext, 'scenario' | 'investigator' | 'investigators' | 'turn'>;
}

export interface RoomServiceError {
  code:
    | 'room_not_found'
    | 'room_closed'
    | 'room_full'
    | 'not_room_member'
    | 'not_room_host'
    | 'game_not_active'
    | 'investigator_not_controlled'
    | 'intent_out_of_order'
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
      connected: true,
      joinedAt: this.now(),
    };
    const room: RoomRecord = {
      code,
      hostPlayerId: host.playerId,
      phase: 'lobby',
      version: 0,
      members: new Map([[host.playerId, member]]),
      lastSequenceByPlayer: new Map(),
      processedByPlayer: new Map(),
    };
    this.rooms.set(code, room);
    return { ok: true, data: this.snapshot(room) };
  }

  joinRoom(codeInput: string, player: RoomPlayer): RoomServiceResult<MultiplayerRoomSnapshot> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    const existing = room.data.members.get(player.playerId);
    if (!existing && room.data.members.size >= MAX_ROOM_MEMBERS) {
      return { ok: false, error: { code: 'room_full', message: '房間已滿（最多 4 人）。', snapshot: this.snapshot(room.data) } };
    }
    const changed = !existing || !existing.connected || existing.username !== player.username;
    room.data.members.set(player.playerId, {
      playerId: player.playerId,
      username: player.username,
      connected: true,
      joinedAt: existing?.joinedAt ?? this.now(),
    });
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

  setConnection(codeInput: string, playerId: string, connected: boolean): RoomServiceResult<MultiplayerRoomSnapshot> {
    const room = this.roomFor(codeInput);
    if (!room.ok) return room;
    const member = room.data.members.get(playerId);
    if (!member) return this.notMember(room.data);
    if (member.connected === connected) return { ok: true, data: this.snapshot(room.data) };
    room.data.members.set(playerId, { ...member, connected });
    room.data.version += 1;
    const snapshot = this.snapshot(room.data);
    this.broadcast(room.data, { type: 'room_snapshot', snapshot });
    return { ok: true, data: snapshot };
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
      scenario: clone(game.scenario),
      investigators: clone(game.investigators),
      turn: clone(game.turn),
      playerInvestigators: { ...game.playerInvestigators },
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

  private snapshot(room: RoomRecord): MultiplayerRoomSnapshot {
    return clone({
      roomCode: room.code,
      version: room.version,
      phase: room.phase,
      hostPlayerId: room.hostPlayerId,
      members: [...room.members.values()],
      game: room.game
        ? {
            scenario: room.game.scenario,
            investigators: room.game.investigators,
            turn: room.game.turn,
          }
        : undefined,
    });
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
