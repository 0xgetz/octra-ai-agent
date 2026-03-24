# Octra Network AI Agent

A modern, full-featured AI Agent platform with autopilot capabilities. Supports both OpenAI and Anthropic Claude APIs. Users bring their own API keys - nothing stored server-side.

## Features

- **Dual AI Provider Support** - OpenAI (GPT-4o, GPT-4, GPT-3.5-turbo) and Claude (claude-sonnet-4, claude-3-haiku)
- **Autopilot Mode** - Define a goal, AI breaks it into steps and executes them automatically
- **Interactive Chat** - Full chat with markdown rendering, code highlighting, and message history
- **Code Lab** - AI-powered code generation, analysis, refactoring, and explanation
- **Modern Dark UI** - Glassmorphism design with cyan/purple gradients
- **Privacy First** - API keys stored in browser localStorage only, never on the server
- **Responsive** - Works on desktop, tablet, and mobile

## Quick Start

```bash
npm install
npm start
```

Then open http://localhost:3000

## Setup

1. Clone or download this project
2. Run `npm install`
3. Run `npm start`
4. Open http://localhost:3000 in your browser
5. Go to Settings and enter your OpenAI and/or Claude API key
6. Start chatting or use Autopilot mode!

## API Keys

- **OpenAI**: Get yours at https://platform.openai.com/api-keys
- **Claude**: Get yours at https://console.anthropic.com/settings/keys

## Tech Stack

- **Backend**: Node.js, Express
- **Frontend**: Vanilla JS (no framework), CSS3 with glassmorphism
- **AI**: OpenAI API, Anthropic Claude API (proxied through backend)

## Architecture

The frontend sends API keys with each request. The Express backend proxies requests to OpenAI/Anthropic using Node's native `https` module. No keys are stored on the server. Sessions are in-memory only.

## License

MIT
