# 🤖 Octra Network AI Agent

![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=flat-square&logo=node.js)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Version](https://img.shields.io/badge/version-3.0.0-purple?style=flat-square)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)

An advanced, multi-provider AI agent platform: agentic tool use, retrieval-augmented generation (RAG), a multi-agent autopilot, conversation memory, and cost-aware model routing. Bring your own API keys — nothing stored server-side.

![Dashboard](octra_network_dashboard.png)

## ✨ Features

- **5 AI Providers** — OpenAI, Anthropic Claude, Google Gemini, Groq, and OpenRouter behind one unified interface
- **Agentic Tool Use** — A ReAct loop with safe built-in tools: web search, URL fetch (SSRF-guarded), a sandboxed calculator, and datetime — works on any provider
- **RAG / Knowledge Base** — Upload documents and ground answers with citations; offline TF-IDF retrieval, no embedding key required
- **Multi-Agent Autopilot** — Plan → execute → self-critique → retry, with optional tool access, one-shot replanning, and a hard token budget
- **Conversation Memory** — Persistent history, branching from any message, and read-only share links
- **Cost-Aware Routing** — Auto-pick the cheapest/fastest/best model from the providers you've configured, with automatic fallback
- **Code Lab** — AI-powered code generation, analysis, refactoring, and explanation
- **Streaming Chat** — SSE word-by-word streaming across all providers
- **Security** — Helmet CSP/CORS, rate limiting, input validation; API keys live in the browser only
- **Single source of truth** — Standalone server and serverless build share one app factory (no drift)

## 🚀 Quick Start

### Local

```bash
git clone https://github.com/0xgetz/octra-ai-agent
cd octra-ai-agent
cp .env.example .env
npm install
npm start
```

Open http://localhost:3000

### Docker

```bash
docker build -t octra-ai-agent .
docker run -p 3000:3000 octra-ai-agent
```

### Development

```bash
npm run dev   # auto-reload with --watch
```

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and set:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Allowed CORS origins (comma-separated; `*` allows all) |
| `PERSIST_DIR` | _(unset)_ | Directory for durable conversation/share storage. In-memory if unset. |

## 🔑 API Keys

- **OpenAI**: https://platform.openai.com/api-keys
- **Claude**: https://console.anthropic.com/settings/keys
- **Gemini**: https://aistudio.google.com/app/apikey
- **Groq**: https://console.groq.com/keys
- **OpenRouter**: https://openrouter.ai/keys

## 📡 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/models` | Available models + provider metadata |
| GET | `/api/tools` | List agentic tools |
| POST | `/api/route` | Cost/speed-aware model recommendation |
| POST | `/api/chat` | Single chat completion (non-streaming) |
| POST | `/api/chat/stream` | SSE streaming chat completion |
| POST | `/api/agent` | Agentic tool-use loop (SSE streaming) |
| POST | `/api/autopilot` | Multi-agent goal execution (SSE streaming) |
| POST | `/api/autopilot/stop` | Cancel an active autopilot run |
| POST | `/api/analyze` | Code analysis/generation |
| POST | `/api/rag/documents` · GET · DELETE | Manage knowledge-base documents |
| POST | `/api/rag/search` | Retrieve top chunks for a query |
| POST | `/api/rag/chat` | Chat grounded in uploaded documents |
| GET/POST | `/api/conversations` | List / create conversations |
| GET/PATCH/DELETE | `/api/conversations/:id` | Read / rename / delete a conversation |
| POST | `/api/conversations/:id/messages` | Append a message |
| POST | `/api/conversations/:id/branch` | Fork from a message |
| POST | `/api/conversations/:id/share` | Create a read-only share link |
| GET/DELETE | `/api/share/:shareId` | View / revoke a shared conversation |

### POST /api/chat

```json
{
  "provider": "openai",
  "apiKey": "sk-...",
  "model": "gpt-4o",
  "messages": [{ "role": "user", "content": "Hello!" }],
  "temperature": 0.7,
  "maxTokens": 2048
}
```

## 🏗 Architecture

- **Backend**: Node.js 18+ (ESM), Express, Helmet, express-rate-limit
- **Shared core** (`lib/`): `app-factory.js` (routes), `providers.js` (5-provider
  adapter + routing/fallback), `tools.js` (ReAct loop + safe tools), `rag.js`
  (TF-IDF retrieval), `agent.js` (multi-agent autopilot), `memory.js`
  (conversations/branching/share), `validation.js`
- **Entrypoints**: `server.js` (standalone) and `api/index.js` (serverless) both
  build their app from the same factory
- **Frontend**: Vanilla JS, CSS3 glassmorphism; selectors hydrate from `/api/models`
- **Persistence**: In-memory by default; set `PERSIST_DIR` for durable conversations

## 🧪 Quality

```bash
npm run lint   # ESLint v10 flat config — 0 errors
npm test       # 32 unit + integration tests (node:test)
```

## 🤝 Contributing

PRs welcome! Please open an issue first for major changes.

## 📄 License

MIT
