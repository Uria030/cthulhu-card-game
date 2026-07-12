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
  StageBootstrap,
} from '@cthulhu/shared';
import {
  buildAuthoritativeMultiplayerGame,
  requiredAiTemplateIds,
} from '../services/multiplayer-game-factory.js';
import { pool } from '../db/pool.js';
import { settleMultiplayerScenario } from '../services/scenario-settlement.js';

interface MultiplayerRouteOptions {
  roomService?: MultiplayerRoomService;
  bootstrapForTemplate?: (stageId: string, templateId: string) => Promise<StageBootstrap>;
  isPlayableTemplate?: (templateId: string) => Promise<boolean>;
  isActiveSaveForSelection?: (input: { saveId: string; playerId: string; templateId: string }) => Promise<boolean>;
  settleScenario?: typeof settleMultiplayerScenario;
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
  const bootstrapForTemplate = options.bootstrapForTemplate ?? (async (stageId: string, templateId: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/play/stages/${encodeURIComponent(stageId)}/bootstrap?investigator=${encodeURIComponent(templateId)}&crossTest=true`,
    });
    const body = response.json() as { success?: boolean; data?: StageBootstrap; error?: string };
    if (response.statusCode !== 200 || !body.success || !body.data) {
      throw new Error(body.error ?? '無法取得多人開局包。');
    }
    return body.data;
  });
  const isPlayableTemplate = options.isPlayableTemplate ?? (async (templateId: string) => {
    const response = await app.inject({ method: 'GET', url: '/api/play/investigators?includeDraft=true' });
    const body = response.json() as { success?: boolean; data?: Array<{ id?: string; is_preset?: boolean }> };
    return response.statusCode === 200 && body.success === true && (body.data ?? [])
      .some((row) => row.is_preset !== false && row.id === templateId);
  });
  const isActiveSaveForSelection = options.isActiveSaveForSelection ?? (async ({ saveId, playerId, templateId }) => {
    const result = await pool.query(
      `SELECT 1 FROM investigator_saves
        WHERE id = $1 AND player_id = $2 AND template_id = $3 AND status = 'active'`,
      [saveId, playerId, templateId],
    );
    return result.rows.length === 1;
  });
  const settleScenario = options.settleScenario ?? settleMultiplayerScenario;

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

  app.post<{
    Params: { code: string };
    Body: { investigator_template_id?: string; save_id?: string };
  }>('/api/multiplayer/rooms/:code/select-investigator', { preHandler: requirePlayerAuth }, async (request, reply) => {
    const player = playerFromRequest(request);
    if (!player) return reply.status(401).send({ success: false, error: 'Authentication required' });
    const templateId = String(request.body?.investigator_template_id ?? '').trim();
    const saveId = String(request.body?.save_id ?? '').trim();
    if (!templateId || !(await isPlayableTemplate(templateId))) {
      return reply.status(400).send({ success: false, error: '調查員不在可選 64 格名冊中。' });
    }
    if (!saveId || !(await isActiveSaveForSelection({ saveId, playerId: player.playerId, templateId }))) {
      return reply.status(400).send({ success: false, error: '請選擇屬於此調查員的 active 存檔。' });
    }
    const selected = rooms.selectInvestigator(request.params.code, player.playerId, templateId, saveId);
    if (!selected.ok) return reply.status(selected.error.code === 'investigator_taken' ? 409 : 400).send({ success: false, error: selected.error.message });
    return reply.send({ success: true, data: selected.data });
  });

  app.post<{
    Params: { code: string };
    Body: { ready?: boolean };
  }>('/api/multiplayer/rooms/:code/ready', { preHandler: requirePlayerAuth }, async (request, reply) => {
    const player = playerFromRequest(request);
    if (!player) return reply.status(401).send({ success: false, error: 'Authentication required' });
    const ready = request.body?.ready === true;
    const updated = rooms.setReady(request.params.code, player.playerId, ready);
    if (!updated.ok) return reply.status(400).send({ success: false, error: updated.error.message });
    return reply.send({ success: true, data: updated.data });
  });

  app.post<{
    Params: { code: string };
    Body: { stage_id?: string };
  }>('/api/multiplayer/rooms/:code/start', { preHandler: requirePlayerAuth }, async (request, reply) => {
    const player = playerFromRequest(request);
    if (!player) return reply.status(401).send({ success: false, error: 'Authentication required' });
    const stageId = String(request.body?.stage_id ?? '').trim();
    if (!stageId) return reply.status(400).send({ success: false, error: '請選擇要開始的關卡。' });
    const startable = rooms.canStart(request.params.code, player.playerId);
    if (!startable.ok) return reply.status(startable.error.code === 'not_room_host' ? 403 : 409).send({ success: false, error: startable.error.message });
    try {
      const selectedIds = startable.data.members.map((member) => member.investigatorTemplateId).filter((id): id is string => !!id);
      const aiIds = requiredAiTemplateIds(selectedIds, 4 - selectedIds.length);
      const bootstraps = await Promise.all([...selectedIds, ...aiIds].map(async (templateId) => ({
        templateId,
        bootstrap: await bootstrapForTemplate(stageId, templateId),
      })));
      const game = buildAuthoritativeMultiplayerGame({ stageId, members: startable.data.members, bootstraps });
      game.onScenarioResolved = async ({ stageId: resolvedStageId, flags, players }) => {
        await settleScenario({ stageId: resolvedStageId, flags, players });
      };
      const activated = rooms.activateGame(request.params.code, player.playerId, game);
      if (!activated.ok) return reply.status(400).send({ success: false, error: activated.error.message });
      // AI vacancies complete their current investigator turn through the same
      // rule-engine path before humans start issuing intents.
      for (const [investigatorId, controller] of Object.entries(game.controllerByInvestigator ?? {})) {
        if (controller === 'ai') rooms.runAiTurn(request.params.code, investigatorId);
      }
      const latest = rooms.getSnapshot(request.params.code, player.playerId);
      return reply.send({ success: true, data: latest.ok ? latest.data : activated.data });
    } catch (error) {
      request.log.error(error, 'multiplayer: server bootstrap failed');
      return reply.status(500).send({ success: false, error: error instanceof Error ? error.message : '多人開局失敗。' });
    }
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
    let connectionRegistered = false;
    let unsubscribe: (() => void) | null = null;

    // Fastify websocket requires this handler to be attached synchronously.
    socket.on('message', (raw: unknown) => {
      const message = parseSocketMessage(raw);
      if (!message) {
        sendSocket(socket, socketError('invalid_message', '無法解析多人連線訊息。'));
        return;
      }

      if (message.type === 'authenticate') {
        if (authenticatedPlayerId) {
          sendSocket(socket, socketError('already_authenticated', '此連線已完成驗證。'));
          return;
        }
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
        connectionRegistered = true;
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
      const applied = message.type === 'declare_end'
        ? rooms.declareActionEnd(request.params.code, authenticatedPlayerId, message.sequence)
        : rooms.submitIntent(request.params.code, authenticatedPlayerId, message.sequence, message.intent);
      if (!applied.ok) {
        sendSocket(socket, roomErrorMessage(applied.error));
        return;
      }
      // Accepted intents are broadcast to every subscriber. Rejected or duplicate
      // intents are only echoed to this socket because they do not change room state.
      if (applied.data.duplicate || applied.data.result.outcome === 'rejected') sendSocket(socket, applied.data);
    });

    socket.on('close', (code: number) => {
      unsubscribe?.();
      if (authenticatedPlayerId && connectionRegistered) {
        const disconnected = rooms.setConnection(request.params.code, authenticatedPlayerId, false);
        const investigatorId = disconnected.ok ? disconnected.data.game?.playerInvestigators[authenticatedPlayerId] : null;
        // Navigation between the room and board intentionally closes with 1000.
        // It must not play a human turn through AI during that hand-off. Browser
        // loss/network failure uses a different close code and is AI-taken over.
        if (code !== 1000 && investigatorId && disconnected.ok && disconnected.data.game?.controllerByInvestigator[investigatorId] === 'ai') {
          rooms.runAiTurn(request.params.code, investigatorId);
        }
      }
    });
  });
};
