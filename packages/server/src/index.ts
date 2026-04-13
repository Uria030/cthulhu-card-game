import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { createDefaultAdmin } from './db/seed.js';

const PORT = Number(process.env.PORT) || 3001;

async function start() {
  // Run database migrations and seed
  try {
    await runMigrations();
    await createDefaultAdmin();
  } catch (error) {
    console.error('Database initialization failed:', error);
    // Don't crash — allow server to start even if DB is unavailable
    // (health endpoint can still respond)
  }

  const app = await buildApp();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server running on http://localhost:${PORT}`);
}

start();
