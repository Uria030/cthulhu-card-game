/**
 * 多人房間通訊協議。
 *
 * Server 是唯一權威；client 只送意圖、接收完整快照與演出效果。
 * 此檔只放可序列化契約，伺服器的 RuleContext 與房間記憶體實作留在 server package。
 */
import type { IntentMessage, ResultEffect, ResultMessage } from './game/messages';
import type { InvestigatorState, ScenarioState, TurnState } from './game/state';
import type { ReactionCandidate, ReactionOperation, ReactionTrigger } from './game/reactions';

export type MultiplayerRoomPhase = 'lobby' | 'active' | 'closed';
export type MultiplayerSeatController = 'human' | 'ai';

export interface MultiplayerRoomMember {
  playerId: string;
  username: string;
  connected: boolean;
  joinedAt: string;
  /** Server-adjudicated 64-in-1 selection. Null until the player chooses. */
  investigatorTemplateId: string | null;
  /** The active investigator save selected by this player for server settlement. */
  saveId: string | null;
  ready: boolean;
}

export interface MultiplayerGameSnapshot {
  stageId: string;
  scenario: ScenarioState;
  investigators: Record<string, InvestigatorState>;
  turn: TurnState;
  /** Human account -> investigator. The client never supplies this mapping. */
  playerInvestigators: Record<string, string>;
  /** A disconnected human seat temporarily changes to AI control. */
  controllerByInvestigator: Record<string, MultiplayerSeatController>;
  /** Explicit end-of-action declarations for the current investigator phase. */
  declaredEndByInvestigator: string[];
  resolution?: {
    outcomeCode: string;
    status: 'pending' | 'saved' | 'failed';
  };
  /** Only the target receives card/options through MultiplayerPrivateState. */
  pendingEncounter?: {
    targetInvestigatorId: string;
  };
  /** Card candidates stay in MultiplayerPrivateState for this target only. */
  pendingReaction?: {
    targetInvestigatorId: string;
  };
}

/**
 * Only the owning player receives this card metadata through the authenticated
 * private-state endpoint. Card ids remain authoritative server inputs.
 */
export interface MultiplayerCardView {
  instanceId: string;
  nameZh: string;
  cardType: string;
  cost: number;
  commitIcons: Record<string, number>;
  canConsume: boolean;
  actionCount: number;
  usesLeft: number | null;
}

export interface MultiplayerPrivateState {
  investigatorId: string;
  hand: MultiplayerCardView[];
  assets: MultiplayerCardView[];
  pendingEncounter?: {
    id: string;
    nameZh: string;
    scenarioText: string;
    options: Array<{ index: number; label: string; text: string }>;
  } | null;
  pendingReaction?: {
    id: string;
    trigger: ReactionTrigger;
    operation: ReactionOperation;
    candidates: ReactionCandidate[];
  } | null;
}

export interface MultiplayerRoomSnapshot {
  roomCode: string;
  version: number;
  phase: MultiplayerRoomPhase;
  hostPlayerId: string;
  members: MultiplayerRoomMember[];
  /** Per-player next accepted sequence. Allows a reconnecting client to resume safely. */
  nextSequenceByPlayer?: Record<string, number>;
  game?: MultiplayerGameSnapshot;
}

export interface MultiplayerAuthenticateMessage {
  type: 'authenticate';
  token: string;
}

export interface MultiplayerIntentMessage {
  type: 'intent';
  sequence: number;
  intent: IntentMessage;
}

export interface MultiplayerDeclareEndMessage {
  type: 'declare_end';
  sequence: number;
}

export interface MultiplayerResolveEncounterMessage {
  type: 'resolve_encounter';
  sequence: number;
  encounterId: string;
  optionIndex: number;
}

export interface MultiplayerResolveReactionMessage {
  type: 'resolve_reaction';
  sequence: number;
  reactionId: string;
  decision: { kind: 'pass' } | { kind: 'play'; cardInstanceId: string; effectIndex: number };
}

export type MultiplayerClientMessage =
  | MultiplayerAuthenticateMessage
  | MultiplayerIntentMessage
  | MultiplayerDeclareEndMessage
  | MultiplayerResolveEncounterMessage
  | MultiplayerResolveReactionMessage;

export interface MultiplayerRoomSnapshotMessage {
  type: 'room_snapshot';
  snapshot: MultiplayerRoomSnapshot;
}

export interface MultiplayerIntentResolvedMessage {
  type: 'intent_resolved';
  actorPlayerId: string;
  sequence: number;
  duplicate?: boolean;
  result: ResultMessage;
  snapshot: MultiplayerRoomSnapshot;
}

export interface MultiplayerRoomClosedMessage {
  type: 'room_closed';
  roomCode: string;
}

export interface MultiplayerAiTurnMessage {
  type: 'ai_turn_completed';
  investigatorId: string;
  lines: string[];
  snapshot: MultiplayerRoomSnapshot;
}

export interface MultiplayerPhaseChangedMessage {
  type: 'phase_changed';
  phase: 'investigator' | 'mythos' | 'turn_end';
  snapshot: MultiplayerRoomSnapshot;
}

export interface MultiplayerEncounterTriggeredMessage {
  type: 'encounter_triggered';
  targetInvestigatorId: string;
  effects: ResultEffect[];
  snapshot: MultiplayerRoomSnapshot;
}

export interface MultiplayerErrorMessage {
  type: 'error';
  code: string;
  message: string;
  snapshot?: MultiplayerRoomSnapshot;
}

export type MultiplayerServerMessage =
  | MultiplayerRoomSnapshotMessage
  | MultiplayerIntentResolvedMessage
  | MultiplayerRoomClosedMessage
  | MultiplayerAiTurnMessage
  | MultiplayerPhaseChangedMessage
  | MultiplayerEncounterTriggeredMessage
  | MultiplayerErrorMessage;
