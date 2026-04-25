import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'fallback-secret-change-me';

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    (request as any).user = decoded;
  } catch {
    return reply.status(401).send({ success: false, error: 'Invalid or expired token' });
  }
}

// 路由守門:只有 admin / owner 角色可通過
// 假設 JWT 內含 role 欄位;若無則視為非 admin 拒絕
export async function requireAdminRole(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    (request as any).user = decoded;
    const role = decoded?.role;
    if (role !== 'admin' && role !== 'owner') {
      return reply.status(403).send({ success: false, error: '權限不足:此操作需 admin 或 owner 角色' });
    }
  } catch {
    return reply.status(401).send({ success: false, error: 'Invalid or expired token' });
  }
}
