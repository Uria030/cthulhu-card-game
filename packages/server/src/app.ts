import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: ['http://localhost:5173'],
  });

  await app.register(healthRoutes);

  return app;
}
