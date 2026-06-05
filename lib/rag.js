/**
 * Lightweight Retrieval-Augmented Generation store.
 *
 * Documents are chunked and indexed with TF-IDF + cosine similarity so retrieval
 * works fully offline (no embedding API key required). This keeps the feature
 * usable and unit-testable without burning user API credits, while still giving
 * the agent real grounding in uploaded material.
 */

const STOPWORDS = new Set(
  'a an the and or but if then else of to in on at for with by from as is are was were be been being this that these those it its he she they we you i not no do does did has have had will would can could should'.split(' '),
);

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Split text into overlapping chunks of ~maxChars. */
export function chunkText(text, maxChars = 800, overlap = 120) {
  const clean = String(text).replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  const paras = clean.split(/\n{2,}/);
  const chunks = [];
  let current = '';
  for (const para of paras) {
    if ((current + '\n\n' + para).length > maxChars && current) {
      chunks.push(current.trim());
      current = current.slice(Math.max(0, current.length - overlap)) + '\n\n' + para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  // Hard-split any oversized chunk (e.g. a single huge paragraph).
  const out = [];
  for (const c of chunks) {
    if (c.length <= maxChars * 1.5) {
      out.push(c);
    } else {
      for (let i = 0; i < c.length; i += maxChars - overlap) out.push(c.slice(i, i + maxChars));
    }
  }
  return out;
}

function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

export class RagStore {
  constructor() {
    /** @type {Map<string, {id, name, chunks: Array<{text, tf:Map}>}>} */
    this.docs = new Map();
    this.df = new Map(); // document(chunk)-frequency per term
    this.totalChunks = 0;
  }

  addDocument(id, name, text) {
    if (this.docs.has(id)) this.removeDocument(id);
    const chunkTexts = chunkText(text);
    const chunks = chunkTexts.map((ct) => {
      const tokens = tokenize(ct);
      const tf = termFreq(tokens);
      for (const term of new Set(tokens)) this.df.set(term, (this.df.get(term) || 0) + 1);
      return { text: ct, tf };
    });
    this.docs.set(id, { id, name, chunks });
    this.totalChunks += chunks.length;
    return { id, name, chunks: chunks.length };
  }

  removeDocument(id) {
    const doc = this.docs.get(id);
    if (!doc) return false;
    for (const chunk of doc.chunks) {
      for (const term of new Set(chunk.tf.keys())) {
        const v = (this.df.get(term) || 0) - 1;
        if (v <= 0) this.df.delete(term);
        else this.df.set(term, v);
      }
    }
    this.totalChunks -= doc.chunks.length;
    return this.docs.delete(id);
  }

  list() {
    return [...this.docs.values()].map((d) => ({ id: d.id, name: d.name, chunks: d.chunks.length }));
  }

  clear() {
    this.docs.clear();
    this.df.clear();
    this.totalChunks = 0;
  }

  idf(term) {
    const df = this.df.get(term) || 0;
    return Math.log((this.totalChunks + 1) / (df + 1)) + 1;
  }

  _vector(tf) {
    const vec = new Map();
    let norm = 0;
    for (const [term, freq] of tf) {
      const w = freq * this.idf(term);
      vec.set(term, w);
      norm += w * w;
    }
    return { vec, norm: Math.sqrt(norm) || 1 };
  }

  /** Attach embedding vectors to a document's chunks (aligned by index). */
  setVectors(docId, vectors) {
    const doc = this.docs.get(docId);
    if (!doc || !Array.isArray(vectors)) return false;
    for (let i = 0; i < doc.chunks.length; i++) {
      if (vectors[i]) doc.chunks[i].vec = vectors[i];
    }
    return true;
  }

  /** Texts of all chunks lacking a vector, with their {docId, chunkIndex}. */
  chunksMissingVectors() {
    const out = [];
    for (const doc of this.docs.values()) {
      doc.chunks.forEach((c, i) => { if (!c.vec) out.push({ docId: doc.id, chunkIndex: i, text: c.text }); });
    }
    return out;
  }

  /** Return top-k chunks most similar to the query (TF-IDF only). */
  search(query, k = 4) {
    if (this.totalChunks === 0) return [];
    const qtf = termFreq(tokenize(query));
    if (qtf.size === 0) return [];
    const { vec: qvec, norm: qnorm } = this._vector(qtf);
    const scored = [];
    for (const doc of this.docs.values()) {
      for (let ci = 0; ci < doc.chunks.length; ci++) {
        const chunk = doc.chunks[ci];
        const { vec: cvec, norm: cnorm } = this._vector(chunk.tf);
        let dot = 0;
        for (const [term, qw] of qvec) {
          const cw = cvec.get(term);
          if (cw) dot += qw * cw;
        }
        const score = dot / (qnorm * cnorm);
        if (score > 0) scored.push({ docId: doc.id, docName: doc.name, chunkIndex: ci, text: chunk.text, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  /**
   * Hybrid retrieval: blend normalized TF-IDF (lexical) and cosine (semantic)
   * scores. `queryVector` is the embedding of the query; if omitted or no chunks
   * have vectors, this degrades gracefully to pure TF-IDF.
   * @param {number} alpha weight on the semantic score in [0,1]
   */
  searchHybrid(query, queryVector, k = 4, alpha = 0.5) {
    if (this.totalChunks === 0) return [];
    const qtf = termFreq(tokenize(query));
    const { vec: qvec, norm: qnorm } = this._vector(qtf);
    const qvLen = queryVector ? Math.sqrt(queryVector.reduce((s, x) => s + x * x, 0)) || 1 : 0;

    const rows = [];
    for (const doc of this.docs.values()) {
      for (let ci = 0; ci < doc.chunks.length; ci++) {
        const chunk = doc.chunks[ci];
        // lexical
        const { vec: cvec, norm: cnorm } = this._vector(chunk.tf);
        let dot = 0;
        for (const [term, qw] of qvec) { const cw = cvec.get(term); if (cw) dot += qw * cw; }
        const lexical = qvec.size ? dot / (qnorm * cnorm) : 0;
        // semantic — only when the query and chunk vectors share dimensions,
        // otherwise the dot product would read past the array and produce NaN.
        let semantic = 0;
        if (queryVector && chunk.vec && chunk.vec.length === queryVector.length) {
          let d = 0;
          for (let i = 0; i < queryVector.length; i++) d += queryVector[i] * chunk.vec[i];
          const cLen = Math.sqrt(chunk.vec.reduce((s, x) => s + x * x, 0)) || 1;
          semantic = d / (qvLen * cLen);
        }
        rows.push({ docId: doc.id, docName: doc.name, chunkIndex: ci, text: chunk.text, lexical, semantic });
      }
    }
    const hasSemantic = rows.some((r) => r.semantic > 0);
    const maxLex = Math.max(1e-9, ...rows.map((r) => r.lexical));
    const maxSem = Math.max(1e-9, ...rows.map((r) => r.semantic));
    const w = hasSemantic ? alpha : 0;
    const scored = rows
      .map((r) => ({
        docId: r.docId, docName: r.docName, chunkIndex: r.chunkIndex, text: r.text,
        score: (1 - w) * (r.lexical / maxLex) + w * (r.semantic / maxSem),
        lexical: r.lexical, semantic: r.semantic,
      }))
      .filter((r) => r.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  /** Build a grounding context block + the augmented user message. */
  buildContext(query, k = 4, queryVector = null) {
    const hits = queryVector ? this.searchHybrid(query, queryVector, k) : this.search(query, k);
    if (!hits.length) return { context: '', hits: [] };
    const context = hits
      .map((h, idx) => `[Source ${idx + 1}: ${h.docName}]\n${h.text}`)
      .join('\n\n---\n\n');
    return { context, hits };
  }
}
