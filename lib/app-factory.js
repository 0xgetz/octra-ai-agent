/**
 * Shared Express application factory.
 *
 * Both the standalone server (server.js) and the serverless entrypoint
 * (api/index.js) build their app from here, so route logic lives in exactly one
 * place and the two deploy targets can never drift apart.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { callAI, streamAI, listModels, providerMeta, autoRoute, embed, isCustomProvider } from './providers.js';
import { validateChat, validateAutopilot, validateAnalyze, LIMITS, clampNumber } from './validation.js';
import { runAutopilot } from './agent.js';
import { runAgentLoop, toolCatalogue } from './tools.js';
import { RagStore } from './rag.js';
import { MemoryStore } from './memory.js';
import { McpRegistry } from './mcp.js';

export const VERSION = '3.1.0';

const ANALYZE_SYSTEM_PROMPTS = {
  analyze: 'You are an expert code analyst. Analyze the code thoroughly. Identify bugs, performance issues, security vulnerabilities, and areas for improvement. Provide a structured analysis with actionable recommendations.',
  refactor: 'You are an expert software engineer. Refactor the provided code to improve readability, performance, and maintainability. Follow best practices. Provide the refactored code with explanations.',
  explain: 'You are a patient programming teacher. Explain the provided code in detail. Break down what each section does, the logic flow, and any patterns used. Make your explanation accessible to all skill levels.',
  generate: "You are an expert software developer. Generate clean, well-documented, production-ready code based on the user's requirements. Include helpful comments, error handling, and follow best practices.",
};

/**
 * @param {object} cfg
 * @param {string[]} [cfg.corsOrigins] allowed origins; '*' allows all
 * @param {boolean} [cfg.serveStatic] serve ./public (true for server, false for serverless)
 * @param {string}  [cfg.staticDir]
 * @param {string|null} [cfg.persistDir] writable dir for conversation persistence
 * @param {boolean|number|string} [cfg.trustProxy] Express "trust proxy" setting for
 *   deployments behind a reverse proxy (e.g. 1 on Vercel). Defaults to false.
 */
export function createApp(cfg = {}) {
  const {
    corsOrigins = ['*'],
    serveStatic = false,
    staticDir = null,
    persistDir = null,
    trustProxy = false,
  } = cfg;

  const app = express();

  // When deployed behind a reverse proxy (Vercel, Nginx, etc.) the real client
  // IP lives in the X-Forwarded-* headers. Trust them so rate limiting and
  // req.ip key off the actual client instead of bucketing every user under the
  // proxy address (which would also trip express-rate-limit's proxy check).
  if (trustProxy !== false) {
    app.set('trust proxy', trustProxy);
  }

  // ---- Security middleware ----
  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (corsOrigins.includes('*') || corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
  }));

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  app.use(express.json({ limit: '2mb' }));

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later.' },
  });
  app.use('/api/', apiLimiter);

  // ---- Shared state ----
  const rag = new RagStore();
  const memory = new MemoryStore({ persistDir });
  memory.init();
  const mcp = new McpRegistry();
  const activeRuns = new Map();

  // Pull common provider options (baseURL for custom/local endpoints) off a body.
  const providerOpts = (body) => {
    const o = {};
    if (isCustomProvider(body.provider) && body.baseURL) o.baseURL = body.baseURL;
    return o;
  };

  // SSE helper
  const openSSE = (res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    return (event, data) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
  };

  // ===================== Meta =====================
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', version: VERSION, timestamp: new Date().toISOString() }));
  app.get('/api/models', (_req, res) => res.json({ success: true, models: listModels(), providers: providerMeta() }));
  app.get('/api/tools', (_req, res) => res.json({ success: true, tools: toolCatalogue(mcp.toolMap()) }));

  app.post('/api/route', (req, res) => {
    const { preference = 'balanced', providers } = req.body || {};
    const choice = autoRoute(preference, Array.isArray(providers) && providers.length ? providers : undefined);
    if (!choice) return res.status(400).json({ success: false, error: 'No model available for the given providers' });
    return res.json({ success: true, ...choice, preference });
  });

  // ===================== Chat =====================
  app.post('/api/chat', async (req, res) => {
    try {
      const { provider, apiKey, model, messages } = validateChat(req.body);
      const { temperature, maxTokens, systemPrompt } = req.body;
      const allMessages = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;
      const result = await callAI(provider, apiKey, model, allMessages, {
        temperature: clampNumber(temperature, 0, 2, 0.7),
        maxTokens: clampNumber(maxTokens, 1, 128000, 2048),
        ...providerOpts(req.body),
      });
      return res.json({ success: true, message: result.message, usage: result.usage });
    } catch (err) {
      console.error('[/api/chat]', err.message);
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/chat/stream', async (req, res) => {
    let send;
    try {
      const { provider, apiKey, model, messages } = validateChat(req.body);
      const { temperature, maxTokens, systemPrompt } = req.body;
      const allMessages = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;
      send = openSSE(res);
      const controller = new AbortController();
      req.on('close', () => controller.abort());
      for await (const ev of streamAI(provider, apiKey, model, allMessages, {
        temperature: clampNumber(temperature, 0, 2, 0.7),
        maxTokens: clampNumber(maxTokens, 1, 128000, 2048),
        signal: controller.signal,
        ...providerOpts(req.body),
      })) {
        if (ev.type === 'delta') send('delta', { content: ev.content });
        else if (ev.type === 'done') send('done', { usage: ev.usage });
      }
    } catch (err) {
      if (err.status === 400 && !send) {
        return res.status(400).json({ success: false, error: err.message });
      }
      if (send) send('error', { error: err.message });
      else return res.status(err.status || 500).json({ success: false, error: err.message });
    }
    return res.end();
  });

  // ===================== Analyze (Code Lab) =====================
  app.post('/api/analyze', async (req, res) => {
    try {
      const { provider, apiKey, model, action, code, prompt } = validateAnalyze(req.body);
      const { temperature, maxTokens } = req.body;
      let userContent = '';
      if (code) userContent += `Code:\n\`\`\`\n${code}\n\`\`\`\n\n`;
      if (prompt) userContent += `Instructions: ${prompt}`;
      if (!userContent) userContent = 'Provide analysis based on the action type.';
      const result = await callAI(provider, apiKey, model, [
        { role: 'system', content: ANALYZE_SYSTEM_PROMPTS[action] || ANALYZE_SYSTEM_PROMPTS.analyze },
        { role: 'user', content: userContent },
      ], { temperature: clampNumber(temperature, 0, 2, 0.7), maxTokens: clampNumber(maxTokens, 1, 128000, 2048), ...providerOpts(req.body) });
      return res.json({ success: true, result: result.message.content, usage: result.usage, action });
    } catch (err) {
      console.error('[/api/analyze]', err.message);
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });

  // ===================== Agentic single-query (tools) =====================
  app.post('/api/agent', async (req, res) => {
    const { provider, apiKey, model, query } = req.body || {};
    if (!provider || !apiKey || !model || !query) {
      return res.status(400).json({ success: false, error: 'Missing required fields: provider, apiKey, model, query' });
    }
    const send = openSSE(res);
    const controller = new AbortController();
    req.on('close', () => controller.abort());
    try {
      const result = await runAgentLoop({
        provider, apiKey, model, query,
        temperature: clampNumber(req.body.temperature, 0, 2, 0.5),
        maxTokens: clampNumber(req.body.maxTokens, 1, 128000, 2048),
        maxSteps: clampNumber(req.body.maxSteps, 1, 12, 6),
        signal: controller.signal,
        extraTools: mcp.toolMap(),
        ...providerOpts(req.body),
        onEvent: (event, data) => send(event, data),
      });
      send('done', { answer: result.answer, steps: result.steps, usage: result.usage });
    } catch (err) {
      if (err.name !== 'AbortError') send('error', { error: err.message });
    }
    return res.end();
  });

  // ===================== Autopilot (multi-agent) =====================
  app.post('/api/autopilot', async (req, res) => {
    let parsed;
    try {
      parsed = validateAutopilot(req.body);
    } catch (err) {
      return res.status(err.status || 400).json({ success: false, error: err.message });
    }
    const { provider, apiKey, model, goal } = parsed;
    const send = openSSE(res);
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const controller = new AbortController();
    activeRuns.set(runId, controller);
    send('run_id', { runId });
    req.on('close', () => { controller.abort(); activeRuns.delete(runId); });

    try {
      await runAutopilot({
        provider, apiKey, model, goal,
        options: {
          temperature: clampNumber(req.body.temperature, 0, 2, 0.7),
          maxTokens: clampNumber(req.body.maxTokens, 1, 128000, 2048),
          useTools: !!req.body.useTools,
          selfCritique: req.body.selfCritique !== false,
          maxRetries: clampNumber(req.body.maxRetries, 0, 3, 1),
          tokenBudget: clampNumber(req.body.tokenBudget, 1000, 1000000, 100000),
          extraTools: req.body.useTools ? mcp.toolMap() : {},
          ...(isCustomProvider(provider) && req.body.baseURL ? { baseURL: req.body.baseURL } : {}),
        },
        signal: controller.signal,
        emit: (event, data) => send(event, data),
      });
    } catch (err) {
      if (err.name !== 'AbortError') send('error', { error: err.message });
    }
    activeRuns.delete(runId);
    return res.end();
  });

  app.post('/api/autopilot/stop', (req, res) => {
    const { runId } = req.body || {};
    if (!runId) return res.status(400).json({ success: false, error: 'Missing runId' });
    const controller = activeRuns.get(runId);
    if (controller) {
      controller.abort();
      activeRuns.delete(runId);
      return res.json({ success: true, message: 'Run cancelled' });
    }
    return res.json({ success: false, error: 'Run not found (may already be complete)' });
  });

  // ===================== RAG =====================
  app.post('/api/rag/documents', (req, res) => {
    const { name, text } = req.body || {};
    if (!name || !text) return res.status(400).json({ success: false, error: 'Missing name or text' });
    if (text.length > LIMITS.MAX_DOC_LEN) return res.status(400).json({ success: false, error: `Document too long (max ${LIMITS.MAX_DOC_LEN} chars)` });
    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const info = rag.addDocument(docId, name, text);
    return res.json({ success: true, document: info });
  });
  app.get('/api/rag/documents', (_req, res) => res.json({ success: true, documents: rag.list() }));
  app.delete('/api/rag/documents/:id', (req, res) => {
    const ok = rag.removeDocument(req.params.id);
    return res.status(ok ? 200 : 404).json({ success: ok });
  });
  app.post('/api/rag/search', (req, res) => {
    const { query, k } = req.body || {};
    if (!query) return res.status(400).json({ success: false, error: 'Missing query' });
    return res.json({ success: true, hits: rag.search(query, clampNumber(k, 1, 10, 4)) });
  });
  // Compute embeddings for indexed chunks that don't yet have vectors.
  app.post('/api/rag/embed', async (req, res) => {
    try {
      const { provider, apiKey } = req.body || {};
      if (!provider || !apiKey) return res.status(400).json({ success: false, error: 'Missing provider or apiKey' });
      const missing = rag.chunksMissingVectors();
      if (!missing.length) return res.json({ success: true, embedded: 0, message: 'All chunks already embedded' });
      const byDoc = new Map();
      const embedBaseURL = isCustomProvider(provider) ? req.body.baseURL : undefined;
      const vectors = await embed(provider, apiKey, missing.map((m) => m.text), { baseURL: embedBaseURL, model: req.body.embedModel });
      missing.forEach((m, i) => {
        if (!byDoc.has(m.docId)) byDoc.set(m.docId, []);
        byDoc.get(m.docId)[m.chunkIndex] = vectors[i];
      });
      for (const [docId, vecs] of byDoc) rag.setVectors(docId, vecs);
      return res.json({ success: true, embedded: missing.length });
    } catch (err) {
      console.error('[/api/rag/embed]', err.message);
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/rag/chat', async (req, res) => {
    try {
      const { provider, apiKey, model, messages } = validateChat(req.body);
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      // Optional semantic retrieval: embed the query if an embedding key is given.
      let queryVector = null;
      if (req.body.embedProvider && req.body.embedApiKey && lastUser?.content) {
        try {
          const embedBaseURL = isCustomProvider(req.body.embedProvider) ? req.body.baseURL : undefined;
          const [v] = await embed(req.body.embedProvider, req.body.embedApiKey, [lastUser.content], { baseURL: embedBaseURL, model: req.body.embedModel });
          queryVector = v;
        } catch (e) {
          console.error('[/api/rag/chat] embed query failed, falling back to lexical:', e.message);
        }
      }
      const { context, hits } = rag.buildContext(lastUser?.content || '', clampNumber(req.body.k, 1, 10, 4), queryVector);
      const sys = context
        ? `Answer using the provided sources when relevant. Cite sources as [Source N]. If the sources don't cover the question, say so.\n\nSOURCES:\n${context}`
        : 'You are a helpful assistant.';
      const result = await callAI(provider, apiKey, model, [{ role: 'system', content: sys }, ...messages], {
        temperature: clampNumber(req.body.temperature, 0, 2, 0.5),
        maxTokens: clampNumber(req.body.maxTokens, 1, 128000, 2048),
        ...providerOpts(req.body),
      });
      return res.json({ success: true, message: result.message, usage: result.usage, sources: hits });
    } catch (err) {
      console.error('[/api/rag/chat]', err.message);
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });

  // ===================== Conversations / memory =====================
  app.post('/api/conversations', (req, res) => {
    const conv = memory.createConversation(req.body || {});
    return res.json({ success: true, conversation: conv });
  });
  app.get('/api/conversations', (_req, res) => res.json({ success: true, conversations: memory.listConversations() }));
  app.get('/api/conversations/:id', (req, res) => {
    const conv = memory.getConversation(req.params.id);
    if (!conv) return res.status(404).json({ success: false, error: 'Conversation not found' });
    return res.json({ success: true, conversation: conv });
  });
  app.patch('/api/conversations/:id', (req, res) => {
    try {
      const conv = memory.renameConversation(req.params.id, req.body?.title || '');
      return res.json({ success: true, conversation: conv });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });
  app.delete('/api/conversations/:id', (req, res) => {
    const ok = memory.deleteConversation(req.params.id);
    return res.status(ok ? 200 : 404).json({ success: ok });
  });
  app.post('/api/conversations/:id/messages', (req, res) => {
    try {
      const msg = memory.appendMessage(req.params.id, req.body || {});
      return res.json({ success: true, message: msg });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });
  app.post('/api/conversations/:id/branch', (req, res) => {
    try {
      const conv = memory.branchConversation(req.params.id, req.body?.fromMessageId || null);
      return res.json({ success: true, conversation: conv });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });
  app.post('/api/conversations/:id/share', (req, res) => {
    try {
      const { shareId } = memory.createShare(req.params.id);
      return res.json({ success: true, shareId });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });
  app.get('/api/share/:shareId', (req, res) => {
    const shared = memory.getShared(req.params.shareId);
    if (!shared) return res.status(404).json({ success: false, error: 'Shared conversation not found' });
    return res.json({ success: true, conversation: shared });
  });
  app.delete('/api/share/:shareId', (req, res) => {
    const ok = memory.revokeShare(req.params.shareId);
    return res.status(ok ? 200 : 404).json({ success: ok });
  });

  // ===================== MCP (Model Context Protocol) client =====================
  app.post('/api/mcp/connect', async (req, res) => {
    const { id, url, headers, label } = req.body || {};
    if (!url) return res.status(400).json({ success: false, error: 'Missing MCP server url' });
    const serverId = (id || `srv_${Date.now()}_${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9_-]/g, '');
    try {
      const info = await mcp.connect(serverId, url, { headers: headers || {}, label });
      return res.json({ success: true, server: info });
    } catch (err) {
      console.error('[/api/mcp/connect]', err.message);
      return res.status(502).json({ success: false, error: err.message });
    }
  });
  app.get('/api/mcp/servers', (_req, res) => res.json({ success: true, servers: mcp.list() }));
  app.delete('/api/mcp/servers/:id', (req, res) => {
    const ok = mcp.disconnect(req.params.id);
    return res.status(ok ? 200 : 404).json({ success: ok });
  });

  // ===================== Personas / custom assistants =====================
  app.get('/api/personas', (_req, res) => res.json({ success: true, personas: memory.listPersonas() }));
  app.post('/api/personas', (req, res) => res.json({ success: true, persona: memory.createPersona(req.body || {}) }));
  app.get('/api/personas/:id', (req, res) => {
    const p = memory.getPersona(req.params.id);
    if (!p) return res.status(404).json({ success: false, error: 'Persona not found' });
    return res.json({ success: true, persona: p });
  });
  app.patch('/api/personas/:id', (req, res) => {
    try {
      return res.json({ success: true, persona: memory.updatePersona(req.params.id, req.body || {}) });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });
  app.delete('/api/personas/:id', (req, res) => {
    const ok = memory.deletePersona(req.params.id);
    return res.status(ok ? 200 : 404).json({ success: ok });
  });

  // ---- Static assets (server only) ----
  if (serveStatic && staticDir) {
    app.use(express.static(staticDir));
  }

  return { app, activeRuns, rag, memory, mcp };
}
