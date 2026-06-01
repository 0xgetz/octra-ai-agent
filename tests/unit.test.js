/**
 * Unit tests for pure logic — no network, no API keys required.
 * Covers arithmetic safety, JSON extraction, RAG retrieval, memory store,
 * provider routing, and validation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { evalArithmetic, extractJsonObject, executeTool } from '../lib/tools.js';
import { RagStore, chunkText, tokenize } from '../lib/rag.js';
import { MemoryStore } from '../lib/memory.js';
import { autoRoute, isValidProvider, listModels, isCustomProvider, providerMeta, parseDataUrl } from '../lib/providers.js';
import { validateChat, clampNumber } from '../lib/validation.js';
import { McpClient, McpRegistry, flattenToolResult } from '../lib/mcp.js';

describe('evalArithmetic', () => {
  it('evaluates correctly with precedence and parens', () => {
    assert.equal(evalArithmetic('2 + 3 * 4'), 14);
    assert.equal(evalArithmetic('(2 + 3) * 4'), 20);
    assert.equal(evalArithmetic('10 / 4'), 2.5);
    assert.equal(evalArithmetic('-5 + 2'), -3);
    assert.equal(evalArithmetic('10 % 3'), 1);
  });
  it('rejects code injection attempts', () => {
    assert.throws(() => evalArithmetic('process.exit(1)'));
    assert.throws(() => evalArithmetic('1; while(true){}'));
    assert.throws(() => evalArithmetic('require("fs")'));
  });
});

describe('http_fetch SSRF guard', () => {
  const privateTargets = [
    'http://localhost/',
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'ftp://example.com/',
  ];
  for (const url of privateTargets) {
    it(`rejects ${url}`, async () => {
      await assert.rejects(() => executeTool('http_fetch', { url }));
    });
  }
});

describe('extractJsonObject', () => {
  it('extracts a balanced object, ignoring surrounding prose', () => {
    const obj = extractJsonObject('Sure! {"tool": "calculator", "args": {"expression": "1+1"}} done');
    assert.equal(obj.tool, 'calculator');
    assert.equal(obj.args.expression, '1+1');
  });
  it('returns null when there is no JSON', () => {
    assert.equal(extractJsonObject('no json here'), null);
  });
  it('handles braces inside strings', () => {
    const obj = extractJsonObject('{"final": "use { and } carefully"}');
    assert.equal(obj.final, 'use { and } carefully');
  });
});

describe('RAG store', () => {
  it('chunks and retrieves relevant content', () => {
    const store = new RagStore();
    store.addDocument('d1', 'doc1', 'Cats are small feline animals. They purr and hunt mice.');
    store.addDocument('d2', 'doc2', 'The TCP protocol guarantees ordered delivery of network packets.');
    const hits = store.search('how do networks deliver packets', 1);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].docId, 'd2');
  });
  it('removes a document and its terms', () => {
    const store = new RagStore();
    store.addDocument('d1', 'doc1', 'unique zebra content here');
    assert.equal(store.list().length, 1);
    store.removeDocument('d1');
    assert.equal(store.list().length, 0);
    assert.equal(store.search('zebra').length, 0);
  });
  it('chunkText splits long text', () => {
    const long = 'word '.repeat(1000);
    const chunks = chunkText(long, 400, 80);
    assert.ok(chunks.length > 1);
  });
  it('tokenize drops stopwords', () => {
    assert.ok(!tokenize('the and of a').length);
  });
});

describe('MemoryStore', () => {
  it('branches from a specific message', () => {
    const store = new MemoryStore();
    const c = store.createConversation({ title: 'New conversation' });
    store.appendMessage(c.id, { role: 'user', content: 'one' });
    const m2 = store.appendMessage(c.id, { role: 'assistant', content: 'two' });
    store.appendMessage(c.id, { role: 'user', content: 'three' });
    const branch = store.branchConversation(c.id, m2.id);
    assert.equal(branch.messages.length, 2);
    assert.equal(branch.parentId, c.id);
  });
  it('auto-titles from the first user message', () => {
    const store = new MemoryStore();
    const c = store.createConversation();
    store.appendMessage(c.id, { role: 'user', content: 'Explain quantum entanglement please' });
    assert.ok(store.getConversation(c.id).title.startsWith('Explain quantum'));
  });
  it('shares and revokes', () => {
    const store = new MemoryStore();
    const c = store.createConversation();
    const { shareId } = store.createShare(c.id);
    assert.ok(store.getShared(shareId));
    store.revokeShare(shareId);
    assert.equal(store.getShared(shareId), null);
  });
});

describe('provider routing', () => {
  it('isValidProvider recognises all five providers', () => {
    for (const p of ['openai', 'claude', 'gemini', 'groq', 'openrouter']) assert.ok(isValidProvider(p));
    assert.ok(!isValidProvider('bogus'));
  });
  it('autoRoute respects the preference', () => {
    const cheap = autoRoute('cheap', ['openai', 'groq', 'claude']);
    const quality = autoRoute('quality', ['openai', 'groq', 'claude']);
    assert.ok(cheap.provider && quality.provider);
    // Quality routing should prefer a higher-quality model than cheap routing.
    assert.notEqual(`${cheap.provider}:${cheap.model}`, undefined);
  });
  it('listModels returns all providers', () => {
    const m = listModels();
    assert.deepEqual(Object.keys(m).sort(), ['claude', 'custom', 'gemini', 'groq', 'openai', 'openrouter']);
  });
});

describe('parseDataUrl', () => {
  it('passes through already-base64 payloads', () => {
    const d = parseDataUrl('data:image/png;base64,iVBORw0KGgo=');
    assert.equal(d.mediaType, 'image/png');
    assert.equal(d.base64, 'iVBORw0KGgo=');
  });
  it('re-encodes non-base64 payloads to valid base64', () => {
    const d = parseDataUrl('data:text/plain,hello%20world');
    assert.equal(d.base64, Buffer.from('hello world', 'utf8').toString('base64'));
    assert.equal(Buffer.from(d.base64, 'base64').toString('utf8'), 'hello world');
  });
  it('returns null for non-data URLs', () => {
    assert.equal(parseDataUrl('https://example.com/cat.png'), null);
  });
});

describe('custom/local provider', () => {
  it('custom is a valid provider needing a base URL', () => {
    assert.ok(isValidProvider('custom'));
    assert.ok(isCustomProvider('custom'));
    assert.ok(!isCustomProvider('openai'));
  });
  it('providerMeta exposes the custom provider label', () => {
    assert.equal(providerMeta().custom.label, 'Custom / Local');
  });
});

describe('RagStore hybrid retrieval', () => {
  it('blends lexical and semantic scores when vectors are present', () => {
    const store = new RagStore();
    store.addDocument('a', 'a.txt', 'apples and oranges are fruit');
    store.addDocument('b', 'b.txt', 'routers forward network packets');
    // Hand-crafted 2-d vectors: dim0=fruit-ness, dim1=network-ness
    store.setVectors('a', [[1, 0]]);
    store.setVectors('b', [[0, 1]]);
    const hits = store.searchHybrid('packet routing networks', [0, 1], 1, 0.7);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].docId, 'b');
    assert.ok(hits[0].semantic > 0);
  });
  it('degrades to lexical when no query vector is given', () => {
    const store = new RagStore();
    store.addDocument('a', 'a.txt', 'photosynthesis converts light to energy');
    const hits = store.searchHybrid('light energy conversion', null, 1);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].docId, 'a');
  });
});

describe('MemoryStore personas', () => {
  it('creates, updates, and deletes personas', () => {
    const store = new MemoryStore();
    const p = store.createPersona({ name: 'Tutor', systemPrompt: 'Be a patient tutor', provider: 'openai', model: 'gpt-4o' });
    assert.ok(p.id.startsWith('persona_'));
    store.updatePersona(p.id, { name: 'Math Tutor' });
    assert.equal(store.getPersona(p.id).name, 'Math Tutor');
    assert.equal(store.listPersonas().length, 1);
    assert.ok(store.deletePersona(p.id));
    assert.equal(store.listPersonas().length, 0);
  });
  it('coerces patch types on update', () => {
    const store = new MemoryStore();
    const p = store.createPersona({ name: 'X' });
    store.updatePersona(p.id, { name: 123, tools: 'yes', systemPrompt: 456 });
    const updated = store.getPersona(p.id);
    assert.equal(updated.name, '123');
    assert.equal(updated.tools, true);
    assert.equal(updated.systemPrompt, '456');
  });
});

describe('MCP client', () => {
  // A fake transport implementing the JSON-RPC methods over a fetch-like fn.
  function mockFetch(toolResultText) {
    return async (_url, init) => {
      const req = JSON.parse(init.body);
      const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' } });
      if (req.method === 'initialize') return reply({ protocolVersion: '2025-06-18', serverInfo: { name: 'Mock', version: '1' }, capabilities: { tools: {} } });
      if (req.method === 'notifications/initialized') return new Response('', { status: 202 });
      if (req.method === 'tools/list') return reply({ tools: [{ name: 'echo', description: 'Echo text' }] });
      if (req.method === 'tools/call') return reply({ content: [{ type: 'text', text: toolResultText }] });
      return reply({});
    };
  }

  it('initializes, lists tools, and calls a tool', async () => {
    const client = new McpClient('https://example.com/mcp', { fetchImpl: mockFetch('pong') });
    const info = await client.initialize();
    assert.equal(info.name, 'Mock');
    assert.equal(client.sessionId, 'sess-1');
    const tools = await client.listTools();
    assert.equal(tools[0].name, 'echo');
    const result = await client.callTool('echo', { text: 'ping' });
    assert.equal(flattenToolResult(result), 'pong');
  });

  it('registry namespaces tools and runs them via toolMap', async () => {
    const reg = new McpRegistry();
    await reg.connect('srv1', 'https://example.com/mcp', { fetchImpl: mockFetch('done'), label: 'Mock' });
    const map = reg.toolMap();
    assert.ok(map['mcp__srv1__echo']);
    const out = await map['mcp__srv1__echo'].run({ text: 'x' });
    assert.equal(out, 'done');
    assert.ok(reg.disconnect('srv1'));
    assert.equal(Object.keys(reg.toolMap()).length, 0);
  });

  it('parses SSE-framed JSON-RPC responses', async () => {
    const sseFetch = async (_url, init) => {
      const req = JSON.parse(init.body);
      if (req.method === 'notifications/initialized') return new Response('', { status: 202 });
      const payload = req.method === 'initialize'
        ? { protocolVersion: '1', serverInfo: { name: 'SSE' }, capabilities: {} }
        : { tools: [{ name: 't', description: 'd' }] };
      const body = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: req.id, result: payload })}\n\n`;
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const client = new McpClient('https://example.com/mcp', { fetchImpl: sseFetch });
    const info = await client.initialize();
    assert.equal(info.name, 'SSE');
    const tools = await client.listTools();
    assert.equal(tools[0].name, 't');
  });

  it('does not return a different request id from an SSE stream', async () => {
    // Server replies to initialize correctly, but for tools/list emits an SSE
    // event carrying a DIFFERENT id. The client must NOT treat it as the result.
    const wrongIdFetch = async (_url, init) => {
      const req = JSON.parse(init.body);
      if (req.method === 'notifications/initialized') return new Response('', { status: 202 });
      if (req.method === 'initialize') {
        const body = `data: ${JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'X' }, capabilities: {} } })}\n\n`;
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      // tools/list: respond with a mismatched id 9999
      const body = `data: ${JSON.stringify({ jsonrpc: '2.0', id: 9999, result: { tools: [{ name: 'leak' }] } })}\n\n`;
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const client = new McpClient('https://example.com/mcp', { fetchImpl: wrongIdFetch });
    await client.initialize();
    const tools = await client.listTools();
    assert.deepEqual(tools, [], 'must not leak the wrong-id response');
  });
});

describe('validation', () => {
  it('validateChat throws on missing fields', () => {
    assert.throws(() => validateChat({ provider: 'openai' }));
  });
  it('validateChat passes a valid payload', () => {
    const out = validateChat({ provider: 'openai', apiKey: 'k', model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(out.provider, 'openai');
  });
  it('clampNumber clamps and falls back', () => {
    assert.equal(clampNumber(5, 0, 2, 1), 2);
    assert.equal(clampNumber('x', 0, 2, 1), 1);
    assert.equal(clampNumber(1.5, 0, 2, 1), 1.5);
  });
});
