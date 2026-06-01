# Octra AI Agent — Tutorial

A step-by-step guide to everything in the app. Pairs with the walkthrough
[`demo.gif`](video/demo.gif) / [`demo.mp4`](video/demo.mp4).

## 1. Run it

```bash
git clone https://github.com/0xgetz/octra-ai-agent
cd octra-ai-agent
npm install          # if devDeps are skipped, use: NODE_ENV=development npm install
npm start            # → http://localhost:3000
```

## 2. Add a provider key (Settings)

Open **Settings → API Keys** and paste a key for any provider you have. Keys are
stored **in your browser only** — never sent to a server. Supported:

- OpenAI, Anthropic Claude, Google Gemini, Groq, OpenRouter
- **Custom / Local** — for Ollama, LM Studio, vLLM, or any OpenAI-compatible API:
  set the **Base URL** (e.g. `http://localhost:11434/v1`) and your model names. No key needed for local.

## 3. Chat (three modes)

The mode selector in the chat header switches behaviour:

- **💬 Chat** — normal streaming conversation.
- **🛠️ Agent** — the model can call tools (web search, fetch, calculator, datetime,
  and any connected MCP tool) in a reasoning loop before answering.
- **📚 Knowledge** — answers are grounded in your uploaded documents with citations.

Attach an **image** with the 🖼 button (vision) on any model that supports it.

## 4. Personas

In **Settings → Personas**, save a reusable assistant (name + system prompt, and
optionally a provider/model). Pick it from the **persona dropdown** in the chat
header to apply it instantly.

## 5. Knowledge base (RAG)

Go to **Knowledge**:

1. Paste text or upload a `.txt/.md/.json` file → **Add to Knowledge Base**.
2. (Optional) Toggle **Use embeddings** and click **Embed documents now** for hybrid
   semantic + keyword retrieval. Without it, fast keyword (TF-IDF) search is used — no key needed.
3. Switch Chat to **Knowledge** mode and ask away — answers cite their sources.

## 6. Autopilot (multi-agent)

On **Autopilot**, describe a goal. The engine will:

1. **Plan** the goal into steps.
2. **Execute** each step (optionally with tools — tick *Use tools*).
3. **Self-critique** each result and **retry** if it falls short (tick *Self-critique*).
4. **Replan** once at the end if the goal isn't fully met — all under a token budget.

Use **Stop** to cancel a run at any time.

## 7. MCP tool servers

In **Settings → MCP Servers**, paste a Model Context Protocol server URL
(Streamable HTTP) and optionally an `Authorization` header. Once connected, that
server's tools are automatically available to **Agent** mode and **Autopilot**.

## 8. Code Lab

Paste code and choose **Generate / Analyze / Refactor / Explain**. Output is
rendered with syntax highlighting and a copy button.

---

### Optional: narration script

If you want to record a voiced-over tutorial over the demo clip, here's a 45-second script:

> "This is Octra — a lightweight, self-hosted AI agent you run yourself, with your own keys.
> On the dashboard you get usage at a glance. In Chat, switch between plain chat, an agent
> that uses tools, or knowledge-grounded answers from your own documents — and you can drop
> in an image for vision models. Autopilot takes a goal, plans it, runs each step, critiques
> its own work, and retries until it's done. In Settings you can wire up any of six providers —
> including local models via Ollama — connect MCP tool servers, and save personas. No backend
> keys, no vendor lock-in, just `npm start`."
