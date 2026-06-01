/**
 * Octra Network AI Agent — standalone server entrypoint.
 * All route logic lives in lib/app-factory.js (shared with the serverless build).
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp, VERSION } from './lib/app-factory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Optional durable conversation storage (defaults to in-memory if unset).
const persistDir = process.env.PERSIST_DIR || null;

const { app } = createApp({
  corsOrigins,
  serveStatic: true,
  staticDir: path.join(__dirname, 'public'),
  persistDir,
});

const server = app.listen(PORT, () => {
  console.log(`Octra Network AI Agent v${VERSION} running on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Persistence: ${persistDir ? persistDir : 'in-memory (set PERSIST_DIR to persist)'}`);
});

const shutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  const forceTimer = setTimeout(() => process.exit(1), 10000);
  server.close(() => {
    clearTimeout(forceTimer);
    console.log('Server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
