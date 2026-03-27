import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
});
app.use('/api/', apiLimiter);

// In-memory sessions
const sessions = new Map();

function getOrCreateSession(sessionId) {
  if (!sessionId) sessionId = uuidv4();
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { id: sessionId, createdAt: new Date().toISOString(), history: [] });
  }
  return sessions.get(sessionId);
}

// Available models
const MODELS = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
  claude: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
};

async function callAI(provider, apiKey, model, messages, temperature = 0.7, maxTokens = 2048) {
  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`OpenAI API error (${response.status}): ${err.error?.message || response.statusText}`);
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
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Claude API error (${response.status}): ${err.error?.message || response.statusText}`);
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
app.get('/api/health', (_req, res) => res.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() }));

// POST /api/chat
app.post('/api/chat', async (req, res) => {
  try {
    const { provider, apiKey, model, messages, temperature, maxTokens } = req.body;
    if (!provider || !apiKey || !model || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, error: 'Missing required fields: provider, apiKey, model, messages' });
    }
    const result = await callAI(provider, apiKey, model, messages, temperature, maxTokens);
    const normalized = normalizeResponse(result);
    return res.json({ success: true, ...normalized });
  } catch (err) {
    console.error('[/api/chat]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/autopilot
app.post('/api/autopilot', async (req, res) => {
  try {
    const { provider, apiKey, model, goal, temperature, maxTokens } = req.body;
    if (!provider || !apiKey || !model || !goal) {
      return res.status(400).json({ success: false, error: 'Missing required fields: provider, apiKey, model, goal' });
    }

    const planResult = await callAI(provider, apiKey, model, [
      { role: 'system', content: 'You are a task-planning assistant. Break the goal into 3-7 clear, actionable numbered steps. Respond ONLY with a JSON array of step strings. No markdown, no explanation.' },
      { role: 'user', content: goal },
    ], temperature, maxTokens);
    const planText = normalizeResponse(planResult).message.content.trim();

    let steps;
    try {
      const match = planText.match(/\[[\s\S]*?\]/);
      steps = JSON.parse(match ? match[0] : planText);
      if (!Array.isArray(steps)) throw new Error('not array');
    } catch {
      steps = planText.split('\n').map(l => l.replace(/^\d+[\.\)\-]\s*/, '').trim()).filter(Boolean);
      if (!steps.length) steps = [planText];
    }

    const results = [];
    let previousResults = '';

    for (let i = 0; i < steps.length; i++) {
      const stepText = steps[i];
      let ctx = `Original goal: ${goal}\n\nCurrent step (${i + 1}/${steps.length}): ${stepText}`;
      if (previousResults) ctx += `\n\nPrevious results:\n${previousResults}`;

      try {
        const stepResult = await callAI(provider, apiKey, model, [
          { role: 'system', content: 'You are an AI executing a specific step of a larger plan. Complete the step thoroughly. Focus on the current step while keeping the overall goal in mind.' },
          { role: 'user', content: ctx },
        ], temperature, maxTokens);
        const stepContent = normalizeResponse(stepResult).message.content;
        results.push({ step: stepText, result: stepContent, status: 'completed' });
        previousResults += `\nStep ${i + 1} (${stepText}): ${stepContent.substring(0, 500)}`;
      } catch (stepErr) {
        results.push({ step: stepText, result: stepErr.message, status: 'failed' });
        previousResults += `\nStep ${i + 1} (${stepText}): FAILED - ${stepErr.message}`;
      }
    }

    return res.json({ success: true, goal, steps: results });
  } catch (err) {
    console.error('[/api/autopilot]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/analyze
app.post('/api/analyze', async (req, res) => {
  try {
    const { provider, apiKey, model, code, action, prompt, temperature, maxTokens } = req.body;
    if (!provider || !apiKey || !model || !action) {
      return res.status(400).json({ success: false, error: 'Missing required fields: provider, apiKey, model, action' });
    }

    const systemPrompts = {
      analyze: 'You are an expert code analyst. Analyze the code thoroughly. Identify bugs, performance issues, security vulnerabilities, and areas for improvement. Provide a structured analysis with actionable recommendations.',
      refactor: 'You are an expert software engineer. Refactor the provided code to improve readability, performance, and maintainability. Follow best practices. Provide the refactored code with explanations.',
      explain: 'You are a patient programming teacher. Explain the provided code in detail. Break down what each section does, the logic flow, and any patterns used. Make your explanation accessible to all skill levels.',
      generate: 'You are an expert software developer. Generate clean, well-documented, production-ready code based on the user\'s requirements. Include helpful comments, error handling, and follow best practices.',
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

    return res.json({ success: true, result: normalized.message.content, action });
  } catch (err) {
    console.error('[/api/analyze]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Graceful shutdown
const server = app.listen(PORT, () => {
  console.log(`🤖 Octra Network AI Agent v2.0.0 running on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});

const shutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => { console.log('Server closed.'); process.exit(0); });
  setTimeout(() => process.exit(1), 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
