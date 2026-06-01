/**
 * Integration tests for the HTTP API.
 * Uses the shared app factory on an ephemeral port (0) and awaits a clean
 * close, so test runs never collide on a fixed port (no EADDRINUSE races).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../lib/app-factory.js';

let server;
let BASE;

before(async () => {
  const { app } = createApp({ corsOrigins: ['*'], serveStatic: false });
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      BASE = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
});

const post = (path, body) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('GET /api/health', () => {
  it('returns 200 and status ok', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.ok(typeof data.version === 'string');
  });
});

describe('GET /api/models', () => {
  it('returns all five providers with model lists', async () => {
    const res = await fetch(`${BASE}/api/models`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.success);
    for (const p of ['openai', 'claude', 'gemini', 'groq', 'openrouter']) {
      assert.ok(Array.isArray(data.models[p]), `${p} should have a model array`);
    }
    assert.ok(data.models.claude.includes('claude-sonnet-4-5'));
    assert.ok(data.models.claude.includes('claude-opus-4-5'));
    assert.ok(!data.models.claude.includes('claude-sonnet-4-20250514'), 'Bad model ID should not be present');
    assert.equal(data.providers.openai.label, 'OpenAI');
  });
});

describe('GET /api/tools', () => {
  it('lists the agentic tools', async () => {
    const data = await (await fetch(`${BASE}/api/tools`)).json();
    assert.ok(data.success);
    const names = data.tools.map((t) => t.name);
    assert.ok(names.includes('calculator'));
    assert.ok(names.includes('web_search'));
  });
});

describe('POST /api/route', () => {
  it('returns a model when preference is cheap', async () => {
    const data = await (await post('/api/route', { preference: 'cheap', providers: ['groq', 'openai'] })).json();
    assert.ok(data.success);
    assert.ok(data.provider && data.model);
  });
});

describe('POST /api/chat - validation', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await post('/api/chat', { provider: 'openai' });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(data.error);
  });
  it('returns 400 for an unsupported provider', async () => {
    const res = await post('/api/chat', { provider: 'nope', apiKey: 'x', model: 'y', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.status, 400);
  });
});

describe('POST /api/analyze - validation', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await post('/api/analyze', { provider: 'openai' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).success, false);
  });
  it('returns 400 when code is too long', async () => {
    const res = await post('/api/analyze', { provider: 'openai', apiKey: 'test', model: 'gpt-4o', action: 'analyze', code: 'x'.repeat(60000) });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error.includes('too long'));
  });
});

describe('POST /api/autopilot/stop', () => {
  it('returns 400 for missing runId', async () => {
    const res = await post('/api/autopilot/stop', {});
    assert.equal(res.status, 400);
  });
  it('returns success:false for an unknown runId', async () => {
    const res = await post('/api/autopilot/stop', { runId: 'nonexistent_run' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).success, false);
  });
});

describe('RAG endpoints', () => {
  it('ingests a document and retrieves it by query', async () => {
    const add = await (await post('/api/rag/documents', { name: 'facts.txt', text: 'The Octra token symbol is OCT. Validators stake OCT tokens.' })).json();
    assert.ok(add.success);
    assert.ok(add.document.chunks >= 1);
    const search = await (await post('/api/rag/search', { query: 'octra token symbol' })).json();
    assert.ok(search.success);
    assert.ok(search.hits.length >= 1);
  });
  it('rejects documents without text', async () => {
    const res = await post('/api/rag/documents', { name: 'x' });
    assert.equal(res.status, 400);
  });
});

describe('Conversation memory', () => {
  it('creates, appends, branches, and shares', async () => {
    const conv = (await (await post('/api/conversations', {})).json()).conversation;
    await post(`/api/conversations/${conv.id}/messages`, { role: 'user', content: 'Remember this' });
    const m = (await (await post(`/api/conversations/${conv.id}/messages`, { role: 'assistant', content: 'Done' })).json()).message;
    const branch = (await (await post(`/api/conversations/${conv.id}/branch`, { fromMessageId: m.id })).json()).conversation;
    assert.equal(branch.parentId, conv.id);
    assert.equal(branch.messages.length, 2);
    const share = await (await post(`/api/conversations/${conv.id}/share`, {})).json();
    assert.ok(share.shareId);
    const shared = await (await fetch(`${BASE}/api/share/${share.shareId}`)).json();
    assert.ok(shared.conversation.readOnly);
    assert.equal(shared.conversation.messages.length, 2);
  });
  it('returns 404 for a missing conversation', async () => {
    const res = await fetch(`${BASE}/api/conversations/conv_missing`);
    assert.equal(res.status, 404);
  });
});

describe('Personas', () => {
  it('creates, lists, and deletes a persona', async () => {
    const created = (await (await post('/api/personas', { name: 'Coder', systemPrompt: 'You write code', provider: 'openai', model: 'gpt-4o' })).json()).persona;
    assert.ok(created.id);
    const list = await (await fetch(`${BASE}/api/personas`)).json();
    assert.ok(list.personas.some((p) => p.id === created.id));
    const del = await fetch(`${BASE}/api/personas/${created.id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
  });
});

describe('MCP endpoints', () => {
  it('lists no servers initially and 404s on unknown disconnect', async () => {
    const list = await (await fetch(`${BASE}/api/mcp/servers`)).json();
    assert.ok(Array.isArray(list.servers));
    const del = await fetch(`${BASE}/api/mcp/servers/nope`, { method: 'DELETE' });
    assert.equal(del.status, 404);
  });
  it('rejects a connect with no url', async () => {
    const res = await post('/api/mcp/connect', {});
    assert.equal(res.status, 400);
  });
});

describe('GET /api/models includes custom provider', () => {
  it('lists custom alongside the cloud providers', async () => {
    const data = await (await fetch(`${BASE}/api/models`)).json();
    assert.ok('custom' in data.models);
    assert.equal(data.providers.custom.label, 'Custom / Local');
  });
});
