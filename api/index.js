/**
 * Octra Network AI Agent — serverless entrypoint (e.g. Vercel @vercel/node).
 * Shares all route logic with the standalone server via lib/app-factory.js.
 *
 * Notes for serverless:
 *  - CORS defaults to '*' (override with CORS_ORIGINS) since the deploy domain
 *    is dynamic.
 *  - Conversation persistence uses /tmp if available but is best-effort only;
 *    serverless filesystems are ephemeral. Set PERSIST_DIR to a writable path.
 *  - Long SSE streams may be truncated by platform timeouts on free tiers.
 */
import { createApp } from '../lib/app-factory.js';

const corsOrigins = (process.env.CORS_ORIGINS || '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const { app } = createApp({
  corsOrigins,
  serveStatic: false,
  persistDir: process.env.PERSIST_DIR || null,
});

export default app;
