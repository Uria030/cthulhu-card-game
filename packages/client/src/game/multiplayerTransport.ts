import type {
  IntentMessage,
  MultiplayerClientMessage,
  MultiplayerServerMessage,
} from '@cthulhu/shared';
import { API_BASE } from '../api';

export interface MultiplayerSocketLike {
  readonly readyState: number;
  send(payload: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: any) => void): void;
}

export interface MultiplayerTransportOptions {
  roomCode: string;
  token: string;
  onMessage: (message: MultiplayerServerMessage) => void;
  onClose?: () => void;
  onError?: () => void;
  apiBase?: string;
  createSocket?: (url: string) => MultiplayerSocketLike;
}

export interface MultiplayerTransport {
  sendIntent(sequence: number, intent: IntentMessage): boolean;
  declareActionEnd(sequence: number): boolean;
  close(): void;
}

export function multiplayerSocketUrl(roomCode: string, apiBase = API_BASE): string {
  const base = new URL(apiBase);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = `/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/ws`;
  base.search = '';
  return base.toString();
}

export function openMultiplayerTransport(options: MultiplayerTransportOptions): MultiplayerTransport {
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url));
  const socket = createSocket(multiplayerSocketUrl(options.roomCode, options.apiBase));
  let authenticated = false;

  socket.addEventListener('open', () => {
    const auth: MultiplayerClientMessage = { type: 'authenticate', token: options.token };
    socket.send(JSON.stringify(auth));
    authenticated = true;
  });
  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(String(event.data)) as MultiplayerServerMessage;
      if (message && typeof message === 'object' && 'type' in message) options.onMessage(message);
    } catch {
      // Malformed remote messages are ignored; the server remains authoritative.
    }
  });
  socket.addEventListener('close', () => options.onClose?.());
  socket.addEventListener('error', () => options.onError?.());

  return {
    sendIntent(sequence: number, intent: IntentMessage): boolean {
      if (!authenticated || socket.readyState !== 1) return false;
      const message: MultiplayerClientMessage = { type: 'intent', sequence, intent };
      socket.send(JSON.stringify(message));
      return true;
    },
    declareActionEnd(sequence: number): boolean {
      if (!authenticated || socket.readyState !== 1) return false;
      const message: MultiplayerClientMessage = { type: 'declare_end', sequence };
      socket.send(JSON.stringify(message));
      return true;
    },
    close(): void {
      socket.close(1000, 'client closed');
    },
  };
}
