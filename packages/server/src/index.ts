import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { createDefaultAdmin } from './db/seed.js';
import { setLastMigrationError, setStartupTimestamp } from './lib/startup-state.js';

const PORT = Number(process.env.PORT) || 3001;

async function start() {
  setStartupTimestamp(new Date().toISOString());
  // Run database migrations and seed
  try {
    await runMigrations();
    await createDefaultAdmin();
    setLastMigrationError(null);
  } catch (error: any) {
    console.error('Database initialization failed:', error);
    setLastMigrationError({
      message: error?.message || String(error),
      code: error?.code,
      detail: error?.detail,
      hint: error?.hint,
      where: error?.where,
      stack: (error?.stack || '').split('\n').slice(0, 5).join('\n'),
    });
    // Don't crash — allow server to start even if DB is unavailable
    // (health endpoint can still respond)
  }

  const app = await buildApp();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server running on http://localhost:${PORT}`);
}

start();
