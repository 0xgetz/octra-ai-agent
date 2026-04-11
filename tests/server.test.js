/**
 * Basic server integration tests for Octra Network AI Agent
 * Run with: npm test
 * Uses Node.js built-in test runner (node:test) — requires Node 18+
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:3001';
let server;

before(async () => {
  // Start server on a different port to avoid conflicts
  process.env.PORT = '3001';
  const mod = await import('../server.js');
  server = mod.default;
  // Give it a moment to start
  await new Promise(r => setTimeout(r, 500));
});

after(() => {
  if (server && server.close) server.close();
});

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
  it('returns openai and claude model lists', async () => {
    const res = await fetch(`${BASE}/api/models`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.success);
    assert.ok(Array.isArray(data.models.openai));
    assert.ok(Array.isArray(data.models.claude));
    // BUG-01 regression: ensure correct Claude model IDs
    assert.ok(data.models.claude.includes('claude-sonnet-4-5'));
    assert.ok(data.models.claude.includes('claude-opus-4-5'));
    assert.ok(data.models.claude.includes('claude-3-5-haiku-20241022'));
    assert.ok(!data.models.claude.includes('claude-sonnet-4-20250514'), 'Bad model ID should not be present');
  });
});

describe('POST /api/chat - validation', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai' }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(data.error);
  });
});

describe('POST /api/analyze - validation', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai' }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  it('returns 400 when code is too long (BUG-14)', async () => {
    const res = await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        apiKey: 'test',
        model: 'gpt-4o',
        action: 'analyze',
        code: 'x'.repeat(60000),
      }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('too long'));
  });
});

describe('POST /api/autopilot/stop', () => {
  it('returns error for missing runId', async () => {
    const res = await fetch(`${BASE}/api/autopilot/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it('returns not found for unknown runId', async () => {
    const res = await fetch(`${BASE}/api/autopilot/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'nonexistent_run' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, false);
  });
});
