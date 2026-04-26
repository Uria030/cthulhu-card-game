/**
 * G-01 引擎核心 — 訊息匯流排
 *
 * 容器與引擎之間訊息傳遞的中央交換器。M1 階段只實作本地 in-memory pub/sub,
 * M4 連線多人時會在引擎側包一層 WebSocket / SSE 但對外介面不變。
 *
 * 設計原則:
 * - 純前後端共用的 in-memory 實作,不依賴 React / Node API
 * - subscribe 回傳 unsubscribe 函式(避免 listener leak)
 * - publish 是同步觸發 listener,但 listener 內可丟 async 工作
 * - 訊息 ID 自動補(若未提供),timestamp 自動補
 */
import type { GameMessage, IntentMessage, ResultMessage, NotificationMessage } from './messages';
import { CURRENT_MESSAGE_SCHEMA_VERSION } from './messages';

export type MessageHandler<T extends GameMessage = GameMessage> = (msg: T) => void;
export type Unsubscribe = () => void;

export interface MessageBus {
  /** 發送訊息(自動補 id / timestamp / schemaVersion 若缺) */
  publish(msg: PartialMessage): void;
  /** 訂閱特定 kind 的訊息 */
  subscribe(kind: 'intent', handler: MessageHandler<IntentMessage>): Unsubscribe;
  subscribe(kind: 'result', handler: MessageHandler<ResultMessage>): Unsubscribe;
  subscribe(kind: 'notification', handler: MessageHandler<NotificationMessage>): Unsubscribe;
  /** 訂閱所有訊息(除錯用) */
  subscribeAll(handler: MessageHandler): Unsubscribe;
  /** 清除所有 listener(測試用) */
  clear(): void;
}

/** 發送時可省略自動補的欄位 */
export type PartialMessage =
  | (Omit<IntentMessage, 'id' | 'timestamp' | 'schemaVersion'> & {
      id?: string;
      timestamp?: string;
      schemaVersion?: number;
    })
  | (Omit<ResultMessage, 'id' | 'timestamp' | 'schemaVersion'> & {
      id?: string;
      timestamp?: string;
      schemaVersion?: number;
    })
  | (Omit<NotificationMessage, 'id' | 'timestamp' | 'schemaVersion'> & {
      id?: string;
      timestamp?: string;
      schemaVersion?: number;
    });

function generateId(): string {
  // 簡單 UUID v4-like(M1 階段夠用,M4 換 crypto.randomUUID)
  return 'msg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function createInMemoryMessageBus(): MessageBus {
  const listeners = {
    intent: new Set<MessageHandler<IntentMessage>>(),
    result: new Set<MessageHandler<ResultMessage>>(),
    notification: new Set<MessageHandler<NotificationMessage>>(),
    all: new Set<MessageHandler>(),
  };

  function publish(partial: PartialMessage): void {
    const msg = {
      id: partial.id ?? generateId(),
      timestamp: partial.timestamp ?? new Date().toISOString(),
      schemaVersion: partial.schemaVersion ?? CURRENT_MESSAGE_SCHEMA_VERSION,
      ...partial,
    } as GameMessage;

    // 觸發對應 kind 的 listener
    if (msg.kind === 'intent') {
      for (const h of listeners.intent) h(msg);
    } else if (msg.kind === 'result') {
      for (const h of listeners.result) h(msg);
    } else if (msg.kind === 'notification') {
      for (const h of listeners.notification) h(msg);
    }
    // 觸發 all listener
    for (const h of listeners.all) h(msg);
  }

  function subscribe(kind: 'intent', handler: MessageHandler<IntentMessage>): Unsubscribe;
  function subscribe(kind: 'result', handler: MessageHandler<ResultMessage>): Unsubscribe;
  function subscribe(kind: 'notification', handler: MessageHandler<NotificationMessage>): Unsubscribe;
  function subscribe(kind: 'intent' | 'result' | 'notification', handler: MessageHandler<any>): Unsubscribe {
    listeners[kind].add(handler);
    return () => {
      listeners[kind].delete(handler);
    };
  }

  function subscribeAll(handler: MessageHandler): Unsubscribe {
    listeners.all.add(handler);
    return () => {
      listeners.all.delete(handler);
    };
  }

  function clear(): void {
    listeners.intent.clear();
    listeners.result.clear();
    listeners.notification.clear();
    listeners.all.clear();
  }

  return { publish, subscribe, subscribeAll, clear };
}
