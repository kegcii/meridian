/**
 * pnl-watcher.js - Lightweight PnL watcher for the Meridian DLMM agent.
 *
 * Runs on a fast interval (default 30s), checks all open positions against
 * stop-loss / trailing TP / fixed TP thresholds, and auto-closes without any
 * LLM call.
 */

import { log } from "./logger.js";
import { config } from "./config.js";
import { updatePnlAndCheckExits, getTrackedPosition, getTrackedPositions, minutesOutOfRange } from "./state.js";
import { getMyPositions, closePosition } from "./tools/dlmm.js";
import { emit } from "./notifier.js";
import { isBusy, isManagementBusy, isScreeningBusy } from "./session.js";
import fs from "fs";

const STATE_FILE = "./state.json";

let _intervalHandle = null;
// Positions successfully closed this session — skip until gone from on-chain
const _closingPositions = new Set();
// Track close retry attempts per position for escalation
const _closeRetries = new Map(); // position_address -> { count, lastAttempt }

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { positions: {}, recentEvents: [], lastUpdated: null };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { positions: {}, lastUpdated: null };
  }
}

function saveState(state) {
  try {
    state.lastUpdated = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    log("pnl_watcher_error", `Failed to write state.json: ${err.message}`);
  }
}

export async function runPnlWatcher() {
  try {
    // Skip while other agent flows are already active.
    if (isBusy() || isManagementBusy() || isScreeningBusy()) return;

    const cached = await getMyPositions();
    if (!cached?.positions?.length) return;

    const result = await getMyPositions({ force: true });
    const positions = result?.positions || [];
    if (positions.length === 0) return;

    // Clean up positions that have fully disappeared from on-chain
    for (const addr of _closingPositions) {
      if (!positions.find(p => p.position === addr)) _closingPositions.delete(addr);
    }

    for (const p of positions) {
      if (p.pnl_pct == null) continue;
      if (_closingPositions.has(p.position)) continue;

      const tracked = getTrackedPosition(p.position);
      if (tracked?.deployed_at) {
        const ageMs = Date.now() - new Date(tracked.deployed_at).getTime();
        if (ageMs < 120_000) continue;
      }

      try {
        const exitAction = updatePnlAndCheckExits(p.position, p.pnl_pct, config);
        const fixedTpHit =
          !exitAction &&
          config.management.takeProfitFeePct &&
          p.pnl_pct >= config.management.takeProfitFeePct;

        // OOR auto-close: deterministic, no LLM needed
        const oorTimeout = config.management.outOfRangeWaitMinutes;
        const oorMinutes = minutesOutOfRange(p.position);
        const oorHit = !exitAction && !fixedTpHit && oorTimeout && oorMinutes >= oorTimeout && !p.in_range;

        const reason = exitAction || (fixedTpHit
          ? `FIXED_TP: PnL ${p.pnl_pct.toFixed(1)}% >= take profit (${config.management.takeProfitFeePct}%)`
          : oorHit
            ? `OOR_TIMEOUT: Out of range ${oorMinutes}min >= ${oorTimeout}min (${tracked?.oor_direction || "unknown"} direction, PnL ${p.pnl_pct?.toFixed(1)}%)`
            : null);

        if (!reason) continue;

        // Track retry state for this position
        const retryState = _closeRetries.get(p.position) || { count: 0, lastAttempt: 0 };

        // Back off slightly between retries: wait at least (count * 10s) between attempts
        const backoffMs = Math.min(retryState.count * 10_000, 120_000);
        if (Date.now() - retryState.lastAttempt < backoffMs) continue;

        const retryLabel = retryState.count > 0 ? ` [retry ${retryState.count}]` : "";
        log("pnl_watcher", `EXIT TRIGGERED for ${p.pair || p.position.slice(0, 8)}: ${reason}${retryLabel}`);

        const closeResult = await closePosition({
          position_address: p.position,
          _pnlOverride: {
            pnl_usd: p.pnl_usd,
            pnl_pct: p.pnl_pct,
            total_value_usd: p.total_value_usd,
            collected_fees_usd: p.collected_fees_usd,
            unclaimed_fees_usd: p.unclaimed_fees_usd,
          },
        });

        if (!closeResult?.success && !closeResult?.dry_run) {
          retryState.count++;
          retryState.lastAttempt = Date.now();
          _closeRetries.set(p.position, retryState);
          log("pnl_watcher_error", `Failed to close ${p.position.slice(0, 8)} (attempt ${retryState.count}): ${closeResult?.error || "unknown error"}`);
          continue;
        }

        // Close succeeded — clean up retry tracking
        _closeRetries.delete(p.position);

        _closingPositions.add(p.position);
        const truePnl = closeResult?.true_pnl_sol != null ? ` | true: ${closeResult.true_pnl_sol >= 0 ? "+" : ""}${closeResult.true_pnl_sol} SOL` : "";
        log("pnl_watcher", `Closed ${p.pair || p.position.slice(0, 8)} | PnL: ${p.pnl_pct}% ($${p.pnl_usd})${truePnl}`);

        try {
          const state = loadState();
          state.recentAutoCloses = state.recentAutoCloses || [];
          state.recentAutoCloses.push({
            position: p.position,
            pair: p.pair,
            reason,
            pnl_pct: p.pnl_pct,
            true_pnl_sol: closeResult?.true_pnl_sol ?? null,
            ts: new Date().toISOString(),
          });
          state.recentAutoCloses = state.recentAutoCloses.slice(-20);
          saveState(state);
        } catch (stateErr) {
          log("pnl_watcher_error", `Failed to record auto-close in state: ${stateErr.message}`);
        }

        emit("pnl_watcher_close", {
          pair: p.pair,
          pnlPct: p.pnl_pct,
          pnlSol: p.pnl_sol,
          pnlUsd: p.pnl_usd,
          truePnlSol: closeResult?.true_pnl_sol ?? null,
          solInvested: closeResult?.sol_invested ?? null,
          solRecovered: closeResult?.sol_recovered ?? null,
          autoClose: true,
          reason,
        });
      } catch (posErr) {
        log("pnl_watcher_error", `Error processing position ${p.position.slice(0, 8)}: ${posErr.message}`);
      }
    }
  } catch (err) {
    log("pnl_watcher_error", `Tick failed: ${err.message}`);
  }

  // Run wallet sweep after position checks (non-blocking on errors above)
  try {
    if (!isBusy() && !isManagementBusy() && !isScreeningBusy()) {
      await sweepLeftoverTokens();
    }
  } catch (err) {
    log("pnl_watcher_error", `Sweep tick failed: ${err.message}`);
  }
}

// ─── Wallet sweep: catch leftover base tokens from closed positions ───
let _lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

async function sweepLeftoverTokens() {
  if (Date.now() - _lastSweepAt < SWEEP_INTERVAL_MS) return;
  _lastSweepAt = Date.now();

  try {
    const { getWalletBalances, swapToken } = await import("./tools/wallet.js");
    const walletBals = await getWalletBalances();
    if (!walletBals?.tokens?.length) return;

    // Collect base mints from all closed positions
    const closedPositions = getTrackedPositions(false).filter(p => p.closed);
    const closedMints = new Set();
    for (const p of closedPositions) {
      if (p.base_mint) closedMints.add(p.base_mint);
    }

    // Also collect base mints from open positions (don't sweep those)
    const openPositions = getTrackedPositions(true);
    const openMints = new Set();
    for (const p of openPositions) {
      if (p.base_mint) openMints.add(p.base_mint);
    }

    const SOL = "So11111111111111111111111111111111111111112";
    for (const token of walletBals.tokens) {
      if (token.mint === SOL || token.mint === config.tokens?.USDC) continue;
      if (token.balance <= 0 || (token.usd ?? 0) < 0.10) continue;
      // Only sweep tokens from closed positions, not tokens we're actively using
      if (!closedMints.has(token.mint) || openMints.has(token.mint)) continue;

      log("pnl_watcher", `Sweep: found leftover ${token.balance} ${token.symbol || token.mint.slice(0, 8)} worth $${token.usd} — swapping to SOL`);
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const swapResult = await swapToken({
            input_mint: token.mint,
            output_mint: SOL,
            amount: token.balance,
          });
          if (swapResult?.success || swapResult?.dry_run) {
            log("pnl_watcher", `Sweep OK: ${token.symbol || token.mint.slice(0, 8)} -> SOL tx ${swapResult.tx || "dry-run"}`);
            break;
          }
          log("pnl_watcher_error", `Sweep swap failed: ${swapResult?.error || "unknown"} [attempt ${attempt}/3]`);
        } catch (err) {
          log("pnl_watcher_error", `Sweep swap error: ${err.message} [attempt ${attempt}/3]`);
        }
        if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }
  } catch (err) {
    log("pnl_watcher_error", `Sweep failed: ${err.message}`);
  }
}

const HIGH_VOL_THRESHOLD = 5;
const FAST_INTERVAL_SEC = 15;
let _currentIntervalSec = null;
let _baseIntervalSec = 30;

/**
 * If any open position has volatility ≥5, tick every 15s instead of 30s.
 * High-vol tokens can move 10%+ between normal ticks, outrunning stop-loss.
 */
function chooseInterval() {
  try {
    const open = getTrackedPositions(true);
    const hasHighVol = open.some((p) => (p.volatility ?? 0) >= HIGH_VOL_THRESHOLD);
    return hasHighVol ? FAST_INTERVAL_SEC : _baseIntervalSec;
  } catch {
    return _baseIntervalSec;
  }
}

function scheduleNextTick() {
  const target = chooseInterval();
  if (target !== _currentIntervalSec) {
    if (_intervalHandle) clearInterval(_intervalHandle);
    _currentIntervalSec = target;
    log("pnl_watcher", `Interval → ${target}s (${target === FAST_INTERVAL_SEC ? "high-vol mode" : "normal"})`);
    _intervalHandle = setInterval(async () => {
      await runPnlWatcher();
      // Re-evaluate after each tick — positions may have opened/closed
      scheduleNextTick();
    }, target * 1000);
  }
}

export function startPnlWatcher(intervalSec = 30) {
  if (_intervalHandle) {
    log("pnl_watcher", "Already running - stopping previous instance");
    clearInterval(_intervalHandle);
    _intervalHandle = null;
    _currentIntervalSec = null;
  }

  _baseIntervalSec = intervalSec;
  log("pnl_watcher", `Starting PnL watcher (base ${intervalSec}s, fast ${FAST_INTERVAL_SEC}s for vol≥${HIGH_VOL_THRESHOLD})`);

  runPnlWatcher();
  scheduleNextTick();
}

export function stopPnlWatcher() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
    log("pnl_watcher", "Stopped");
  }
}
