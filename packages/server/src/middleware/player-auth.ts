import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';

export const PLAYER_JWT_SECRET = process.env.PLAYER_JWT_SECRET || 'player-fallback-secret-change-me';

export interface PlayerTokenPayload {
  playerId: string;
  username: string;
  kind: 'player';
}

export function verifyPlayerToken(token: string): PlayerTokenPayload | null {
  try {
    const decoded = jwt.verify(token, PLAYER_JWT_SECRET) as Partial<PlayerTokenPayload>;
    if (decoded.kind !== 'player' || !decoded.playerId || !decoded.username) return null;
    return {
      playerId: String(decoded.playerId),
      username: String(decoded.username),
      kind: 'player',
    };
  } catch {
    return null;
  }
}

export function playerFromRequest(request: FastifyRequest): PlayerTokenPayload | null {
  const player = (request as any).player as PlayerTokenPayload | undefined;
  return player?.kind === 'player' && player.playerId && player.username ? player : null;
}

export async function requirePlayerAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  const player = verifyPlayerToken(authHeader.substring(7));
  if (!player) {
    return reply.status(401).send({ success: false, error: 'Invalid or expired token' });
  }
  (request as any).player = player;
}
