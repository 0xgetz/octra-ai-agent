# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [2.2.0] - 2026-04-11

### Added
- Vercel serverless deployment support (`vercel.json` + `api/index.js`)
- Express app converted to ESM serverless function compatible with Vercel free tier
- Route config for API endpoints and static file serving on Vercel

---

## [2.1.0] - 2026-04-11

### Added
- **FEAT-01:** SSE streaming chat — text appears word-by-word via `/api/chat/stream`
- **FEAT-02:** Autopilot context no longer truncated (was 500 chars, now passes full output)
- **FEAT-03:** Token usage and estimated cost display after each chat message
- **FEAT-04:** Chat export now produces a structured JSON file (machine-readable)
- **FEAT-05:** System prompt customization field in Settings, applied to all chats
- **FEAT-06:** Docker `HEALTHCHECK` added to Dockerfile (`wget /api/health` every 30s)
- **FEAT-07:** `npm test` script + `tests/server.test.js` with 6 integration tests

### Fixed

#### Critical
- **BUG-01:** Fixed frontend Claude model IDs (`claude-sonnet-4-5`, `claude-opus-4-5`, `claude-3-5-haiku-20241022`, `claude-3-opus-20240229`) — all Claude API calls were returning 404 due to invalid model IDs
- **BUG-02:** Autopilot Stop button now actually cancels the running task — backend uses `AbortController` per run tracked by `runId`; `/api/autopilot/stop` cancels it cleanly

#### High
- **BUG-03:** Added DOMPurify sanitization to all `marked.parse()` calls — XSS vulnerability fixed
- **BUG-04:** Enabled Helmet CSP with appropriate directives (was explicitly disabled)
- **BUG-05:** Restricted CORS to configurable `CORS_ORIGINS` env var (no more wildcard `*`)
- **BUG-06:** Added `AbortSignal.timeout(120000)` to all upstream OpenAI/Anthropic fetch calls

#### Medium
- **BUG-07:** Autopilot now uses SSE streaming — real-time step progress with spinners and progress bar updates as each step completes
- **BUG-08:** CodeLab now has a provider/model selector UI — model is no longer hardcoded
- **BUG-09:** Removed unused `uuid` import and dead session code from server
- **BUG-10:** `clearTimeout()` now called after `server.close()` succeeds (graceful shutdown)
- **BUG-11:** CI fixed — removed `|| true` masking, added lint job, proper test step
- **BUG-12:** Specific error messages for 429/401/403/500/503 in chat `sendMessage`

#### Low
- **BUG-13:** Renamed `env.example.txt` → `.env.example`, updated README setup steps accordingly
- **BUG-14:** Input length validation on `/api/analyze` (50k code chars, 10k prompt chars)

---

## [2.0.0] - 2026-03-27

### Changed
- Converted codebase to ES Modules (`import`/`export`)
- Replaced manual `https.request` with native `fetch` (Node 18+)

### Added
- Helmet security headers middleware
- `express-rate-limit` (100 req/15min on `/api/*`)
- `/api/models` endpoint
- Graceful `SIGTERM`/`SIGINT` shutdown
- Dockerfile and `.dockerignore`
- GitHub Actions CI matrix (Node 18/20/22)
- `.eslintrc.json` for linting
- `.gitignore`
- CSS custom properties and `prefers-reduced-motion` support
- Modernized HTML with meta tags, OG tags, and `aria-label` attributes
- Comprehensive README with badges and API documentation

---

## [1.0.0] - 2026-03-24

### Added
- Initial project files: `app.js`, `style.css`, frontend assets
- Base Express server with Anthropic/OpenAI multi-provider chat
- Autopilot mode for multi-step autonomous task execution
- CodeLab code analysis feature
- Logo and visual assets
