import { buildApp } from './app.js';

const PORT = Number(process.env.PORT) || 3001;

async function start() {
  const app = await buildApp();

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server running on http://localhost:${PORT}`);
}

start();
