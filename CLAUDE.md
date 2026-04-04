# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Meridian is an autonomous Solana DLMM liquidity provisioning bot. It runs LLM agents in a ReAct loop (reason → tool call → act) to screen Meteora pools, deploy SOL capital, manage open positions, and self-improve from trade outcomes — all without human intervention.

## Commands

```bash
# Run
npm start                        # live mode (real on-chain transactions)
npm run dev                      # dry run — no on-chain execution (DRY_RUN=true)

# Web UI
npm run dev:web                  # Vite dev server for React dashboard
npm run build:web                # build web/dist/

# Tests
node test/test-screening.js      # pool discovery API (no wallet needed)
DRY_RUN=true node test/test-agent.js    # full agent loop dry run
node --test test/test-runtime-fixes.js  # Node built-in test runner

# Setup
node setup.js                    # interactive config wizard
```

No lint or build step for the backend — it's plain ESM Node.js.

## Architecture

### Entry point and scheduling (`index.js`)

Boots two independent cron loops:
- **Screener** — finds new pools, studies top LPers, deploys capital
- **Manager** — monitors open positions, enforces exit rules (stop-loss, trailing TP, OOR, emergency close)

Both loops are mutex-guarded via busy flags in `session.js`. Management interval auto-adjusts based on pool volatility (high: 3 min, medium: 5 min, low: 10 min).

### Agent loop (`agent.js`)

Core ReAct loop. Three agent types: `SCREENER`, `MANAGER`, `GENERAL` — each can be routed to a different LLM provider/model via `user-config.json`. Supported providers: `openrouter`, `openai`, `deepseek`, `minimax` — all use the OpenAI-compatible SDK with different `baseURL` values.

Codex screening uses direct REST API calls (not CLI spawning — the `spawn codex` path was removed).

### Tool layer (`tools/`)

- `definitions.js` — all 30+ tool schemas passed to the LLM
- `executor.js` — dispatches tool name → implementation; handles `DRY_RUN` interception and logging
- `dlmm.js` — Meteora DLMM SDK: open/close positions, get active bin, claim fees
- `screening.js` — Meteora Pool Discovery API: fetch, filter, score, rank pools
- `wallet.js` — Helius RPC: balances, Jupiter swaps
- `study.js` / `lp-overview.js` — LP Agent API: top LPer analysis, lifetime PnL
- `token.js` — Jupiter: holder counts, token narratives
- `okx.js` — OKX DEX API: price signals, market health (injected into management prompts)

When adding a new capability, add the schema to `definitions.js` and the dispatch entry to the `toolMap` in `executor.js`.

### State and session

- `state.js` — single source of truth for tracked positions. Persists to `state.json`. All position reads/writes go here.
- `session.js` — in-memory: conversation history and three busy flags (`isBusy`, `isManagementBusy`, `isScreeningBusy`). Never persisted.
- `notifier.js` — lightweight `EventEmitter` pub/sub. Agents emit events here; `server.js` (WebSocket) and `telegram.js` subscribe.

### Config system

`config.js` loads `user-config.json` and merges with hardcoded defaults. The `update_config` tool writes directly to `user-config.json` and calls `reloadScreeningThresholds()` so changes take effect without restart.

Config precedence: `user-config.json` > `.env` > defaults in `config.js`.

### Learning systems

Four systems that inject information into agent prompts:

1. **Lessons** (`lessons.js`) — every close generates a tagged `[WIN]`/`[FAIL]`/`[NEUTRAL]` lesson. Injected via 3-tier priority: pinned (≤10) → role-matched (≤15) → recent fill (≤35 total).
2. **Nuggets / Holographic Memory** (`memory.js`) — HRR-based vector memory via the `nuggets` local package (`../nuggets`). Facts recalled 3+ times are promoted to permanent context. Persisted in `data/nuggets/`.
3. **Pool Memory** (`pool-memory.js`) — per-pool deploy history with PnL. Checked before deploying. Persisted in `pool-memory.json`.
4. **Darwinian Signal Weights** (`signal-weights.js`) — screening signals weighted by predictive power, recalculated after enough positions. Persisted in `signal-weights.json`.

### Web server (`server.js` + `web/`)

Express serves the built React SPA from `web/dist/` and a WebSocket server on the same port (default 3737). `web/src/hooks/useWebSocket.ts` is the single data-fetching hook — handles reconnection and merges server-push updates into React state. Tab routing is done via state in `App.tsx` (not React Router).

## My model configuration (do NOT change without asking)

- Screening: MiniMax-M2.5 via minimax
- Management: MiniMax-M2.5 via minimax
- Autoresearch: openai/gpt-5.4-nano via OpenRouter, fallback to screeningModel
- General/lightChat: MiniMax-M2.7 via minimax
- OpenRouter is the preferred provider. No hardcoded DeepSeek references.
- Fallbacks: screening → qwen/qwen3-coder-next, management → deepseek/deepseek-chat-v3-0324

## My fork info

- Fork: https://github.com/kegcii/meridian (upstream: fciaf420/meridian)
- Active branch: `feature/upstream-merge`
- `data/nuggets/` and `autoresearch.json` are runtime data, not tracked in git

## Resolved bugs (don't re-introduce)

- `spawn codex ENOENT` — removed Codex CLI dependency, using REST API directly
- WebSocket endpoint incompatible server-side — replaced with REST calls
- `JSON.parse` failure from stray `\r` in `.env` values
- `OPENAI_API_KEY` missing from env

## Custom enhancements already applied

- Replaced Codex CLI spawning with direct REST API calls
- Management pre-check to skip LLM when positions are healthy
- Rule 7 (dump detection) and Rule 8 (productivity check) in management logic
- Real-time OKX market health data injected into management prompts
- `evolveThresholds` auto-tuning

## Important constraints

- `*.js.main-github` files are **upstream snapshots** for merge reference on the `feature/upstream-merge` branch. Do not edit them.
- `*.json` data files (`state.json`, `lessons.json`, `pool-memory.json`, etc.) are **live runtime state**. Do not edit while the bot is running.
- The Meteora DLMM SDK requires a patch at install time (`scripts/patch-anchor.js`), applied automatically via `postinstall`.
- All files use **ES modules** (`"type": "module"`). No CommonJS `require()`.
- `DRY_RUN=true` bypasses all on-chain writes in `executor.js`. Always verify in dry-run before live.
