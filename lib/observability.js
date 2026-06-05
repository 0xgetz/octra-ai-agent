/**
 * Lightweight, dependency-free observability.
 *
 * Tracks per-route request counts, latencies, status codes, token usage and
 * estimated spend, keeps a small ring buffer of recent traces, and can emit
 * Prometheus exposition format. An Express middleware times every request and
 * stamps an X-Trace-Id header for correlation.
 */
import { randomUUID } from 'node:crypto';

export class Metrics {
  constructor({ maxRecent = 200 } = {}) {
    this.startedAt = Date.now();
    this.requests = 0;
    this.errors = 0;
    this.byRoute = new Map(); // "METHOD /path" -> { count, errors, totalMs, maxMs, statuses }
    this.tokens = { prompt: 0, completion: 0, total: 0 };
    this.cost = 0;
    this.recent = [];
    this.maxRecent = maxRecent;
  }

  record(route, method, status, ms) {
    this.requests++;
    if (status >= 500) this.errors++;
    const key = `${method} ${route}`;
    let r = this.byRoute.get(key);
    if (!r) {
      r = { count: 0, errors: 0, totalMs: 0, maxMs: 0, statuses: {} };
      this.byRoute.set(key, r);
    }
    r.count++;
    r.totalMs += ms;
    if (ms > r.maxMs) r.maxMs = ms;
    if (status >= 400) r.errors++;
    r.statuses[status] = (r.statuses[status] || 0) + 1;
  }

  addUsage(usage = {}, cost = 0) {
    this.tokens.prompt += usage.prompt_tokens || 0;
    this.tokens.completion += usage.completion_tokens || 0;
    this.tokens.total += usage.total_tokens || 0;
    this.cost += cost || 0;
  }

  trace(entry) {
    this.recent.push({ ts: Date.now(), ...entry });
    if (this.recent.length > this.maxRecent) this.recent.shift();
  }

  snapshot() {
    const routes = {};
    for (const [k, r] of this.byRoute) {
      routes[k] = { ...r, avgMs: r.count ? Math.round(r.totalMs / r.count) : 0 };
    }
    return {
      uptimeMs: Date.now() - this.startedAt,
      requests: this.requests,
      errors: this.errors,
      tokens: this.tokens,
      estimatedCostUSD: Math.round(this.cost * 1e6) / 1e6,
      routes,
      recent: this.recent.slice(-25),
    };
  }

  prometheus() {
    const s = this.snapshot();
    const lines = [];
    lines.push('# HELP octra_requests_total Total HTTP requests');
    lines.push('# TYPE octra_requests_total counter');
    lines.push(`octra_requests_total ${s.requests}`);
    lines.push('# HELP octra_errors_total Total 5xx responses');
    lines.push('# TYPE octra_errors_total counter');
    lines.push(`octra_errors_total ${s.errors}`);
    lines.push('# HELP octra_tokens_total Total tokens processed');
    lines.push('# TYPE octra_tokens_total counter');
    lines.push(`octra_tokens_total{type="prompt"} ${s.tokens.prompt}`);
    lines.push(`octra_tokens_total{type="completion"} ${s.tokens.completion}`);
    lines.push('# HELP octra_cost_usd_total Estimated spend in USD');
    lines.push('# TYPE octra_cost_usd_total counter');
    lines.push(`octra_cost_usd_total ${s.estimatedCostUSD}`);
    lines.push('# HELP octra_route_requests_total Requests per route');
    lines.push('# TYPE octra_route_requests_total counter');
    for (const [k, r] of Object.entries(s.routes)) {
      const idx = k.indexOf(' ');
      const method = k.slice(0, idx);
      const path = k.slice(idx + 1);
      const labels = `method="${method}",route="${path}"`;
      lines.push(`octra_route_requests_total{${labels}} ${r.count}`);
      lines.push(`octra_route_avg_ms{${labels}} ${r.avgMs}`);
    }
    return lines.join('\n') + '\n';
  }
}

/** Express middleware: time each request and attach a trace id. */
export function metricsMiddleware(metrics) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    const traceId = randomUUID();
    req.traceId = traceId;
    res.setHeader('X-Trace-Id', traceId);
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const route = req.route?.path
        ? `${req.baseUrl || ''}${req.route.path}`
        : (req.path || req.url.split('?')[0]);
      metrics.record(route, req.method, res.statusCode, ms);
      metrics.trace({ traceId, method: req.method, route, status: res.statusCode, ms: Math.round(ms) });
    });
    next();
  };
}
