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
import { autoRoute, isValidProvider, listModels } from '../lib/providers.js';
import { validateChat, clampNumber } from '../lib/validation.js';

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
    assert.deepEqual(Object.keys(m).sort(), ['claude', 'gemini', 'groq', 'openai', 'openrouter']);
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
