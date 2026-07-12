import type { FastifyPluginAsync } from 'fastify';
import {
  playerFromRequest,
  requirePlayerAuth,
  verifyPlayerToken,
} from '../middleware/player-auth.js';
import {
  multiplayerRooms,
  roomErrorMessage,
  type MultiplayerRoomService,
} from '../services/multiplayer-rooms.js';
import type {
  MultiplayerClientMessage,
  MultiplayerErrorMessage,
  MultiplayerServerMessage,
} from '@cthulhu/shared';

interface MultiplayerRouteOptions {
  roomService?: MultiplayerRoomService;
}

function sendSocket(socket: { readyState: number; send: (payload: string) => void }, message: MultiplayerServerMessage): void {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

function parseSocketMessage(raw: unknown): MultiplayerClientMessage | null {
  try {
    const parsed = JSON.parse(String(raw)) as MultiplayerClientMessage;
    return parsed && typeof parsed === 'object' && 'type' in parsed ? parsed : null;
  } catch {
    return null;
  }
}

function socketError(code: string, message: string): MultiplayerErrorMessage {
  return { type: 'error', code, message };
}

export const multiplayerRoutes: FastifyPluginAsync<MultiplayerRouteOptions> = async (app, options) => {
  const rooms = options.roomService ?? multiplayerRooms;

  app.post('/api/multiplayer/rooms', { preHandler: requirePlayerAuth }, async (request, reply) => {
    const player = playerFromRequest(request);
    if (!player) return reply.status(401).send({ success: false, error: 'Authentication required' });
    const created = rooms.createRoom(player);
    if (!created.ok) return reply.status(500).send({ success: false, error: created.error.message });
    return reply.status(201).send({ success: true, data: created.data });
  });

  app.get<{ Params: { code: string } }>('/api/multiplayer/rooms/:code', { preHandler: requirePlayerAuth }, async (request, reply) => {
    const player = playerFromRequest(request);
    if (!player) return reply.status(401).send({ success: false, error: 'Authentication required' });
    const room = rooms.getSnapshot(request.params.code, player.playerId);
    if (!room.ok) return reply.status(room.error.code === 'room_not_found' ? 404 : 403).send({ success: false, error: room.error.message });
    return reply.send({ success: true, data: room.data });
  });

  app.post<{ Params: { code: string } }>('/api/multiplayer/rooms/:code/join', { preHandler: requirePlayerAuth }, async (request, reply) => {
    const player = playerFromRequest(request);
    if (!player) return reply.status(401).send({ success: false, error: 'Authentication required' });
    const joined = rooms.joinRoom(request.params.code, player);
    if (!joined.ok) {
      const status = joined.error.code === 'room_not_found' ? 404 : joined.error.code === 'room_full' ? 409 : 400;
      return reply.status(status).send({ success: false, error: joined.error.message });
    }
    return reply.send({ success: true, data: joined.data });
  });

  app.post<{ Params: { code: string } }>('/api/multiplayer/rooms/:code/leave', { preHandler: requirePlayerAuth }, async (request, reply) => {
    const player = playerFromRequest(request);
    if (!player) return reply.status(401).send({ success: false, error: 'Authentication required' });
    const left = rooms.leaveRoom(request.params.code, player.playerId);
    if (!left.ok) return reply.status(left.error.code === 'room_not_found' ? 404 : 403).send({ success: false, error: left.error.message });
    return reply.send({ success: true, data: left.data });
  });

  app.delete<{ Params: { code: string } }>('/api/multiplayer/rooms/:code', { preHandler: requirePlayerAuth }, async (request, reply) => {
    const player = playerFromRequest(request);
    if (!player) return reply.status(401).send({ success: false, error: 'Authentication required' });
    const closed = rooms.closeRoom(request.params.code, player.playerId);
    if (!closed.ok) return reply.status(closed.error.code === 'room_not_found' ? 404 : 403).send({ success: false, error: closed.error.message });
    return reply.send({ success: true, data: closed.data });
  });

  app.get<{ Params: { code: string } }>('/api/multiplayer/rooms/:code/ws', { websocket: true }, (socket, request) => {
    let authenticatedPlayerId: string | null = null;
    let unsubscribe: (() => void) | null = null;

    // Fastify websocket requires this handler to be attached synchronously.
    socket.on('message', (raw: unknown) => {
      const message = parseSocketMessage(raw);
      if (!message) {
        sendSocket(socket, socketError('invalid_message', '無法解析多人連線訊息。'));
        return;
      }

      if (message.type === 'authenticate') {
        const player = verifyPlayerToken(message.token);
        if (!player) {
          sendSocket(socket, socketError('invalid_token', '登入憑證無效或已過期。'));
          socket.close(1008, 'invalid token');
          return;
        }
        const joined = rooms.getSnapshot(request.params.code, player.playerId);
        if (!joined.ok) {
          sendSocket(socket, roomErrorMessage(joined.error));
          socket.close(1008, 'not room member');
          return;
        }
        authenticatedPlayerId = player.playerId;
        const connected = rooms.setConnection(request.params.code, player.playerId, true);
        if (!connected.ok) {
          sendSocket(socket, roomErrorMessage(connected.error));
          socket.close(1008, 'not room member');
          return;
        }
        unsubscribe?.();
        const registered = rooms.subscribe(request.params.code, player.playerId, (event) => sendSocket(socket, event));
        if (!registered.ok) {
          sendSocket(socket, roomErrorMessage(registered.error));
          socket.close(1008, 'not room member');
          return;
        }
        unsubscribe = registered.data;
        sendSocket(socket, { type: 'room_snapshot', snapshot: connected.data });
        return;
      }

      if (!authenticatedPlayerId) {
        sendSocket(socket, socketError('authentication_required', '請先送出 authenticate 訊息。'));
        return;
      }
      const applied = rooms.submitIntent(request.params.code, authenticatedPlayerId, message.sequence, message.intent);
      if (!applied.ok) {
        sendSocket(socket, roomErrorMessage(applied.error));
        return;
      }
      // Accepted intents are broadcast to every subscriber. Rejected or duplicate
      // intents are only echoed to this socket because they do not change room state.
      if (applied.data.duplicate || applied.data.result.outcome === 'rejected') sendSocket(socket, applied.data);
    });

    socket.on('close', () => {
      unsubscribe?.();
      if (authenticatedPlayerId) rooms.setConnection(request.params.code, authenticatedPlayerId, false);
    });
  });
};
