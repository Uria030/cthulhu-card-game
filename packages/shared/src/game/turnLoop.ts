/**
 * G-01 引擎核心 — 回合狀態機
 *
 * 依《遊戲本體企劃書》第三章 §3 回合四階段:
 *   階段 A:短休息決定(short_rest_decision)
 *   階段 B:調查員階段(investigator)— 玩家行動
 *   階段 C:神話階段(mythos)— 城主回合,規則書 §2.2
 *   階段 D:回合結束(turn_end)— 結算、棄牌至上限、進入下一回合
 *
 * 本檔只實作純狀態轉移邏輯,不執行業務邏輯(扣血、洗牌、城主行動由規則模組做)。
 * 階段切換時透過 messageBus 發 phase_changed notification 給容器與其他模組。
 */
import type { MessageBus } from './messageBus';

export type TurnPhase = 'short_rest_decision' | 'investigator' | 'mythos' | 'turn_end';

const PHASE_ORDER: TurnPhase[] = ['short_rest_decision', 'investigator', 'mythos', 'turn_end'];

export interface TurnLoopState {
  turnNumber: number;
  phase: TurnPhase;
}

export interface TurnLoop {
  /** 當前狀態 */
  getState(): TurnLoopState;
  /** 推進到下一階段(turn_end → 自動進入下一回合的 short_rest_decision) */
  advance(): void;
  /** 強制設定階段(罕用,主要供斷點接續從特定階段恢復) */
  setPhase(phase: TurnPhase, turnNumber?: number): void;
  /** 跳到下一回合(turn_end 後呼叫,turnNumber +1,phase 重設) */
  nextTurn(): void;
}

export interface TurnLoopOptions {
  /** 訊息匯流排;階段切換時自動發 phase_changed notification */
  bus?: MessageBus;
  /** 初始狀態 */
  initialState?: Partial<TurnLoopState>;
  /** 訊息來源標識(預設 'engine') */
  source?: string;
}

export function createTurnLoop(options: TurnLoopOptions = {}): TurnLoop {
  const source = options.source ?? 'engine';
  const state: TurnLoopState = {
    turnNumber: options.initialState?.turnNumber ?? 1,
    phase: options.initialState?.phase ?? 'short_rest_decision',
  };

  function emitPhaseChanged(prevPhase: TurnPhase, prevTurnNumber: number): void {
    if (!options.bus) return;
    options.bus.publish({
      kind: 'notification',
      source,
      notificationType: 'phase_changed',
      payload: {
        prevPhase,
        newPhase: state.phase,
        prevTurnNumber,
        newTurnNumber: state.turnNumber,
      },
    });
  }

  function emitTurnStarted(): void {
    if (!options.bus) return;
    options.bus.publish({
      kind: 'notification',
      source,
      notificationType: 'turn_started',
      payload: { turnNumber: state.turnNumber },
    });
  }

  function emitTurnEnded(turnNumber: number): void {
    if (!options.bus) return;
    options.bus.publish({
      kind: 'notification',
      source,
      notificationType: 'turn_ended',
      payload: { turnNumber },
    });
  }

  return {
    getState(): TurnLoopState {
      return { ...state };
    },

    advance(): void {
      const prevPhase = state.phase;
      const prevTurnNumber = state.turnNumber;
      const idx = PHASE_ORDER.indexOf(state.phase);
      if (idx === -1) {
        throw new Error('未知的階段: ' + state.phase);
      }
      if (idx < PHASE_ORDER.length - 1) {
        // 同回合內推進
        state.phase = PHASE_ORDER[idx + 1];
        emitPhaseChanged(prevPhase, prevTurnNumber);
      } else {
        // 從 turn_end 進入下一回合
        emitTurnEnded(prevTurnNumber);
        state.turnNumber += 1;
        state.phase = 'short_rest_decision';
        emitPhaseChanged(prevPhase, prevTurnNumber);
        emitTurnStarted();
      }
    },

    setPhase(phase: TurnPhase, turnNumber?: number): void {
      const prevPhase = state.phase;
      const prevTurnNumber = state.turnNumber;
      state.phase = phase;
      if (typeof turnNumber === 'number') state.turnNumber = turnNumber;
      emitPhaseChanged(prevPhase, prevTurnNumber);
    },

    nextTurn(): void {
      const prevPhase = state.phase;
      const prevTurnNumber = state.turnNumber;
      emitTurnEnded(prevTurnNumber);
      state.turnNumber += 1;
      state.phase = 'short_rest_decision';
      emitPhaseChanged(prevPhase, prevTurnNumber);
      emitTurnStarted();
    },
  };
}
