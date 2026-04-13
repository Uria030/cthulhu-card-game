import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'fallback-secret-change-me';
const SESSION_HOURS = parseInt(process.env.ADMIN_SESSION_HOURS || '24', 10);

export const authRoutes: FastifyPluginAsync = async (app) => {

  // POST /api/auth/login
  app.post<{ Body: { username: string; password: string } }>('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body || {};
    if (!username || !password) {
      return reply.status(400).send({ success: false, error: 'Username and password are required' });
    }

    try {
      const result = await pool.query(
        'SELECT * FROM admin_users WHERE username = $1 AND is_active = true',
        [username]
      );
      if (result.rows.length === 0) {
        return reply.status(401).send({ success: false, error: 'Invalid credentials' });
      }

      const user = result.rows[0];
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return reply.status(401).send({ success: false, error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { userId: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: `${SESSION_HOURS}h` }
      );

      await pool.query('UPDATE admin_users SET last_login_at = NOW() WHERE id = $1', [user.id]);

      return reply.send({
        success: true,
        data: {
          token,
          user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
          expiresIn: SESSION_HOURS * 3600
        }
      });
    } catch (error) {
      request.log.error(error, 'Login error');
      return reply.status(500).send({ success: false, error: 'Login failed' });
    }
  });

  // GET /api/auth/me
  app.get('/api/auth/me', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ success: false, error: 'No token provided' });
    }
    try {
      const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET) as any;
      const result = await pool.query(
        'SELECT id, username, display_name, role FROM admin_users WHERE id = $1 AND is_active = true',
        [decoded.userId]
      );
      if (result.rows.length === 0) {
        return reply.status(401).send({ success: false, error: 'User not found or inactive' });
      }
      return reply.send({ success: true, data: { user: result.rows[0] } });
    } catch {
      return reply.status(401).send({ success: false, error: 'Invalid or expired token' });
    }
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', async (_request, reply) => {
    return reply.send({ success: true, message: 'Logged out successfully' });
  });
};
