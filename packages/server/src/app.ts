import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { cardRoutes } from './routes/cards.js';
import { combatStyleRoutes } from './routes/combat-styles.js';
import { teamSpiritRoutes } from './routes/team-spirits.js';
import { talentTreeRoutes } from './routes/talent-trees.js';
import { monsterRoutes } from './routes/monsters.js';
import { locationRoutes } from './routes/locations.js';
import { keeperRoutes } from './routes/keeper.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: (origin, cb) => {
      const allowed = (process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!origin || allowed.includes(origin) || (origin && origin.includes('localhost'))) {
        cb(null, true);
      } else {
        cb(null, true); // Allow all for now during development
      }
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(cardRoutes);
  await app.register(combatStyleRoutes);
  await app.register(teamSpiritRoutes);
  await app.register(talentTreeRoutes);
  await app.register(monsterRoutes);
  await app.register(locationRoutes);
  await app.register(keeperRoutes);

  return app;
}
