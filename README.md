# 🤖 Octra Network AI Agent

![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=flat-square&logo=node.js)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Version](https://img.shields.io/badge/version-2.1.0-purple?style=flat-square)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)

A modern, full-featured AI Agent platform with autopilot capabilities. Supports OpenAI and Anthropic Claude. Bring your own API keys — nothing stored server-side.

![Dashboard](octra_network_dashboard.png)

## ✨ Features

- **Dual AI Provider** — OpenAI (GPT-4o, GPT-4) and Claude (claude-opus-4-5, claude-sonnet-4-5)
- **Autopilot Mode** — Define a goal, AI breaks it into steps and executes them
- **Interactive Chat** — Full chat with markdown rendering and syntax highlighting
- **Code Lab** — AI-powered code generation, analysis, refactoring, and explanation
- **Security** — Helmet.js CSP/CORS headers, rate limiting, API keys never stored server-side
- **Modern Dark UI** — Glassmorphism design with cyan/purple gradients
- **Streaming Chat** — SSE word-by-word streaming responses
- **Token Cost Display** — Estimated token usage and cost per message
- **JSON Chat Export** — Export full chat history as JSON
- **System Prompt** — Customizable system prompt in Settings
- **Privacy First** — API keys in browser localStorage only

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
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Allowed CORS origins (comma-separated) |

## 🔑 API Keys

- **OpenAI**: https://platform.openai.com/api-keys
- **Claude**: https://console.anthropic.com/settings/keys

## 📡 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/models` | Available models per provider |
| POST | `/api/chat` | Single chat completion (non-streaming) |
| POST | `/api/chat/stream` | SSE streaming chat completion |
| POST | `/api/autopilot` | Multi-step goal execution (SSE streaming) |
| POST | `/api/autopilot/stop` | Cancel an active autopilot run |
| POST | `/api/analyze` | Code analysis/generation |

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
- **Frontend**: Vanilla JS, CSS3 glassmorphism
- **AI**: OpenAI API + Anthropic Claude API (proxied)
- **Sessions**: In-memory (no persistence)

## 🤝 Contributing

PRs welcome! Please open an issue first for major changes.

## 📄 License

MIT
