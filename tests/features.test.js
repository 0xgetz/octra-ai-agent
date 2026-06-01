/**
 * End-to-end feature tests that stand up a mock OpenAI-compatible upstream and
 * point octra's "custom" provider at it. Verifies custom/local provider routing,
 * baseURL threading, and vision (image) message formatting — without any real
 * API key or network egress.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApp } from '../lib/app-factory.js';

let upstream;
let upstreamReqs = [];
let app1;
let BASE;
let UPSTREAM_BASE;

before(async () => {
  // Mock OpenAI-compatible server that records the request it received.
  const mock = express();
  mock.use(express.json({ limit: '10mb' }));
  mock.post('/v1/chat/completions', (req, res) => {
    upstreamReqs.push(req.body);
    res.json({ choices: [{ message: { role: 'assistant', content: 'mock reply' } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
  });
  await new Promise((r) => { upstream = mock.listen(0, r); });
  UPSTREAM_BASE = `http://127.0.0.1:${upstream.address().port}/v1`;

  const { app } = createApp({ corsOrigins: ['*'] });
  await new Promise((r) => { app1 = app.listen(0, r); });
  BASE = `http://127.0.0.1:${app1.address().port}`;
});

after(async () => {
  await new Promise((r) => (app1 ? app1.close(r) : r()));
  await new Promise((r) => (upstream ? upstream.close(r) : r()));
});

const post = (path, body) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('custom/local provider + baseURL', () => {
  it('routes /api/chat to the user-supplied base URL', async () => {
    upstreamReqs = [];
    const res = await post('/api/chat', {
      provider: 'custom', apiKey: 'none', model: 'llama3', baseURL: UPSTREAM_BASE,
      messages: [{ role: 'user', content: 'hello' }],
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.message.content, 'mock reply');
    assert.equal(upstreamReqs.length, 1);
    assert.equal(upstreamReqs[0].model, 'llama3');
  });
});

describe('vision (image) input', () => {
  it('formats an image into OpenAI image_url parts', async () => {
    upstreamReqs = [];
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    await post('/api/chat', {
      provider: 'custom', apiKey: 'none', model: 'llava', baseURL: UPSTREAM_BASE,
      messages: [{ role: 'user', content: 'what is this?', images: [dataUrl] }],
    });
    assert.equal(upstreamReqs.length, 1);
    const content = upstreamReqs[0].messages[0].content;
    assert.ok(Array.isArray(content), 'content should be a parts array when images present');
    assert.ok(content.some((p) => p.type === 'text' && p.text === 'what is this?'));
    const imgPart = content.find((p) => p.type === 'image_url');
    assert.ok(imgPart, 'should include an image_url part');
    assert.equal(imgPart.image_url.url, dataUrl);
  });

  it('leaves plain text messages as strings (no array wrapping)', async () => {
    upstreamReqs = [];
    await post('/api/chat', {
      provider: 'custom', apiKey: 'none', model: 'llama3', baseURL: UPSTREAM_BASE,
      messages: [{ role: 'user', content: 'plain text' }],
    });
    assert.equal(typeof upstreamReqs[0].messages[0].content, 'string');
  });
});
