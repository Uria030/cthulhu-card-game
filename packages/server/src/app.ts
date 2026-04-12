import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  const allowedOrigins = [
    'http://localhost:5173',
    ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : []),
  ];

  await app.register(cors, {
    origin: allowedOrigins,
  });

  await app.register(healthRoutes);

  return app;
}
