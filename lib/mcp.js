/**
 * Model Context Protocol (MCP) client.
 *
 * Lets octra act as an MCP *client* and consume tools exposed by remote/local
 * MCP servers over the Streamable HTTP transport (JSON-RPC 2.0; responses may be
 * a single JSON body or an SSE stream). This turns octra's 4 built-in tools into
 * an open-ended catalogue: any MCP server the user points at becomes callable
 * from the agent loop. Pure HTTP — no new infra, consistent with BYOK (the user
 * supplies the server URL and any auth header).
 *
 * Spec: https://modelcontextprotocol.io  (Streamable HTTP transport)
 */

const PROTOCOL_VERSION = '2025-06-18';

function jsonRpc(method, params, id) {
  const msg = { jsonrpc: '2.0', method };
  if (params !== undefined) msg.params = params;
  if (id !== undefined) msg.id = id;
  return msg;
}

/** Extract the JSON-RPC response object from a fetch Response (JSON or SSE). */
async function readRpcResponse(res, id) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const text = await res.text();
    let fallback = null;
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const obj = JSON.parse(data);
        if (obj && obj.id === id) return obj;
        // Only treat an id-less response as a fallback (some servers omit it);
        // never accept a response belonging to a *different* request id.
        if (obj && obj.id === undefined && (obj.result !== undefined || obj.error !== undefined)) fallback = obj;
      } catch {
        /* ignore non-JSON SSE lines */
      }
    }
    return fallback;
  }
  // Single JSON body (possibly empty for notifications / 202).
  const body = await res.text();
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export class McpClient {
  /**
   * @param {string} url MCP server endpoint
   * @param {object} [opts] { headers, timeoutMs, fetchImpl }
   */
  constructor(url, opts = {}) {
    if (!/^https?:\/\//.test(url)) throw new Error('MCP server URL must be http(s)');
    this.url = url;
    this.headers = opts.headers || {};
    this.timeoutMs = opts.timeoutMs || 30000;
    this.fetchImpl = opts.fetchImpl || fetch;
    this.sessionId = null;
    this.nextId = 1;
    this.serverInfo = null;
    this.tools = [];
  }

  async _send(message, { expectResponse = true } = {}) {
    const headers = Object.assign(
      { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      this.headers,
    );
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    if (!res.ok && res.status !== 202) {
      const errText = await res.text().catch(() => '');
      throw new Error(`MCP server error ${res.status}: ${errText.slice(0, 200)}`);
    }
    if (!expectResponse) {
      if (res.body && typeof res.body.cancel === 'function') { try { await res.body.cancel(); } catch { /* ignore */ } }
      return null;
    }
    const rpc = await readRpcResponse(res, message.id);
    if (rpc && rpc.error) throw new Error(`MCP error: ${rpc.error.message || JSON.stringify(rpc.error)}`);
    return rpc ? rpc.result : null;
  }

  async initialize() {
    const result = await this._send(jsonRpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      clientInfo: { name: 'octra-ai-agent', version: '3.1.0' },
    }, this.nextId++));
    this.serverInfo = result?.serverInfo || null;
    // Best-effort "initialized" notification (no response expected).
    try {
      await this._send(jsonRpc('notifications/initialized', {}), { expectResponse: false });
    } catch {
      /* some servers don't require it */
    }
    return this.serverInfo;
  }

  async listTools() {
    const result = await this._send(jsonRpc('tools/list', {}, this.nextId++));
    this.tools = (result && result.tools) || [];
    return this.tools;
  }

  async callTool(name, args) {
    const result = await this._send(jsonRpc('tools/call', { name, arguments: args || {} }, this.nextId++));
    return result;
  }
}

/** Flatten an MCP tools/call result into a string for the agent loop. */
export function flattenToolResult(result) {
  if (!result) return '';
  if (Array.isArray(result.content)) {
    return result.content
      .map((c) => (c.type === 'text' ? c.text : (c.type === 'resource' ? JSON.stringify(c.resource) : `[${c.type}]`)))
      .join('\n');
  }
  return typeof result === 'string' ? result : JSON.stringify(result);
}

/**
 * Manages connections to multiple MCP servers and exposes their tools in the
 * shape the agent loop expects ({ name, description, run }).
 */
export class McpRegistry {
  constructor() {
    /** @type {Map<string, {id, url, label, client, tools}>} */
    this.servers = new Map();
  }

  async connect(id, url, opts = {}) {
    const client = new McpClient(url, opts);
    await client.initialize();
    const tools = await client.listTools();
    this.servers.set(id, { id, url, label: opts.label || (client.serverInfo?.name) || url, client, tools });
    return { id, label: this.servers.get(id).label, tools: tools.map((t) => ({ name: t.name, description: t.description || '' })) };
  }

  disconnect(id) {
    return this.servers.delete(id);
  }

  list() {
    return [...this.servers.values()].map((s) => ({
      id: s.id,
      label: s.label,
      url: s.url,
      tools: s.tools.map((t) => ({ name: t.name, description: t.description || '' })),
    }));
  }

  /**
   * Build a tool map ({ namespacedName: {description, run} }) for the agent loop.
   * Names are namespaced as `mcp__<serverId>__<tool>` to avoid collisions.
   */
  toolMap() {
    const map = {};
    for (const s of this.servers.values()) {
      for (const t of s.tools) {
        const key = `mcp__${s.id}__${t.name}`;
        map[key] = {
          description: (t.description || '') + ` (via MCP server "${s.label}")`,
          run: async (args) => flattenToolResult(await s.client.callTool(t.name, args)),
        };
      }
    }
    return map;
  }
}
