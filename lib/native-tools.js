/**
 * Native function-calling agent loop with parallel tool execution.
 *
 * runAgentLoop() (tools.js) drives tools through a uniform JSON protocol in the
 * prompt — portable but slower and less reliable than the providers' own
 * tool-calling APIs, and strictly one tool per turn. This module uses
 * provider-native function calling for OpenAI-compatible providers (OpenAI,
 * Groq, OpenRouter, custom) and Anthropic Claude, executing every tool call the
 * model emits in a turn concurrently. Gemini and any other kind transparently
 * fall back to the JSON ReAct loop so the endpoint always works.
 *
 * Tools (including dynamically-registered MCP tools) are reused from tools.js,
 * so there is a single source of truth for agent capabilities.
 */
import { PROVIDERS } from './providers.js';
import { TOOLS, executeTool, runAgentLoop } from './tools.js';

// JSON-schema parameters for the built-in tools (native calling needs a schema).
const BUILTIN_SCHEMAS = {
  calculator: {
    type: 'object',
    properties: { expression: { type: 'string', description: 'Arithmetic expression, e.g. 2*(3+4)' } },
    required: ['expression'],
  },
  datetime: { type: 'object', properties: {} },
  web_search: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The search query' } },
    required: ['query'],
  },
  http_fetch: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Public http(s) URL to fetch' } },
    required: ['url'],
  },
};

/** Build {name, description, parameters} specs for every available tool. */
export function buildToolSpecs(extraTools = {}, schemas = {}) {
  const all = { ...TOOLS, ...extraTools };
  return Object.entries(all).map(([name, t]) => ({
    name,
    description: t.description || t.label || `Tool ${name}`,
    parameters:
      schemas[name] ||
      BUILTIN_SCHEMAS[name] ||
      t.inputSchema ||
      t.parameters || { type: 'object', properties: {}, additionalProperties: true },
  }));
}

async function postJSON(url, headers, body, signal) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || err.error?.[0]?.message || err.message || res.statusText;
    throw Object.assign(new Error(`API error (${res.status}): ${msg}`), { status: res.status });
  }
  return res.json();
}

/** Execute every tool call concurrently, returning normalised results. */
async function runToolsParallel(calls, extraTools, signal, steps) {
  return Promise.all(
    calls.map(async ({ id, name, args }) => {
      try {
        const result = await executeTool(name, args || {}, { signal }, extraTools);
        const content = typeof result === 'string' ? result : JSON.stringify(result);
        steps.push({ tool: name, args, ok: true });
        return { id, content, isError: false };
      } catch (err) {
        steps.push({ tool: name, args, ok: false, error: err.message });
        return { id, content: `ERROR: ${err.message}`, isError: true };
      }
    }),
  );
}

/**
 * Run a tool-using agent with provider-native function calling.
 * Accepts either `query` (string) or `messages` (chat array).
 * @returns {Promise<{answer:string, steps:Array, usage:object}>}
 */
export async function runNativeAgent({
  provider,
  apiKey,
  model,
  messages,
  query,
  system,
  temperature = 0.5,
  maxTokens = 2048,
  maxSteps = 6,
  signal,
  onEvent,
  extraTools = {},
  toolSchemas = {},
  baseURL = null,
}) {
  const p = PROVIDERS[provider];
  if (!p) throw Object.assign(new Error(`Unsupported provider: ${provider}`), { status: 400 });
  const emit = (event, data) => { if (onEvent) onEvent(event, data); };
  const specs = buildToolSpecs(extraTools, toolSchemas);
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const steps = [];
  const convo = Array.isArray(messages) && messages.length
    ? messages.map((m) => ({ role: m.role, content: m.content }))
    : [{ role: 'user', content: String(query ?? '') }];
  const finalUsage = () => {
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    return usage;
  };

  // ---- OpenAI-compatible native tools (OpenAI, Groq, OpenRouter, custom) ----
  if (p.kind === 'openai') {
    const base = (p.custom && baseURL) ? baseURL.replace(/\/+$/, '') : p.base;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey || 'none'}` };
    const tools = specs.map((s) => ({ type: 'function', function: { name: s.name, description: s.description, parameters: s.parameters } }));
    const msgs = system ? [{ role: 'system', content: system }, ...convo] : [...convo];

    for (let step = 0; step < maxSteps; step++) {
      if (signal?.aborted) break;
      const data = await postJSON(`${base}/chat/completions`, headers,
        { model, messages: msgs, temperature, max_tokens: maxTokens, tools, tool_choice: 'auto' }, signal);
      if (data.usage) {
        usage.prompt_tokens += data.usage.prompt_tokens || 0;
        usage.completion_tokens += data.usage.completion_tokens || 0;
      }
      const msg = data.choices?.[0]?.message || {};
      const calls = msg.tool_calls || [];
      msgs.push({ role: 'assistant', content: msg.content || '', ...(calls.length ? { tool_calls: calls } : {}) });
      if (!calls.length) {
        emit('final', { answer: msg.content || '' });
        return { answer: msg.content || '', steps, usage: finalUsage() };
      }
      const normalized = calls.map((c) => {
        let args = {};
        try { args = c.function?.arguments ? JSON.parse(c.function.arguments) : {}; } catch { args = {}; }
        return { id: c.id, name: c.function?.name, args };
      });
      emit('tool_calls', { step, calls: normalized.map((c) => ({ id: c.id, name: c.name })) });
      const results = await runToolsParallel(normalized, extraTools, signal, steps);
      for (const r of results) msgs.push({ role: 'tool', tool_call_id: r.id, content: r.content });
      emit('tool_result', { step, count: results.length });
    }
    return { answer: '(agent reached step limit without a final answer)', steps, usage: finalUsage() };
  }

  // ---- Anthropic Claude native tools ----
  if (p.kind === 'claude') {
    const base = p.base;
    const headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
    const tools = specs.map((s) => ({ name: s.name, description: s.description, input_schema: s.parameters }));
    const cmsgs = convo.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    for (let step = 0; step < maxSteps; step++) {
      if (signal?.aborted) break;
      const body = { model, max_tokens: maxTokens, temperature, messages: cmsgs, tools };
      if (system) body.system = system;
      const data = await postJSON(`${base}/messages`, headers, body, signal);
      if (data.usage) {
        usage.prompt_tokens += data.usage.input_tokens || 0;
        usage.completion_tokens += data.usage.output_tokens || 0;
      }
      const blocks = Array.isArray(data.content) ? data.content : [];
      cmsgs.push({ role: 'assistant', content: blocks });
      const toolUses = blocks.filter((b) => b.type === 'tool_use');
      if (!toolUses.length) {
        const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
        emit('final', { answer: text });
        return { answer: text, steps, usage: finalUsage() };
      }
      const normalized = toolUses.map((b) => ({ id: b.id, name: b.name, args: b.input || {} }));
      emit('tool_calls', { step, calls: normalized.map((c) => ({ id: c.id, name: c.name })) });
      const results = await runToolsParallel(normalized, extraTools, signal, steps);
      cmsgs.push({
        role: 'user',
        content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
      });
      emit('tool_result', { step, count: results.length });
    }
    return { answer: '(agent reached step limit without a final answer)', steps, usage: finalUsage() };
  }

  // ---- Gemini / other kinds: fall back to the provider-agnostic JSON loop ----
  const q = Array.isArray(messages) && messages.length
    ? messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
    : String(query ?? '');
  return runAgentLoop({ provider, apiKey, model, query: q, temperature, maxTokens, maxSteps, signal, onEvent, extraTools, baseURL });
}
