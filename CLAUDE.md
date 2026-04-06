# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Meridian is an autonomous DLMM (Dynamic Liquidity Market Maker) liquidity management agent for [Meteora](https://meteora.ag) on Solana. It continuously screens pools, deploys capital, manages positions, and self-improves via multi-agent ReAct loops and several persistent learning systems.

## Commands

```bash
# Install
npm install
cd web && npm install && npm run build && cd ..

# Run
npm start              # Live mode (real transactions)
npm run dev            # Dry-run mode (simulated trades, no broadcast)
npm run setup          # Interactive config wizard

# Build
npm run build:web      # Build React frontend to web/dist

# Test
npm run test:screen    # Test pool discovery & screening (no wallet needed)
npm run test:agent     # Test agent loop in dry-run
npm run test:runtime   # Node.js assert-based runtime tests
```

## Architecture

### Agent Roles (agent.js)

Three LLM agent roles run on schedules via cron (index.js):
- **SCREENER** — discovers and analyzes pools, decides deployment (every 30 min)
- **MANAGER** — reviews open positions, claims fees, closes/rebalances (every 10 min)
- **GENERAL** — on-demand chat via web dashboard / REPL / Telegram

All roles use a **ReAct loop** (`agentLoop()` in agent.js): the LLM calls tools iteratively until it emits `<done>`. Roles differ in their system prompt (prompt.js), injected context, and available tools.

### Tool System (tools/)

`tools/definitions.js` declares 40+ tool schemas. `tools/executor.js` routes tool calls to implementations:
- `tools/dlmm.js` — Meteora DLMM SDK wrapper (positions, transactions)
- `tools/screening.js` — pool discovery, candidate ranking
- `tools/wallet.js` — balance queries, swaps, Solana RPC
- `tools/lp-overview.js` — LP Agent API integration
- `tools/knowledge-graph.js` — knowledge base graph building

### Learning Systems (5-layer)

1. **Lessons** (`lessons.js`, `data/lessons.json`) — structured outcomes extracted from every closed position; deduped and injected per-role into prompts
2. **Nuggets** (`memory.js`, `packages/nuggets/`) — HRR-based holographic memory; recallable by pool address, strategy+bin, volatility bucket, etc.
3. **Signal Weights** (`signal-weights.js`, `data/signal-weights.json`) — Darwinian adaptive weighting; tracks which screening signals predict profitable positions
4. **Autoresearch** (`autoresearch.js`, `data/autoresearch-state.json`) — automated prompt A/B testing; tests targeted changes over real position closes, keeps/reverts by performance delta
5. **Knowledge Base** (`knowledge-base.js`, `data/knowledge-base/`) — LLM-maintained markdown wiki; articles on tokens, strategies, market regimes; synthesized from lessons.json and pool-memory.json

### Key Data Flow

**Screening cycle:**
1. Discover pool candidates (Meteora API / LP Agent API)
2. Build system prompt with lessons + nuggets + signal weights + KB summary
3. Run screener ReAct loop; LLM calls tools to analyze pools
4. On deploy decision: calculate bin range from volatility table → `deployPosition()` → record in `data/state.json`
5. File screening result in knowledge base

**Management cycle:**
1. Fetch all open positions on-chain
2. For each: build management prompt (lessons, nuggets, pool detail) → ReAct loop
3. LLM decides: claim fees / rebalance / hold / close
4. On close: extract lesson, update nuggets + signal weights, file in KB

**PnL Watcher** (`pnl-watcher.js`) — independent 30-second loop, no LLM; auto-closes positions when stop-loss, trailing take-profit, or fixed take-profit thresholds are hit.

### State Persistence

JSON files in `data/`: `state.json` (open positions), `lessons.json`, `autoresearch-state.json`, `signal-weights.json`, `strategy-library.json`, `pool-memory.json`, `token-blacklist.json`. Plus `data/nuggets/` (binary HRR memory) and `data/knowledge-base/` (markdown articles).

### LLM Providers (llm-provider.js)

Pluggable providers: **Claude** (OAuth via `claude` CLI), **Codex** (OAuth via `codex` CLI), **OpenRouter** (API key), **DeepSeek** (API key). Per-role model selection is supported — screener/manager/general can each use a different model.

### Web Dashboard (server.js, web/)

Express + WebSocket server on port 3737. Frontend is React/TypeScript in `web/src/`, built to `web/dist/`, served statically. Real-time position updates pushed over WebSocket.

### Concurrency Guards

Screener and manager loops use session locks (`session.js`) so they never overlap. PnL watcher runs independently and skips while agent cycles are active.

## Configuration

Config is resolved hierarchically: `.env` → `user-config.json` → code defaults. Run `npm run setup` to generate `user-config.json` interactively. Key settings:

- `DRY_RUN=true` — simulate all trades (default for `npm run dev`)
- `LLM_PROVIDER` — `claude` | `codex` | `openrouter` | `deepseek`
- `LLM_MODEL` — model name; overridable per role via `SCREENER_MODEL`, `MANAGER_MODEL`, `GENERAL_MODEL`
- `HELIUS_API_KEY` — recommended RPC provider
- `TELEGRAM_BOT_TOKEN` — optional Telegram control surface

## Key Files

| File | Purpose |
|------|---------|
| `index.js` | Entry point, cron scheduler, REPL, startup sequence |
| `agent.js` | ReAct loop, model fallbacks, three agent roles |
| `prompt.js` | Prompt templates and autoresearch section overrides |
| `config.js` | Config schema, env + user-config merging |
| `server.js` | Express + WebSocket, dashboard API |
| `state.js` | Position tracking, PnL snapshots |
| `lessons.js` | Lesson extraction, dedup, Darwinian evolution |
| `memory.js` | Nuggets integration, recall for screening/management |
| `autoresearch.js` | Prompt optimization, trial management |
| `signal-weights.js` | Adaptive signal weighting |
| `knowledge-base.js` | LLM-maintained markdown KB, caching |
| `pnl-watcher.js` | Independent 30s auto-close loop |
| `llm-provider.js` | Provider abstraction, CLI harness |
| `packages/nuggets/` | HRR memory system (TypeScript, pre-built) |
