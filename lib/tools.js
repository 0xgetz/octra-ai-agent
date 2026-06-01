/**
 * Agentic tool layer.
 *
 * Provides a small set of safe, key-free tools and a provider-agnostic ReAct
 * style loop. Because the five supported providers expose tool-calling with
 * different (and sometimes no) native schemas, we drive tools through a uniform
 * JSON protocol in the prompt instead of provider-native function calling. This
 * works identically on OpenAI, Claude, Gemini, Groq, and OpenRouter.
 */
import { callAI } from './providers.js';

/** Safe arithmetic evaluator (recursive descent — no eval/Function). */
export function evalArithmetic(expr) {
  if (typeof expr !== 'string' || expr.length > 200) throw new Error('Invalid expression');
  let i = 0;
  const s = expr.replace(/\s+/g, '');
  if (!/^[0-9.+\-*/%()]*$/.test(s)) throw new Error('Expression contains illegal characters');

  function peek() { return s[i]; }
  function parseExpr() {
    let v = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = s[i++];
      const r = parseFactor();
      if (op === '*') v *= r;
      else if (op === '/') v /= r;
      else v %= r;
    }
    return v;
  }
  function parseFactor() {
    if (peek() === '+') { i++; return parseFactor(); }
    if (peek() === '-') { i++; return -parseFactor(); }
    if (peek() === '(') {
      i++;
      const v = parseExpr();
      if (peek() !== ')') throw new Error('Mismatched parentheses');
      i++;
      return v;
    }
    let num = '';
    while (i < s.length && /[0-9.]/.test(s[i])) num += s[i++];
    if (num === '') throw new Error('Expected number');
    const n = Number(num);
    if (!Number.isFinite(n)) throw new Error('Invalid number');
    return n;
  }
  const result = parseExpr();
  if (i !== s.length) throw new Error('Unexpected trailing input');
  if (!Number.isFinite(result)) throw new Error('Result is not finite');
  return result;
}

/** Guard against SSRF: only allow public http(s) hosts. */
function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http/https URLs allowed');
  // URL.hostname returns IPv6 in bracket notation (e.g. "[::1]"); strip brackets
  // before matching so IPv6 loopback/private ranges can't slip past the guard.
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const blocked = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^169\.254\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^0\.0\.0\.0$/,
    /\.local$/i,
    /metadata/i,
    // IPv6 loopback, unspecified, unique-local (fc00::/7) and link-local (fe80::/10)
    /^::1$/,
    /^::$/,
    /^f[cd][0-9a-f]{2}:/,
    /^fe[89ab][0-9a-f]:/,
    // IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1 or ::ffff:127.0.0.1)
    /^::ffff:(10|127)\./,
    /^::ffff:192\.168\./,
    /^::ffff:169\.254\./,
    /^::ffff:172\.(1[6-9]|2[0-9]|3[0-1])\./,
  ];
  if (blocked.some((re) => re.test(host))) throw new Error('Refusing to fetch private/internal host');
  return u.toString();
}

export const TOOLS = {
  calculator: {
    description: 'Evaluate an arithmetic expression. Args: { "expression": "2*(3+4)" }',
    async run({ expression }) {
      const value = evalArithmetic(String(expression ?? ''));
      return { expression, value };
    },
  },
  datetime: {
    description: 'Get the current UTC date and time. Args: {}',
    async run() {
      const now = new Date();
      return { iso: now.toISOString(), unix: Math.floor(now.getTime() / 1000) };
    },
  },
  web_search: {
    description: 'Search the web for a query and get top result snippets. Args: { "query": "..." }',
    async run({ query }, { signal } = {}) {
      const q = String(query ?? '').trim();
      if (!q) throw new Error('query is required');
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&no_redirect=1`;
      const res = await fetch(url, { signal: signal || AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`search failed (${res.status})`);
      const data = await res.json();
      const results = [];
      if (data.AbstractText) results.push({ title: data.Heading, snippet: data.AbstractText, url: data.AbstractURL });
      for (const topic of data.RelatedTopics || []) {
        if (topic.Text) results.push({ title: topic.Text.slice(0, 80), snippet: topic.Text, url: topic.FirstURL });
        if (results.length >= 6) break;
      }
      return { query: q, results: results.slice(0, 6) };
    },
  },
  http_fetch: {
    description: 'Fetch a public URL and return its text content (truncated). Args: { "url": "https://..." }',
    async run({ url }, { signal } = {}) {
      const safe = assertPublicUrl(String(url ?? ''));
      const res = await fetch(safe, { signal: signal || AbortSignal.timeout(15000), redirect: 'follow' });
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      const text = await res.text();
      const stripped = text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return { url: safe, status: res.status, content: stripped.slice(0, 4000) };
    },
  },
};

export function toolCatalogue() {
  return Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description }));
}

/** Execute a single named tool with arguments. */
export async function executeTool(name, args, ctx = {}) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.run(args || {}, ctx);
}

const TOOL_SYSTEM_PROMPT = (catalogue) => `You are an autonomous AI agent that can use tools to answer the user.

Available tools:
${catalogue.map((t) => `- ${t.name}: ${t.description}`).join('\n')}

To use a tool, respond with ONLY a JSON object on its own line:
{"tool": "<name>", "args": { ... }}

After you receive the tool result (provided as an OBSERVATION), decide whether to
use another tool or give the final answer. When you have enough information,
respond with ONLY:
{"final": "<your complete answer to the user>"}

Rules:
- Emit exactly one JSON object per turn, no extra prose around it.
- Prefer tools over guessing for facts, math, current data, or web content.
- If a tool errors, adapt or answer with what you know.`;

/** Extract the first balanced top-level JSON object from a string. */
export function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Run the agentic loop: the model reasons and calls tools until it produces a
 * final answer or hits maxSteps.
 * @returns {Promise<{answer:string, steps:Array, usage:object}>}
 */
export async function runAgentLoop({ provider, apiKey, model, query, temperature = 0.5, maxTokens = 2048, maxSteps = 6, signal, onEvent }) {
  const catalogue = toolCatalogue();
  const messages = [
    { role: 'system', content: TOOL_SYSTEM_PROMPT(catalogue) },
    { role: 'user', content: query },
  ];
  const steps = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const emit = (event, data) => { if (onEvent) onEvent(event, data); };

  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) break;
    const res = await callAI(provider, apiKey, model, messages, { temperature, maxTokens, signal });
    usage.prompt_tokens += res.usage.prompt_tokens;
    usage.completion_tokens += res.usage.completion_tokens;
    usage.total_tokens += res.usage.total_tokens;
    const text = res.message.content;
    const obj = extractJsonObject(text);

    if (obj && typeof obj.final === 'string') {
      emit('final', { answer: obj.final });
      return { answer: obj.final, steps, usage };
    }
    if (obj && obj.tool) {
      emit('tool_call', { step, tool: obj.tool, args: obj.args });
      let observation;
      try {
        const result = await executeTool(obj.tool, obj.args, { signal });
        observation = JSON.stringify(result);
        steps.push({ tool: obj.tool, args: obj.args, result, ok: true });
      } catch (err) {
        observation = `ERROR: ${err.message}`;
        steps.push({ tool: obj.tool, args: obj.args, error: err.message, ok: false });
      }
      emit('tool_result', { step, tool: obj.tool, observation });
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: `OBSERVATION (${obj.tool}): ${observation}` });
      continue;
    }

    // No structured directive — treat the plain text as the final answer.
    emit('final', { answer: text });
    return { answer: text, steps, usage };
  }
  return { answer: '(agent reached step limit without a final answer)', steps, usage };
}
