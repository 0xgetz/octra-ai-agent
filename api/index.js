import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();

// CORS - allow all origins for serverless deployment
const allowedOrigins = (process.env.CORS_ORIGINS || '*').split(',').map(o => o.trim());
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

// Helmet CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '1mb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
});
app.use('/api/', apiLimiter);

// Available models
const MODELS = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
  claude: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
};

async function callAI(provider, apiKey, model, messages, temperature = 0.7, maxTokens = 2048, signal = null) {
  const fetchSignal = signal || AbortSignal.timeout(120000);

  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
      signal: fetchSignal,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw Object.assign(new Error(`OpenAI API error (${response.status}): ${err.error?.message || response.statusText}`), { status: response.status });
    }
    return { provider, raw: await response.json() };
  }

  if (provider === 'claude') {
    let systemPrompt = '';
    const filteredMessages = messages.filter(m => {
      if (m.role === 'system') { systemPrompt += (systemPrompt ? '\n' : '') + m.content; return false; }
      return true;
    });
    const body = { model, messages: filteredMessages, max_tokens: maxTokens, temperature };
    if (systemPrompt) body.system = systemPrompt;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: fetchSignal,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw Object.assign(new Error(`Claude API error (${response.status}): ${err.error?.message || response.statusText}`), { status: response.status });
    }
    return { provider, raw: await response.json() };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

function normalizeResponse({ provider, raw }) {
  if (provider === 'openai') {
    const choice = raw.choices?.[0];
    return {
      message: { role: 'assistant', content: choice?.message?.content ?? '' },
      usage: { prompt_tokens: raw.usage?.prompt_tokens ?? 0, completion_tokens: raw.usage?.completion_tokens ?? 0, total_tokens: raw.usage?.total_tokens ?? 0 },
    };
  }
  if (provider === 'claude') {
    const text = Array.isArray(raw.content) ? raw.content.filter(b => b.type === 'text').map(b => b.text).join('') : (raw.content ?? '');
    return {
      message: { role: 'assistant', content: text },
      usage: { prompt_tokens: raw.usage?.input_tokens ?? 0, completion_tokens: raw.usage?.output_tokens ?? 0, total_tokens: (raw.usage?.input_tokens ?? 0) + (raw.usage?.output_tokens ?? 0) },
    };
  }
  return { message: { role: 'assistant', content: '' }, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
}

// GET /api/models
app.get('/api/models', (_req, res) => res.json({ success: true, models: MODELS }));

// GET /api/health
app.get('/api/health', (_req, res) => res.json({ status: 'ok', version: '2.1.0', timestamp: new Date().toISOString() }));

// POST /api/chat
app.post('/api/chat', async (req, res) => {
  try {
    const { provider, apiKey, model, messages, temperature, maxTokens, systemPrompt } = req.body;
    if (!provider || !apiKey || !model || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, error: 'Missing required fields: provider, apiKey, model, messages' });
    }
    const allMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;
    const result = await callAI(provider, apiKey, model, allMessages, temperature, maxTokens);
    const normalized = normalizeResponse(result);
    return res.json({ success: true, ...normalized });
  } catch (err) {
    console.error('[/api/chat]', err.message);
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/chat/stream (SSE - note: limited support on Vercel free tier)
app.post('/api/chat/stream', async (req, res) => {
  const { provider, apiKey, model, messages, temperature, maxTokens, systemPrompt } = req.body;
  if (!provider || !apiKey || !model || !Array.isArray(messages)) {
    return res.status(400).json({ success: false, error: 'Missing required fields: provider, apiKey, model, messages' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const allMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    let streamResponse;
    if (provider === 'openai') {
      streamResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: allMessages, temperature, max_tokens: maxTokens, stream: true }),
        signal: AbortSignal.timeout(120000),
      });
      if (!streamResponse.ok) {
        const err = await streamResponse.json().catch(() => ({}));
        sendEvent('error', { error: `OpenAI error (${streamResponse.status}): ${err.error?.message || streamResponse.statusText}` });
        return res.end();
      }
      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      for await (const chunk of streamResponse.body) {
        const text = Buffer.from(chunk).toString('utf8');
        const lines = text.split('\n').filter(l => l.startsWith('data: '));
        for (const line of lines) {
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const parsed = JSON.parse(raw);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) sendEvent('delta', { content: delta });
            if (parsed.usage) usage = { prompt_tokens: parsed.usage.prompt_tokens, completion_tokens: parsed.usage.completion_tokens, total_tokens: parsed.usage.total_tokens };
          } catch {}
        }
      }
      sendEvent('done', { usage });
    } else if (provider === 'claude') {
      let systemMsg = '';
      const filtered = allMessages.filter(m => {
        if (m.role === 'system') { systemMsg += m.content; return false; }
        return true;
      });
      const body = { model, messages: filtered, max_tokens: maxTokens || 2048, temperature, stream: true };
      if (systemMsg) body.system = systemMsg;

      streamResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      if (!streamResponse.ok) {
        const err = await streamResponse.json().catch(() => ({}));
        sendEvent('error', { error: `Claude error (${streamResponse.status}): ${err.error?.message || streamResponse.statusText}` });
        return res.end();
      }
      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      for await (const chunk of streamResponse.body) {
        const text = Buffer.from(chunk).toString('utf8');
        const lines = text.split('\n').filter(l => l.startsWith('data: '));
        for (const line of lines) {
          const raw = line.slice(6).trim();
          try {
            const parsed = JSON.parse(raw);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              sendEvent('delta', { content: parsed.delta.text });
            }
            if (parsed.type === 'message_delta' && parsed.usage) {
              usage.completion_tokens = parsed.usage.output_tokens || 0;
            }
            if (parsed.type === 'message_start' && parsed.message?.usage) {
              usage.prompt_tokens = parsed.message.usage.input_tokens || 0;
            }
          } catch {}
        }
      }
      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
      sendEvent('done', { usage });
    } else {
      sendEvent('error', { error: `Unsupported provider: ${provider}` });
    }
  } catch (err) {
    console.error('[/api/chat/stream]', err.message);
    sendEvent('error', { error: err.message });
  }
  res.end();
});

// Active runs for autopilot cancellation
const activeRuns = new Map();

// POST /api/autopilot
app.post('/api/autopilot', async (req, res) => {
  const { provider, apiKey, model, goal, temperature, maxTokens } = req.body;
  if (!provider || !apiKey || !model || !goal) {
    return res.status(400).json({ success: false, error: 'Missing required fields: provider, apiKey, model, goal' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const abortController = new AbortController();
  activeRuns.set(runId, abortController);

  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('run_id', { runId });

  req.on('close', () => {
    abortController.abort();
    activeRuns.delete(runId);
  });

  try {
    send('status', { message: 'Planning steps...' });
    const planResult = await callAI(provider, apiKey, model, [
      { role: 'system', content: 'You are a task-planning assistant. Break the goal into 3-7 clear, actionable numbered steps. Respond ONLY with a JSON array of step strings. No markdown, no explanation.' },
      { role: 'user', content: goal },
    ], temperature, maxTokens, abortController.signal);
    const planText = normalizeResponse(planResult).message.content.trim();

    let steps;
    try {
      const match = planText.match(/\[[\s\S]*?\]/);
      steps = JSON.parse(match ? match[0] : planText);
      if (!Array.isArray(steps)) throw new Error('not array');
    } catch {
      steps = planText.split('\n').map(l => l.replace(/^\d+[.\)\-]\s*/, '').trim()).filter(Boolean);
      if (!steps.length) steps = [planText];
    }

    send('plan', { steps });

    const results = [];
    let previousResults = '';

    for (let i = 0; i < steps.length; i++) {
      if (abortController.signal.aborted) {
        send('cancelled', { message: 'Run cancelled by user' });
        break;
      }

      const stepText = steps[i];
      send('step_start', { index: i, step: stepText, total: steps.length });

      let ctx = `Original goal: ${goal}\n\nCurrent step (${i + 1}/${steps.length}): ${stepText}`;
      if (previousResults) ctx += `\n\nPrevious results:\n${previousResults}`;

      try {
        const stepResult = await callAI(provider, apiKey, model, [
          { role: 'system', content: 'You are an AI executing a specific step of a larger plan. Complete the step thoroughly.' },
          { role: 'user', content: ctx },
        ], temperature, maxTokens, abortController.signal);
        const stepContent = normalizeResponse(stepResult).message.content;
        results.push({ step: stepText, result: stepContent, status: 'completed' });
        previousResults += `\nStep ${i + 1} (${stepText}):\n${stepContent}\n`;
        send('step_done', { index: i, step: stepText, result: stepContent, status: 'completed' });
      } catch (stepErr) {
        if (stepErr.name === 'AbortError') {
          send('cancelled', { message: 'Run cancelled by user' });
          break;
        }
        results.push({ step: stepText, result: stepErr.message, status: 'failed' });
        previousResults += `\nStep ${i + 1} (${stepText}): FAILED - ${stepErr.message}\n`;
        send('step_done', { index: i, step: stepText, result: stepErr.message, status: 'failed' });
      }
    }

    if (!abortController.signal.aborted) {
      send('complete', { goal, steps: results });
    }
  } catch (err) {
    console.error('[/api/autopilot]', err.message);
    if (err.name !== 'AbortError') {
      send('error', { error: err.message });
    }
  }

  activeRuns.delete(runId);
  res.end();
});

// POST /api/autopilot/stop
app.post('/api/autopilot/stop', (req, res) => {
  const { runId } = req.body;
  if (!runId) return res.status(400).json({ success: false, error: 'Missing runId' });
  const controller = activeRuns.get(runId);
  if (controller) {
    controller.abort();
    activeRuns.delete(runId);
    return res.json({ success: true, message: 'Run cancelled' });
  }
  return res.json({ success: false, error: 'Run not found (may already be complete)' });
});

// POST /api/analyze
const MAX_CODE_LEN = 50000;
const MAX_PROMPT_LEN = 10000;

app.post('/api/analyze', async (req, res) => {
  try {
    const { provider, apiKey, model, code, action, prompt, temperature, maxTokens } = req.body;
    if (!provider || !apiKey || !model || !action) {
      return res.status(400).json({ success: false, error: 'Missing required fields: provider, apiKey, model, action' });
    }
    if (code && code.length > MAX_CODE_LEN) {
      return res.status(400).json({ success: false, error: `Code too long (max ${MAX_CODE_LEN} chars)` });
    }
    if (prompt && prompt.length > MAX_PROMPT_LEN) {
      return res.status(400).json({ success: false, error: `Prompt too long (max ${MAX_PROMPT_LEN} chars)` });
    }

    const systemPrompts = {
      analyze: 'You are an expert code analyst. Analyze the code thoroughly. Identify bugs, performance issues, security vulnerabilities, and areas for improvement.',
      refactor: 'You are an expert software engineer. Refactor the provided code to improve readability, performance, and maintainability.',
      explain: 'You are a patient programming teacher. Explain the provided code in detail.',
      generate: "You are an expert software developer. Generate clean, well-documented, production-ready code based on the user's requirements.",
    };

    let userContent = '';
    if (code) userContent += `Code:\n\`\`\`\n${code}\n\`\`\`\n\n`;
    if (prompt) userContent += `Instructions: ${prompt}`;
    if (!userContent) userContent = 'Provide analysis based on the action type.';

    const result = await callAI(provider, apiKey, model, [
      { role: 'system', content: systemPrompts[action] || systemPrompts.analyze },
      { role: 'user', content: userContent },
    ], temperature, maxTokens);
    const normalized = normalizeResponse(result);

    return res.json({ success: true, result: normalized.message.content, usage: normalized.usage, action });
  } catch (err) {
    console.error('[/api/analyze]', err.message);
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

export default app;
