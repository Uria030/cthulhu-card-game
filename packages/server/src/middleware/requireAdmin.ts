import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'fallback-secret-change-me';

type JwtPayload = { userId: string; username: string; role: string };

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET) as JwtPayload;
    (request as any).user = decoded;
    if (decoded.role !== 'admin' && decoded.role !== 'owner') {
      return reply.status(403).send({ success: false, error: 'Admin role required' });
    }
  } catch {
    return reply.status(401).send({ success: false, error: 'Invalid or expired token' });
  }
}
