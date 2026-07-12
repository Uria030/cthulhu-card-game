/**
 * 多人房間通訊協議。
 *
 * Server 是唯一權威；client 只送意圖、接收完整快照與演出效果。
 * 此檔只放可序列化契約，伺服器的 RuleContext 與房間記憶體實作留在 server package。
 */
import type { IntentMessage, ResultMessage } from './game/messages';
import type { InvestigatorState, ScenarioState, TurnState } from './game/state';

export type MultiplayerRoomPhase = 'lobby' | 'active' | 'closed';

export interface MultiplayerRoomMember {
  playerId: string;
  username: string;
  connected: boolean;
  joinedAt: string;
}

export interface MultiplayerGameSnapshot {
  scenario: ScenarioState;
  investigators: Record<string, InvestigatorState>;
  turn: TurnState;
}

export interface MultiplayerRoomSnapshot {
  roomCode: string;
  version: number;
  phase: MultiplayerRoomPhase;
  hostPlayerId: string;
  members: MultiplayerRoomMember[];
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

export type MultiplayerClientMessage = MultiplayerAuthenticateMessage | MultiplayerIntentMessage;

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
  | MultiplayerErrorMessage;
