/**
 * Unified multi-provider AI layer.
 *
 * Supports OpenAI, Anthropic Claude, Google Gemini, Groq, and OpenRouter behind
 * a single interface: callAI() for buffered responses and streamAI() for SSE.
 * Includes model catalogues, capability metadata, cost-aware auto-routing, and
 * an ordered fallback chain so a single provider outage doesn't break the agent.
 *
 * Keys are passed per-request (bring-your-own-key); nothing is stored here.
 */

const DEFAULT_TIMEOUT_MS = 120000;

/**
 * Provider catalogue. `kind` selects the wire adapter:
 *   - 'openai'  : OpenAI Chat Completions wire format (also Groq, OpenRouter)
 *   - 'claude'  : Anthropic Messages API
 *   - 'gemini'  : Google Generative Language API
 */
export const PROVIDERS = {
  openai: {
    kind: 'openai',
    label: 'OpenAI',
    base: 'https://api.openai.com/v1',
    keyPrefix: 'sk-',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4o',
  },
  claude: {
    kind: 'claude',
    label: 'Claude',
    base: 'https://api.anthropic.com/v1',
    keyPrefix: 'sk-ant-',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    defaultModel: 'claude-sonnet-4-5',
  },
  gemini: {
    kind: 'gemini',
    label: 'Gemini',
    base: 'https://generativelanguage.googleapis.com/v1beta',
    keyPrefix: '',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'],
    defaultModel: 'gemini-2.5-flash',
  },
  groq: {
    kind: 'openai',
    label: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    keyPrefix: 'gsk_',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    defaultModel: 'llama-3.3-70b-versatile',
  },
  openrouter: {
    kind: 'openai',
    label: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    keyPrefix: 'sk-or-',
    models: [
      'openai/gpt-4o',
      'anthropic/claude-sonnet-4-5',
      'google/gemini-2.5-flash',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek/deepseek-chat',
    ],
    defaultModel: 'openai/gpt-4o',
  },
  // Any OpenAI-compatible endpoint: Ollama, LM Studio, vLLM, LocalAI, etc.
  // base URL is supplied per-request via opts.baseURL; model is free-form.
  custom: {
    kind: 'openai',
    label: 'Custom / Local',
    base: 'http://localhost:11434/v1',
    keyPrefix: '',
    models: [],
    defaultModel: '',
    custom: true,
  },
};

/** True if the provider needs a user-supplied base URL (local/custom endpoints). */
export function isCustomProvider(provider) {
  return !!(PROVIDERS[provider] && PROVIDERS[provider].custom);
}

/**
 * Rough cost/speed tiers used by auto-routing. Lower `cost` = cheaper,
 * higher `speed` = faster. These are heuristics, not billing-accurate.
 */
const MODEL_TIERS = {
  // provider:model -> { cost, speed, quality } on a 1-10 scale
  'openai:gpt-4o': { cost: 5, speed: 7, quality: 9 },
  'openai:gpt-4o-mini': { cost: 1, speed: 9, quality: 7 },
  'openai:gpt-3.5-turbo': { cost: 1, speed: 9, quality: 6 },
  'claude:claude-opus-4-5': { cost: 8, speed: 5, quality: 10 },
  'claude:claude-sonnet-4-5': { cost: 4, speed: 7, quality: 9 },
  'claude:claude-3-5-haiku-20241022': { cost: 1, speed: 9, quality: 7 },
  'gemini:gemini-2.5-flash': { cost: 1, speed: 9, quality: 8 },
  'gemini:gemini-2.5-pro': { cost: 5, speed: 6, quality: 9 },
  'groq:llama-3.3-70b-versatile': { cost: 1, speed: 10, quality: 8 },
  'groq:llama-3.1-8b-instant': { cost: 1, speed: 10, quality: 6 },
};

export function listModels() {
  const out = {};
  for (const [id, p] of Object.entries(PROVIDERS)) out[id] = p.models;
  return out;
}

export function providerMeta() {
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([id, p]) => [
      id,
      { label: p.label, models: p.models, defaultModel: p.defaultModel, keyPrefix: p.keyPrefix },
    ]),
  );
}

export function isValidProvider(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, provider);
}

/**
 * Pick the best model for a goal given a routing preference.
 * @param {'cheap'|'fast'|'quality'|'balanced'} preference
 * @param {string[]} availableProviders providers the user has keys for
 * @returns {{provider:string, model:string}|null}
 */
export function autoRoute(preference = 'balanced', availableProviders = Object.keys(PROVIDERS)) {
  const candidates = [];
  for (const [key, tier] of Object.entries(MODEL_TIERS)) {
    const [provider, model] = key.split(':');
    if (!availableProviders.includes(provider)) continue;
    let score;
    switch (preference) {
      case 'cheap': score = -tier.cost * 3 + tier.quality; break;
      case 'fast': score = tier.speed * 3 + tier.quality; break;
      case 'quality': score = tier.quality * 3 - tier.cost; break;
      default: score = tier.quality * 2 + tier.speed - tier.cost; break;
    }
    candidates.push({ provider, model, score });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return { provider: candidates[0].provider, model: candidates[0].model };
}

function apiError(provider, status, message) {
  return Object.assign(new Error(`${PROVIDERS[provider]?.label || provider} API error (${status}): ${message}`), {
    status,
    provider,
  });
}

// ---- Wire adapters: build request + parse response per provider kind -------

function splitSystem(messages) {
  let system = '';
  const rest = [];
  for (const m of messages) {
    if (m.role === 'system') system += (system ? '\n' : '') + m.content;
    else rest.push(m);
  }
  return { system, rest };
}

/** Parse a data URL into { mediaType, base64 }, or null if not a data URL. */
export function parseDataUrl(url) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url || '');
  if (!m) return null;
  // If the payload isn't already base64, decode the percent-encoding and
  // re-encode as real base64 (APIs expect valid base64, not URL-encoded text).
  const base64 = m[2] ? m[3] : Buffer.from(decodeURIComponent(m[3]), 'utf8').toString('base64');
  return { mediaType: m[1] || 'image/png', base64 };
}

// Build provider-specific message "content" supporting optional images.
// A message may carry `images: [dataUrlOrHttpUrl, ...]` alongside string content.
function openaiContent(msg) {
  if (!msg.images || !msg.images.length) return msg.content;
  const parts = [];
  if (msg.content) parts.push({ type: 'text', text: msg.content });
  for (const img of msg.images) parts.push({ type: 'image_url', image_url: { url: img } });
  return parts;
}
function claudeContent(msg) {
  if (!msg.images || !msg.images.length) return msg.content;
  const parts = [];
  if (msg.content) parts.push({ type: 'text', text: msg.content });
  for (const img of msg.images) {
    const d = parseDataUrl(img);
    if (d) parts.push({ type: 'image', source: { type: 'base64', media_type: d.mediaType, data: d.base64 } });
    else parts.push({ type: 'image', source: { type: 'url', url: img } });
  }
  return parts;
}
function geminiParts(msg) {
  const parts = [];
  if (msg.content) parts.push({ text: msg.content });
  for (const img of msg.images || []) {
    const d = parseDataUrl(img);
    if (d) parts.push({ inline_data: { mime_type: d.mediaType, data: d.base64 } });
  }
  return parts.length ? parts : [{ text: msg.content || '' }];
}

function buildRequest(provider, apiKey, model, messages, { temperature, maxTokens, stream, tools, baseURL }) {
  const p = PROVIDERS[provider];
  const base = (p.custom && baseURL) ? baseURL.replace(/\/+$/, '') : p.base;
  if (p.kind === 'openai') {
    const formatted = messages.map((m) => ({ role: m.role, content: openaiContent(m) }));
    const body = { model, messages: formatted, temperature, max_tokens: maxTokens, stream: !!stream };
    // OpenAI-compatible APIs only include token usage in the final stream chunk
    // when explicitly asked to. Without this, streamed responses report 0 tokens.
    // Skipped for custom/local servers that may not recognise the option.
    if (stream && !p.custom) body.stream_options = { include_usage: true };
    if (tools && tools.length) body.tools = tools;
    return {
      url: `${base}/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey || 'none'}` },
      body,
    };
  }
  if (p.kind === 'claude') {
    const { system, rest } = splitSystem(messages);
    const formatted = rest.map((m) => ({ role: m.role, content: claudeContent(m) }));
    const body = { model, messages: formatted, max_tokens: maxTokens || 2048, temperature, stream: !!stream };
    if (system) body.system = system;
    if (tools && tools.length) body.tools = tools;
    return {
      url: `${base}/messages`,
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body,
    };
  }
  if (p.kind === 'gemini') {
    const { system, rest } = splitSystem(messages);
    const contents = rest.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: geminiParts(m) }));
    const body = { contents, generationConfig: { temperature, maxOutputTokens: maxTokens || 2048 } };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const verb = stream ? 'streamGenerateContent' : 'generateContent';
    const sep = stream ? '?alt=sse&key=' : '?key=';
    return {
      url: `${base}/models/${model}:${verb}${sep}${encodeURIComponent(apiKey)}`,
      headers: { 'Content-Type': 'application/json' },
      body,
    };
  }
  throw new Error(`Unsupported provider kind: ${p.kind}`);
}

function parseBuffered(provider, raw) {
  const p = PROVIDERS[provider];
  if (p.kind === 'openai') {
    const choice = raw.choices?.[0];
    return {
      content: choice?.message?.content ?? '',
      usage: {
        prompt_tokens: raw.usage?.prompt_tokens ?? 0,
        completion_tokens: raw.usage?.completion_tokens ?? 0,
        total_tokens: raw.usage?.total_tokens ?? 0,
      },
    };
  }
  if (p.kind === 'claude') {
    const text = Array.isArray(raw.content)
      ? raw.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
      : (raw.content ?? '');
    const inp = raw.usage?.input_tokens ?? 0;
    const out = raw.usage?.output_tokens ?? 0;
    return { content: text, usage: { prompt_tokens: inp, completion_tokens: out, total_tokens: inp + out } };
  }
  if (p.kind === 'gemini') {
    const cand = raw.candidates?.[0];
    const text = cand?.content?.parts?.map((part) => part.text || '').join('') ?? '';
    const um = raw.usageMetadata || {};
    return {
      content: text,
      usage: {
        prompt_tokens: um.promptTokenCount ?? 0,
        completion_tokens: um.candidatesTokenCount ?? 0,
        total_tokens: um.totalTokenCount ?? 0,
      },
    };
  }
  return { content: '', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
}

/** Parse one streamed SSE JSON object into a {delta, usage} patch. */
function parseStreamChunk(provider, parsed) {
  const p = PROVIDERS[provider];
  if (p.kind === 'openai') {
    const delta = parsed.choices?.[0]?.delta?.content;
    const usage = parsed.usage
      ? {
        prompt_tokens: parsed.usage.prompt_tokens ?? 0,
        completion_tokens: parsed.usage.completion_tokens ?? 0,
        total_tokens: parsed.usage.total_tokens ?? 0,
      }
      : null;
    return { delta: delta || '', usage };
  }
  if (p.kind === 'claude') {
    if (parsed.type === 'content_block_delta' && parsed.delta?.text) return { delta: parsed.delta.text, usage: null };
    if (parsed.type === 'message_start' && parsed.message?.usage) {
      return { delta: '', usage: { prompt_tokens: parsed.message.usage.input_tokens || 0, completion_tokens: 0, total_tokens: 0 } };
    }
    if (parsed.type === 'message_delta' && parsed.usage) {
      return { delta: '', usage: { prompt_tokens: 0, completion_tokens: parsed.usage.output_tokens || 0, total_tokens: 0 } };
    }
    return { delta: '', usage: null };
  }
  if (p.kind === 'gemini') {
    const text = parsed.candidates?.[0]?.content?.parts?.map((x) => x.text || '').join('') ?? '';
    const um = parsed.usageMetadata;
    const usage = um
      ? { prompt_tokens: um.promptTokenCount ?? 0, completion_tokens: um.candidatesTokenCount ?? 0, total_tokens: um.totalTokenCount ?? 0 }
      : null;
    return { delta: text, usage };
  }
  return { delta: '', usage: null };
}

/**
 * Buffered (non-streaming) completion.
 * @returns {Promise<{provider, model, message:{role,content}, usage}>}
 */
export async function callAI(provider, apiKey, model, messages, opts = {}) {
  if (!isValidProvider(provider)) throw new Error(`Unsupported provider: ${provider}`);
  const { temperature = 0.7, maxTokens = 2048, signal = null, tools = null, baseURL = null } = opts;
  const fetchSignal = signal || AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS);

  const { url, headers, body } = buildRequest(provider, apiKey, model, messages, { temperature, maxTokens, stream: false, tools, baseURL });
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: fetchSignal });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error?.message || err.error?.[0]?.message || err.message || response.statusText;
    throw apiError(provider, response.status, msg);
  }
  const raw = await response.json();
  const { content, usage } = parseBuffered(provider, raw);
  return { provider, model, message: { role: 'assistant', content }, usage };
}

/**
 * Streaming completion. Async generator yielding:
 *   { type:'delta', content }  and finally  { type:'done', usage }
 */
export async function* streamAI(provider, apiKey, model, messages, opts = {}) {
  if (!isValidProvider(provider)) throw new Error(`Unsupported provider: ${provider}`);
  const { temperature = 0.7, maxTokens = 2048, signal = null, baseURL = null } = opts;
  const fetchSignal = signal || AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS);

  const { url, headers, body } = buildRequest(provider, apiKey, model, messages, { temperature, maxTokens, stream: true, baseURL });
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: fetchSignal });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error?.message || err.error?.[0]?.message || err.message || response.statusText;
    throw apiError(provider, response.status, msg);
  }

  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let buffer = '';
  const decoder = new TextDecoder();

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split('\n');
    buffer = events.pop() || '';
    for (const line of events) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]' || data === '') continue;
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const { delta, usage: u } = parseStreamChunk(provider, parsed);
      if (u) {
        if (u.prompt_tokens) usage.prompt_tokens = u.prompt_tokens;
        if (u.completion_tokens) usage.completion_tokens = u.completion_tokens;
        if (u.total_tokens) usage.total_tokens = u.total_tokens;
      }
      if (delta) yield { type: 'delta', content: delta };
    }
  }
  if (!usage.total_tokens) usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
  yield { type: 'done', usage };
}

/**
 * Call providers in order until one succeeds. Each entry: {provider, apiKey, model}.
 * Returns the first successful result plus which provider answered.
 */
export async function callWithFallback(chain, messages, opts = {}) {
  const errors = [];
  for (const link of chain) {
    try {
      const res = await callAI(link.provider, link.apiKey, link.model, messages, opts);
      return { ...res, fallbackUsed: errors.length > 0, attempts: errors.length + 1 };
    } catch (err) {
      errors.push({ provider: link.provider, error: err.message });
      // Don't fall through on user-cancellation.
      if (err.name === 'AbortError') throw err;
    }
  }
  const combined = new Error(`All providers failed: ${errors.map((e) => `${e.provider} (${e.error})`).join('; ')}`);
  combined.status = 502;
  combined.attempts = errors;
  throw combined;
}

/** Back-compat helper mirroring the old normalizeResponse() shape. */
export function normalizeResponse(result) {
  return { message: result.message, usage: result.usage };
}

export const EMBEDDING_MODELS = {
  openai: 'text-embedding-3-small',
  gemini: 'text-embedding-004',
};

/**
 * Embed an array of texts. Supports OpenAI and Gemini (the providers with
 * embedding endpoints). Returns an array of number[] vectors aligned to input.
 */
export async function embed(provider, apiKey, texts, opts = {}) {
  const list = Array.isArray(texts) ? texts : [texts];
  const signal = opts.signal || AbortSignal.timeout(opts.timeoutMs || 60000);
  const model = opts.model || EMBEDDING_MODELS[provider];

  if (provider === 'openai' || (PROVIDERS[provider] && PROVIDERS[provider].kind === 'openai')) {
    const base = (PROVIDERS[provider] && PROVIDERS[provider].custom && opts.baseURL)
      ? opts.baseURL.replace(/\/+$/, '')
      : (PROVIDERS[provider] ? PROVIDERS[provider].base : PROVIDERS.openai.base);
    const res = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model || 'text-embedding-3-small', input: list }),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw apiError(provider, res.status, err.error?.message || res.statusText);
    }
    const data = await res.json();
    return data.data.map((d) => d.embedding);
  }

  if (provider === 'gemini') {
    const m = model || EMBEDDING_MODELS.gemini;
    const gbase = opts.baseURL ? opts.baseURL.replace(/\/+$/, '') : PROVIDERS.gemini.base;
    const res = await fetch(`${gbase}/models/${m}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: list.map((t) => ({ model: `models/${m}`, content: { parts: [{ text: t }] } })) }),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw apiError(provider, res.status, err.error?.message || res.statusText);
    }
    const data = await res.json();
    return (data.embeddings || []).map((e) => e.values);
  }

  throw new Error(`Provider ${provider} does not support embeddings`);
}
