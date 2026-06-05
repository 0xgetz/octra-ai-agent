/**
 * In-memory response cache with LRU eviction, TTL expiry, and optional
 * semantic matching.
 *
 * Identical requests are served from an exact hash key. When a query embedding
 * is supplied, near-duplicate prompts (cosine similarity >= threshold) can also
 * be served from cache, cutting cost and latency for paraphrased questions.
 * Everything is process-local and bring-your-own-key safe — no payload leaves
 * the process and nothing is persisted.
 */
import { createHash } from 'node:crypto';

function hashKey(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

/** Cosine similarity; returns 0 for missing or mismatched-length vectors. */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class ResponseCache {
  constructor({ maxEntries = 500, ttlMs = 1000 * 60 * 30, semanticThreshold = 0.95 } = {}) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.semanticThreshold = semanticThreshold;
    this.map = new Map(); // key -> { value, expires, vec }
    this.hits = 0;
    this.misses = 0;
    this.semanticHits = 0;
  }

  _purge() {
    const now = Date.now();
    for (const [k, e] of this.map) if (e.expires <= now) this.map.delete(k);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }

  keyFor({ provider, model, messages, temperature, systemPrompt }) {
    return hashKey({
      provider,
      model,
      temperature: temperature ?? null,
      systemPrompt: systemPrompt ?? null,
      messages,
    });
  }

  /** Look up a cached response. Returns { hit, type?, value?, score? }. */
  get(params, queryVector = null) {
    this._purge();
    const now = Date.now();
    const key = this.keyFor(params);
    const exact = this.map.get(key);
    if (exact && exact.expires > now) {
      this.map.delete(key);
      this.map.set(key, exact); // refresh LRU recency
      this.hits++;
      return { hit: true, type: 'exact', value: exact.value };
    }
    if (queryVector) {
      let best = null;
      let bestScore = 0;
      for (const e of this.map.values()) {
        if (e.expires <= now || !e.vec) continue;
        const s = cosine(queryVector, e.vec);
        if (s > bestScore) { bestScore = s; best = e; }
      }
      if (best && bestScore >= this.semanticThreshold) {
        this.hits++;
        this.semanticHits++;
        return { hit: true, type: 'semantic', value: best.value, score: bestScore };
      }
    }
    this.misses++;
    return { hit: false };
  }

  set(params, value, queryVector = null) {
    const key = this.keyFor(params);
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs, vec: queryVector || null });
    this._purge();
    return key;
  }

  clear() {
    const n = this.map.size;
    this.map.clear();
    return n;
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      entries: this.map.size,
      hits: this.hits,
      misses: this.misses,
      semanticHits: this.semanticHits,
      hitRate: total ? Math.round((this.hits / total) * 1000) / 1000 : 0,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
    };
  }
}
