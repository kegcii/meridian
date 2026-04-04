# Meridian

**Autonomous Meteora DLMM liquidity management agent for Solana.**

Meridian screens pools, deploys capital, manages positions, learns from every trade, and evolves its own strategy — all without human intervention. Two specialized LLM agents run on independent schedules: one hunts for yield, the other protects your capital.

---

## Architecture

```
                    +-----------------------+
                    |      LLM Engine       |
                    |  OpenRouter / Minimax  |
                    |  OpenAI / DeepSeek    |
                    +----------+------------+
                               |
                    +----------v------------+
                    |    ReAct Agent Loop    |
                    |  reason → tool → act   |
                    +----------+------------+
                               |
          +--------------------+--------------------+
          |                    |                    |
  +-------v-------+   +-------v-------+   +-------v-------+
  |   Screener    |   |   Manager     |   |   General     |
  |  (Hunter)     |   |  (Healer)     |   |   (Chat)      |
  |  every 15m    |   |  every 5m     |   |  on demand    |
  +-------+-------+   +-------+-------+   +-------+-------+
          |                    |                    |
  +-------v--------------------v--------------------v-------+
  |                      Tool Layer                         |
  |  positions | wallet | pools | deploy | close | swap     |
  |  study LPers | token info | holders | smart wallets     |
  |  pool memory | lessons | strategy library | config      |
  +-----+-----------+-----------+-----------+---------------+
        |           |           |           |
  +-----v---+ +----v----+ +----v----+ +----v----+
  | Meteora | | Helius  | | Jupiter | |LP Agent |
  |  SDK    | |  RPC    | | Swap/   | |  API    |
  |  DLMM   | | Solana  | | Price   | | Study   |
  +---------+ +---------+ +---------+ +---------+
```

### Agent Roles

| Agent | Schedule | Mission |
|-------|----------|---------|
| **Screener** | Every 7–30 min | Find high-yield pools, study top LPers, deploy capital |
| **Manager** | Every 3–10 min | Monitor positions, enforce exit rules, claim fees, close/hold |
| **General** | On demand | Answer questions, execute commands via chat |

Management interval auto-adjusts based on pool volatility: high volatility (>5) = 3 min, medium (2-5) = 5 min, low (<2) = 10 min.

Cycles never overlap — if management is running when screening fires, screening defers to the next tick.

---

## Features

### Autonomous LP Management
- **Screen** — scans Meteora pools against configurable thresholds (fee/TVL, organic score, holders, mcap, bin step, volume, volatility)
- **Deploy** — opens DLMM positions with dynamic sizing (scales with wallet balance)
- **Manage** — monitors PnL, fees, range status; decides STAY / CLOSE / REBALANCE
- **Close** — claims fees, removes liquidity, swaps dust tokens back to SOL
- **Learn** — derives lessons from every closed position, deduplicates similar rules
- **Evolve** — auto-adjusts screening thresholds based on win rate and PnL history

### Multi-Provider LLM Support
Each agent role can use a different LLM provider and model:

| Provider | Base URL | Config Key |
|----------|----------|------------|
| OpenRouter | `openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| Minimax | `api.minimax.io/v1` | `MINIMAX_API_KEY` |
| OpenAI | `api.openai.com/v1` | `OPENAI_API_KEY` |
| DeepSeek | `api.deepseek.com` | `DEEPSEEK_API_KEY` |

Per-role routing in `user-config.json`:
```json
{
  "screeningModel": "MiniMax-M2.7",
  "screeningProvider": "minimax",
  "managementModel": "openai/gpt-5.4-nano",
  "managementProvider": "openrouter"
}
```

Codex screening (optional) runs independently via OpenAI CLI using `OPENAI_API_KEY`.

### Strategy Intelligence
- **bid_ask** — single-sided SOL below active bin. Safe default for meme tokens.
- **spot** — uniform distribution. SOL-only, token-only, or two-sided with configurable conviction ratio.
- Strategy library — save, compare, and switch between named strategies
- On-chain strategy detection — reads bin liquidity distribution via RPC to identify strategy type

### Exit Rules
- **Stop Loss** — close if PnL drops below threshold (default: -20%)
- **Trailing Take Profit** — activates at configurable PnL %, closes if PnL drops from peak
- **Fixed Take Profit** — close when total fee PnL exceeds threshold
- **Out of Range** — configurable wait time before closing OOR positions
- **Emergency Price Drop** — immediate close on severe price crash

### Volatility Evolution
The agent auto-adjusts `maxVolatility` based on performance data:
- Only tightens when win rate in the loss cluster zone is genuinely bad (<50%)
- Respects `maxVolatilityFloor` — user-set minimum that the agent cannot go below
- Can loosen when overall WR ≥ 60% and winners exist near/above the ceiling
- Prevents the one-directional tightening spiral that cuts off profitable zones

### Memory Systems

**Nuggets (Holographic Memory)**
Cross-session learning via HRR-based vector memory. Facts are key-value pairs superposed into fixed-size complex vectors — multiple facts coexist in one mathematical object but remain individually retrievable in ~1ms.

- `remember` — bind a fact into the holographic vector
- `recall` — unbind and decode via cosine similarity
- `forget` — subtract a binding from the superposition
- `promote` — facts recalled 3+ times get written to permanent context

Five recall channels per management cycle: pool name, strategy+bin_step, strategy alone, volatility bucket, and general lessons. More recall paths = faster promotion of useful facts.

**Lessons (Performance-Derived Rules)**
Every closed position generates a structured lesson with tags and outcome classification. Lessons are deduplicated on creation (tag+outcome matching and normalized key matching). Injected into agent prompts via a 3-tier system:
1. **Pinned** (up to 10) — critical rules, always present
2. **Role-matched** (up to 15) — tagged for the current agent role
3. **Recent fill** (remaining) — newest lessons up to 35 total

**Pool Memory**
Per-pool deploy history with PnL, strategy, and notes. The agent checks pool memory before deploying — if a pool has a bad track record, it skips.

### Darwinian Signal Weights
Screening signals (organic score, fee/TVL, holders, etc.) are weighted based on actual predictive power. After enough closed positions, the system recalculates which signals correlate with wins vs losses and adjusts their influence on deployment decisions.

### Autoresearch
Automated prompt optimization. The system:
1. Identifies which prompt sections correlate with losses
2. Uses an LLM to propose a small, targeted modification
3. Runs the modification as a trial for N closes
4. Keeps the change if it improves win rate, reverts if it doesn't

### Position Auto-Adoption
Manually opened positions are automatically detected and adopted by the management cycle. The agent discovers untracked positions via on-chain scan, infers strategy from bin liquidity distribution, fetches pool metadata, and creates tracked entries with full management.

### LP Agent Integration
Real performance data from LP Agent API replaces local tracking for display:
- **Overview** — lifetime PnL, fees, win rate, ROI, avg hold time
- **Historical** — per-position final PnL for externally closed positions
- **Revenue** — daily/weekly PnL breakdown
- **Study** — top LPer analysis per pool (multi-key rotation for rate limits)

### Smart Wallet Tracking
Track proven LPers and KOLs. Before deploying, the agent checks if tracked wallets have active positions in the pool. Wallet types: `lp` (checked for LP positions) and `holder` (checked for token holdings only).

---

## Web Dashboard

Real-time monitoring at `http://localhost:3737` with WebSocket updates. Responsive layout for both desktop and mobile.

### Desktop Layout
- **Chat Panel** (left, 55%) — message agent, queue messages while busy
- **Data Sidebar** (right, 45%) — tabbed: Dashboard, Candidates, Intel, Activity

### Mobile Layout
- Chat hidden by default with toggle button
- Data Sidebar takes full viewport
- Compact StatusBar, touch-friendly tabs

### Dashboard Tab
- **Portfolio Pulse** — total SOL (wallet + in positions), PnL with timeframe selector (1D/7D/30D/ALL), SOL/USD toggle, daily PnL calendar with date navigation
- **Strategy Breakdown** — side-by-side BID_ASK vs SPOT comparison table (trades, win rate, PnL, avg hold, range efficiency, losses)
- **Quick Actions** — top pools, recent closes, lessons, memory, Darwin weights, autoresearch, settings, performance, briefing, blacklists
- **Position Cards** — per-position with value, PnL, fees, age, strategy, bin step, fee %, volatility, fee/TVL, bin range visualization with total bins count

### Intel Tab
- **Lessons** — recent reusable rules with tags and status
- **Memory** — prompt-injected nuggets (pools, patterns, strategies)
- **Darwin Weights** — learned signal ranking with visual bars
- **Autoresearch** — experiment summary table (#, status, section, hypothesis, baseline → trial), key patterns with derived insights, recent experiments

### Candidates Tab
- Ranked pool table with fee/TVL, volume, organic score, active bin %

### Activity Tab
- Real-time notification feed: deploys, closes, OOR alerts, cycle reports
- **Persisted to disk** — survives refresh/restart (last 200 events)

### Command Palette (Ctrl+K)
Quick access to all commands + natural language suggestions.

---

## Setup

### Requirements
- Node.js 18+
- Solana wallet (base58 private key)
- At least one LLM provider API key (OpenRouter, Minimax, OpenAI, or DeepSeek)
- [Helius](https://helius.dev) RPC URL (recommended)
- LP Agent API key (optional, for study/overview)
- Telegram bot token (optional, for notifications)

### Install

```bash
git clone https://github.com/kegcii/meridian.git
cd meridian
bash install.sh
```

The install script clones [Nuggets](https://github.com/NeoVertex1/nuggets) (holographic memory) into the parent directory, builds it, then installs meridian and the web UI.

> **Manual install:** Clone nuggets alongside meridian (`git clone https://github.com/NeoVertex1/nuggets.git ../nuggets`), run `cd ../nuggets && npm install && npm run build`, then `cd ../meridian && npm install && cd web && npm install && npm run build`.

### Configure

1. Copy example files:
```bash
cp .env.example .env
cp user-config.example.json user-config.json
```

2. Edit `.env` with your API keys and wallet.

3. Edit `user-config.json` with your preferences (all fields optional, defaults in `config.js`).

Or run the interactive wizard:
```bash
node setup.js
```

### Run

```bash
npm run dev     # dry run — simulates all transactions
npm start       # live mode — real on-chain execution
```

On startup: fetches wallet balance, scans open positions, loads lessons, deduplicates stale rules, initializes nuggets memory, starts cron schedules, opens web dashboard.

---

## Configuration Reference

### Environment Variables (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `WALLET_PRIVATE_KEY` | Yes | Solana wallet base58 private key |
| `RPC_URL` | Yes | Solana RPC endpoint (Helius recommended) |
| `HELIUS_API_KEY` | Yes | Helius API key for wallet balance API |
| `OPENROUTER_API_KEY` | If using OpenRouter | OpenRouter LLM API key |
| `MINIMAX_API_KEY` | If using Minimax | Minimax platform API key |
| `OPENAI_API_KEY` | If using OpenAI/Codex | OpenAI API key |
| `DEEPSEEK_API_KEY` | If using DeepSeek | DeepSeek API key |
| `LLM_PROVIDER` | No | Default provider: `openrouter`, `minimax`, `openai`, `deepseek` |
| `LPAGENT_API_KEY` | No | LP Agent keys (comma-separated for rotation) |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token for notifications |
| `DRY_RUN` | No | `true` to simulate without on-chain execution |

### User Config (`user-config.json`)

#### Screening

| Field | Default | Description |
|-------|---------|-------------|
| `minFeeActiveTvlRatio` | `0.05` | Minimum fee/active-TVL ratio |
| `minTvl` / `maxTvl` | `10000` / `150000` | TVL range (USD) |
| `minOrganic` | `60` | Minimum organic score (0–100) |
| `minHolders` | `500` | Minimum token holder count |
| `minMcap` / `maxMcap` | `150000` / `10000000` | Market cap range (USD) |
| `minVolume` | `500` | Minimum 24h volume (USD) |
| `minBinStep` / `maxBinStep` | `80` / `125` | Bin step range |
| `maxVolatility` | `8` | Maximum pool volatility (auto-evolved) |
| `maxVolatilityFloor` | `3` | Floor — agent cannot tighten below this |
| `maxPriceChangePct` | `300` | Max price change % to consider |
| `timeframe` | `5m` | Screening candle timeframe |
| `categories` | `["trending"]` | Pool category filter (`new`, `trending`) |
| `minTokenFeesSol` | `30` | Minimum global fees in SOL (anti-scam) |
| `athTopThresholdPct` | `90` | ATH proximity warning threshold |

#### Deployment

| Field | Default | Description |
|-------|---------|-------------|
| `deployAmountSol` | `0.5` | Base SOL per position (dynamic with compounding) |
| `maxPositions` | `3` | Maximum concurrent positions |
| `maxDeployAmount` | `50` | Maximum SOL per single deploy |
| `positionSizePct` | `0.35` | Position size as % of deployable balance |
| `gasReserve` | `0.2` | SOL reserved for gas fees |
| `minSolToOpen` | `0.55` | Minimum wallet SOL to allow new deploys |
| `strategy` | `bid_ask` | Default strategy (`bid_ask` or `spot`) |
| `binsBelow` | `69` | Default bins below active bin |

#### Position Management

| Field | Default | Description |
|-------|---------|-------------|
| `stopLossPct` | `-20` | Close if PnL drops below this % |
| `takeProfitFeePct` | `5` | Close when fee PnL exceeds this % |
| `trailingTakeProfit` | `true` | Enable trailing take profit |
| `trailingTriggerPct` | `3` | Trailing TP activates at this PnL % |
| `trailingDropPct` | `1.5` | Close when PnL drops this % from peak |
| `outOfRangeWaitMinutes` | `30` | Minutes OOR before acting |
| `outOfRangeBinsToClose` | `5` | OOR bin distance to trigger close |
| `emergencyPriceDropPct` | `-50` | Emergency close on severe price crash |
| `minClaimAmount` | `5` | Minimum USD to claim fees |
| `minVolumeToRebalance` | `1000` | Minimum volume for rebalance |
| `priorityFeeLevel` | `Medium` | Transaction priority (`Low`, `Medium`, `High`) |
| `pnlUnit` | `sol` | Display PnL in `sol` or `usd` |

#### LLM Configuration

| Field | Default | Description |
|-------|---------|-------------|
| `screeningModel` | `openai/gpt-5.4-nano` | Model for pool screening |
| `managementModel` | `openai/gpt-5.4-nano` | Model for position management |
| `generalModel` | `openai/gpt-5.4-nano` | Model for chat / commands |
| `screeningProvider` | `null` | Provider override for screening |
| `managementProvider` | `null` | Provider override for management |
| `generalProvider` | `null` | Provider override for general |
| `screeningFallbackModel` | `null` | Fallback model for screening |
| `managementFallbackModel` | `null` | Fallback model for management |
| `generalFallbackModel` | `null` | Fallback model for general |
| `codexScreening` | `false` | Use OpenAI Codex CLI for screening |
| `codexModel` | `gpt-5.4` | Codex CLI model |
| `autoresearchModel` | `openai/gpt-5.4-nano` | Model for autoresearch experiments |
| `temperature` | `0.373` | LLM temperature |
| `maxTokens` | `4096` | Max output tokens per call |
| `maxSteps` | `20` | Max agent loop steps per cycle |

#### Scheduling

| Field | Default | Description |
|-------|---------|-------------|
| `managementIntervalMin` | `10` | Management cycle interval (auto-adjusted) |
| `screeningIntervalMin` | `30` | Screening cycle interval |
| `healthCheckIntervalMin` | `60` | Health check interval |
| `pnlWatcherIntervalSec` | `30` | PnL watcher poll interval |

#### Darwinian Signal Weights

| Field | Default | Description |
|-------|---------|-------------|
| `darwinianWeights` | `false` | Enable signal weight evolution |
| `darwinianMinSamples` | `10` | Minimum positions before recalc |
| `darwinianWindowDays` | `60` | Lookback window for weight calc |
| `darwinianBoostFactor` | `1.05` | Winner signal boost multiplier |
| `darwinianDecayFactor` | `0.95` | Loser signal decay multiplier |
| `darwinianWeightFloor` | `0.3` | Minimum signal weight |
| `darwinianWeightCeiling` | `2.5` | Maximum signal weight |

#### Autoresearch

| Field | Default | Description |
|-------|---------|-------------|
| `autoresearch` | `false` | Enable automated prompt experiments |
| `autoresearchMinCloses` | `7` | Positions per trial before evaluation |
| `autoresearchImprovementPct` | `15` | WR improvement % to keep a change |
| `autoresearchDeclinePct` | `15` | WR decline % to revert a change |
| `autoresearchCooldownCloses` | `5` | Cooldown positions between experiments |

---

## Commands

### REPL (Terminal)

```
[manage: 8m 12s | screen: 24m 3s]
>
```

| Command | Action |
|---------|--------|
| `1`, `2`, `3` ... | Deploy into numbered candidate pool |
| `auto` | Agent picks best pool and deploys |
| `/status` | Wallet balance + open positions |
| `/candidates` | Current top pool candidates |
| `/briefing` | 24h performance briefing |
| `/thresholds` | Screening thresholds + performance stats |
| `/learn` | Study top LPers across all candidates |
| `/evolve` | Evolve thresholds from performance data |
| `/stop` | Graceful shutdown |
| `<wallet_address>` | Look up any wallet's DLMM positions |
| `<anything>` | Free-form chat with session history |

### Web UI (Ctrl+K Command Palette)

Same commands plus natural language: "Show my positions", "What pools look good?", "Close all positions", "Deploy 0.5 SOL into Gerald".

### Telegram

Send any message to your bot to auto-register. Same command interface as REPL. Receives automatic notifications for deploys, closes, OOR alerts, and cycle reports.

---

## How It Learns

### Per-Position Lessons
Every closed position generates a tagged lesson:
```
[FAILED] FAILED: Downald-SOL, strategy=bid_ask, bin_step=125,
volatility=15.59 → PnL -5%, range efficiency 40%. Reason: agent decision.
```

Lessons are deduplicated — same tags+outcome or same normalized rule text updates the existing entry instead of creating duplicates.

### Threshold Evolution
After 5+ closed positions, `/evolve` analyzes win/loss patterns and adjusts screening thresholds by up to 20% per step. Volatility evolution checks zone win rate before tightening and respects the configurable floor. Changes persist to `user-config.json` immediately.

### Nuggets Memory
Cross-session holographic memory stores pool outcomes, strategy effectiveness, volatility patterns, and management insights. Facts recalled frequently get promoted to permanent context. Memory persists across restarts at `data/nuggets/`.

### Daily Briefing
At 1 AM UTC, a briefing is generated with 24h activity, performance data, top lessons, and current portfolio state.

---

## Data Sources

| Source | Used For |
|--------|----------|
| **Meteora DLMM SDK** | On-chain positions, deploy/close, bin data, active bin |
| **Meteora PnL API** | Position yield, fee accrual, real-time PnL |
| **Meteora Pool Discovery API** | Pool screening, fee/TVL, volume, organic scores |
| **Helius RPC** | Wallet balances, token accounts, position scanning |
| **Jupiter** | Token swaps, price feeds, token info |
| **LP Agent API** | Top LPer analysis, historical PnL, revenue overview |
| **OKX DEX API** | Market health data, price signals for management prompts |

---

## Project Structure

```
meridian/
  index.js              Entry point — cron schedules, REPL, startup
  agent.js              ReAct agent loop + multi-provider routing
  prompt.js             Role-based system prompt builder
  config.js             Config loading with user-config overlay
  state.js              Position tracking, sync, exit rule checks
  lessons.js            Learning system, dedup, threshold evolution
  memory.js             Nuggets holographic memory integration
  autoresearch.js       Automated prompt experiments
  signal-weights.js     Darwinian signal weight evolution
  briefing.js           Daily performance briefing
  server.js             Express + WebSocket server
  telegram.js           Telegram bot integration
  notifier.js           Internal event pub/sub
  session.js            Session state (history, busy flags)
  setup.js              Interactive setup wizard
  runtime-helpers.js    Threshold summary, candidate normalization
  pool-memory.js        Per-pool deploy history
  smart-wallets.js      Smart wallet tracking
  pnl-watcher.js        Real-time PnL monitoring
  tools/
    definitions.js      All 30+ agent tool definitions
    executor.js         Tool dispatch + dry-run handling
    dlmm.js             Meteora SDK: positions, deploy, close, PnL
    screening.js        Pool discovery + scoring
    wallet.js           Wallet balances + Jupiter swaps
    study.js            LP Agent: top LPer analysis
    token.js            Jupiter: token info, holders, narratives
    lp-overview.js      LP Agent: performance overview + history
    okx.js              OKX DEX market data
    knowledge-graph.js  Knowledge graph builder for Mind Map
  web/
    src/
      App.tsx                   Main layout (mobile chat toggle)
      hooks/useWebSocket.ts     Real-time data hook
      components/
        StatusBar.tsx           Connection + timers + wallet (responsive)
        ChatPanel.tsx           Agent chat interface
        DataSidebar.tsx         Tabbed sidebar container
        DashboardTab.tsx        Portfolio pulse + strategy breakdown
        CandidatesTab.tsx       Pool ranking table
        IntelTab.tsx            Lessons, memory, Darwin, autoresearch
        ActivityTab.tsx         Notification feed (persisted)
        PositionCard.tsx        Per-position metrics card
        BinRangeChart.tsx       Bin liquidity visualization
        QuickActions.tsx        Quick action buttons + dialogs
        KnowledgeGraph.tsx      Mind Map visualization
        CommandPalette.tsx      Ctrl+K command search
        ui/                     shadcn components
```

---

## Hive Mind (optional)

Opt-in collective intelligence system. When enabled, your agent anonymously shares what it learns with other meridian agents and receives crowd-sourced wisdom in return.

**What you get:** pool consensus, strategy rankings, pattern consensus, threshold medians.

**What you share:** lessons, deploy outcomes, screening thresholds. **NO wallet addresses, private keys, or SOL balances are ever sent.**

### Setup

1. Get the registration token from the private Telegram discussion.
2. Register:
```bash
node -e "import('./hive-mind.js').then(m => m.register('https://meridian-hive-api-production.up.railway.app', 'YOUR_TOKEN'))"
```
3. Save the API key printed in the terminal — it will not be shown again.

### Disable

Clear both fields in `user-config.json`:
```json
{
  "hiveMindUrl": "",
  "hiveMindApiKey": ""
}
```

---

## Disclaimer

This software is provided as-is, with no warranty. Running an autonomous trading agent carries real financial risk — you can lose funds. Always start with `DRY_RUN=true` to verify behavior before going live. Never deploy more capital than you can afford to lose. This is not financial advice.
