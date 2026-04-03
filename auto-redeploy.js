/**
 * auto-redeploy.js — Automatically re-deploy after OOR upside close.
 *
 * When a position is closed due to OOR upside, the pool might still be
 * active and profitable. This module checks if re-deploy is worth it
 * and re-enters at the new active bin with a fresh range.
 *
 * Guards:
 *   - Max 3 re-deploys per pool per session (prevent infinite chase)
 *   - Pool must still have fee_tvl_ratio >= 0.2 (pool still productive)
 *   - Wallet must have enough SOL (respects gas reserve)
 *   - Minimum 2 minutes between re-deploys to same pool (prevent spam)
 */

import { log } from "./logger.js";
import { config, computeDeployAmount } from "./config.js";
import { getWalletBalances } from "./tools/wallet.js";
import { getPoolDetail } from "./tools/screening.js";
import { deployPosition } from "./tools/dlmm.js";
import { emit } from "./notifier.js";

// Track re-deploy counts per pool per session
const _redeployCount = new Map();  // pool_address -> count
const _lastRedeploy = new Map();   // pool_address -> timestamp

const MAX_REDEPLOYS = 3;
const MIN_REDEPLOY_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const MIN_FEE_TVL_RATIO = 0.2;

/**
 * Attempt to re-deploy after an OOR upside close.
 *
 * @param {object} closedPosition - The position data that was just closed
 *   Must have: pool, pool_name, base_mint, strategy, bin_step, amount_sol
 * @returns {object} { redeployed: boolean, reason: string, position?: string }
 */
export async function tryRedeploy(closedPosition) {
  const {
    pool,
    pool_name,
    base_mint,
    strategy,
    bin_step,
    amount_sol,
    oor_direction,
    sol_split_pct,
  } = closedPosition;

  // Only re-deploy on OOR upside
  if (oor_direction !== "upside") {
    return { redeployed: false, reason: "Not OOR upside — skip re-deploy" };
  }

  // Check re-deploy count
  const count = _redeployCount.get(pool) || 0;
  if (count >= MAX_REDEPLOYS) {
    log("redeploy", `${pool_name}: max ${MAX_REDEPLOYS} re-deploys reached — stopping chase`);
    return { redeployed: false, reason: `Max ${MAX_REDEPLOYS} re-deploys reached for this pool` };
  }

  // Check minimum interval
  const lastTime = _lastRedeploy.get(pool) || 0;
  if (Date.now() - lastTime < MIN_REDEPLOY_INTERVAL_MS) {
    return { redeployed: false, reason: "Too soon since last re-deploy" };
  }

  // Check pool health
  let poolData;
  try {
    poolData = await getPoolDetail({ pool_address: pool, timeframe: config.screening.timeframe });
  } catch (err) {
    log("redeploy", `${pool_name}: failed to fetch pool data — ${err.message}`);
    return { redeployed: false, reason: "Could not fetch pool data" };
  }

  const feeTvl = poolData?.fee_active_tvl_ratio ?? poolData?.fee_tvl_ratio ?? 0;
  if (feeTvl < MIN_FEE_TVL_RATIO) {
    log("redeploy", `${pool_name}: fee_tvl ${feeTvl} < ${MIN_FEE_TVL_RATIO} — pool cooling down, skip`);
    return { redeployed: false, reason: `fee_tvl ${feeTvl} below threshold ${MIN_FEE_TVL_RATIO}` };
  }

  // Check wallet balance
  let wallet;
  try {
    wallet = await getWalletBalances();
  } catch (err) {
    return { redeployed: false, reason: "Could not fetch wallet balance" };
  }

  const deployAmount = computeDeployAmount(wallet.sol);
  if (deployAmount <= 0) {
    log("redeploy", `${pool_name}: insufficient SOL for re-deploy`);
    return { redeployed: false, reason: "Insufficient SOL" };
  }

  // Determine strategy — keep same as original, or use original amount
  const redeployAmount = Math.min(deployAmount, amount_sol || deployAmount);

  // Determine range from volatility
  const vol = poolData?.volatility ?? 3;
  let priceRangePct;
  if (vol >= 8) priceRangePct = 42;
  else if (vol >= 5) priceRangePct = 35;
  else if (vol >= 2) priceRangePct = 30;
  else priceRangePct = 25;

  log("redeploy", `${pool_name}: RE-DEPLOY #${count + 1} — fee_tvl=${feeTvl.toFixed(3)}, vol=${vol}, range=${priceRangePct}%, amount=${redeployAmount} SOL, strategy=${strategy}`);

  // Deploy
  try {
    const result = await deployPosition({
      pool_address: pool,
      pool_name,
      base_mint,
      amount_sol: redeployAmount,
      strategy: strategy || "bid_ask",
      price_range_pct: priceRangePct,
      sol_split_pct: sol_split_pct ?? 100,
      bin_step,
      volatility: vol,
      fee_tvl_ratio: feeTvl,
      organic_score: poolData?.organic_score,
    });

    if (result.error || result.blocked) {
      log("redeploy", `${pool_name}: re-deploy failed — ${result.error || result.reason}`);
      return { redeployed: false, reason: result.error || result.reason };
    }

    // Track
    _redeployCount.set(pool, count + 1);
    _lastRedeploy.set(pool, Date.now());

    const msg = `RE-DEPLOY #${count + 1}: ${pool_name} — ${redeployAmount} SOL, ${strategy}, range ${priceRangePct}%, fee_tvl=${feeTvl.toFixed(3)}`;
    log("redeploy", msg);
    emit("redeploy", { pair: pool_name, attempt: count + 1, amount: redeployAmount, fee_tvl: feeTvl });

    return { redeployed: true, reason: msg, position: result.position };
  } catch (err) {
    log("redeploy_error", `${pool_name}: re-deploy error — ${err.message}`);
    return { redeployed: false, reason: err.message };
  }
}

/**
 * Reset re-deploy counts. Call on bot restart or daily reset.
 */
export function resetRedeployCounts() {
  _redeployCount.clear();
  _lastRedeploy.clear();
  log("redeploy", "Re-deploy counters reset");
}
