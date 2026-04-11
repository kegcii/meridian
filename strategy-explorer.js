/**
 * Strategy Explorer — systematic exploration of LP strategies via Thompson sampling.
 *
 * Addresses the monoculture problem: without variance the agent can't learn
 * which strategy is best. This module reads closed-position performance from
 * lessons.json and recommends the next strategy to try.
 *
 * Approach:
 *  - Group closes into (strategy, sol_split_pct) buckets
 *  - For each bucket, fit a Beta(wins+1, losses+1) posterior on win probability
 *  - Thompson sampling: draw one sample from each bucket's posterior, pick max
 *  - Untested strategies get Beta(1,1) = uniform prior, so they're sampled
 *    as if they might be great — exactly the exploration signal we want
 *
 * This yields an exploration-exploitation balance without hand-tuned epsilon.
 */

import fs from "fs";
import { log } from "./logger.js";

const LESSONS_FILE = "./lessons.json";
const WINDOW_DAYS = 90;

// Candidate arms the explorer can recommend. Keep the set intentionally small:
// these are discrete, interpretable buckets the screener can act on directly.
const ARMS = [
  { name: "bid_ask",  strategy: "bid_ask", sol_split_pct: null },
  { name: "spot_100", strategy: "spot",    sol_split_pct: 100 },
  { name: "spot_90",  strategy: "spot",    sol_split_pct: 90 },
  { name: "spot_80",  strategy: "spot",    sol_split_pct: 80 },
  { name: "spot_50",  strategy: "spot",    sol_split_pct: 50 },
];

function loadPerformance() {
  if (!fs.existsSync(LESSONS_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
    return raw.performance || [];
  } catch {
    return [];
  }
}

function bucketKeyFor(perf) {
  const base = perf.strategy || "unknown";
  if (base !== "spot") return base;
  const split = perf.sol_split_pct;
  if (split == null) return "spot_100";
  return `spot_${split}`;
}

/**
 * Aggregate per-arm stats over the rolling window.
 */
export function getArmStats({ windowDays = WINDOW_DAYS } = {}) {
  const perf = loadPerformance();
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const recent = perf.filter((p) => {
    const ts = new Date(p.recorded_at || p.closed_at || p.deployed_at || 0).getTime();
    return ts >= cutoff;
  });

  const stats = {};
  for (const arm of ARMS) {
    stats[arm.name] = { ...arm, n: 0, wins: 0, losses: 0, sumPnl: 0 };
  }

  for (const p of recent) {
    const key = bucketKeyFor(p);
    if (!stats[key]) continue; // ignore unknown arms
    stats[key].n++;
    const pnl = p.pnl_usd ?? p.actual_pnl_usd ?? 0;
    if (pnl > 0) stats[key].wins++;
    else stats[key].losses++;
    stats[key].sumPnl += p.pnl_pct ?? p.actual_pnl_pct ?? 0;
  }

  // Compute derived fields
  for (const s of Object.values(stats)) {
    s.win_rate = s.n > 0 ? s.wins / s.n : null;
    s.avg_pnl_pct = s.n > 0 ? s.sumPnl / s.n : null;
  }
  return stats;
}

/**
 * Sample from Beta(α, β) using two uniform random draws (Cheng 1978 approximation
 * via normal trick would be more precise, but for α,β roughly O(1-100) this
 * rejection-sampling with gamma-via-uniform-pairs is fine).
 *
 * Uses marsaglia-tsang gamma sampling for each side, then X/(X+Y).
 */
function sampleGamma(shape) {
  // Marsaglia-Tsang method, valid for shape ≥ 1.
  if (shape < 1) {
    // Boost: sample with shape+1, then scale by U^(1/shape).
    const g = sampleGamma(shape + 1);
    return g * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do {
      const u1 = Math.random();
      const u2 = Math.random();
      // Box-Muller for standard normal
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * Math.pow(x, 4)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(alpha, beta) {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

/**
 * Recommend the next strategy arm to try.
 *
 * Returns an object:
 *   { arm: "spot_80", strategy, sol_split_pct, reason, samples: {...} }
 *
 * The reason field is human-readable so the LLM can log why it's exploring.
 */
export function recommendNextStrategy({ windowDays = WINDOW_DAYS } = {}) {
  const stats = getArmStats({ windowDays });

  // Draw one Thompson sample per arm. Untested arms use Beta(1,1) = uniform.
  const draws = Object.entries(stats).map(([name, s]) => {
    const alpha = 1 + s.wins;
    const beta = 1 + s.losses;
    const draw = sampleBeta(alpha, beta);
    return { name, draw, stats: s };
  });

  draws.sort((a, b) => b.draw - a.draw);
  const winner = draws[0];

  const reason = winner.stats.n === 0
    ? `Thompson pick: ${winner.name} is untested in the last ${windowDays}d — pure exploration`
    : `Thompson pick: ${winner.name} sampled win-prob ${(winner.draw * 100).toFixed(1)}% (posterior Beta(${1 + winner.stats.wins}, ${1 + winner.stats.losses}), live WR ${(winner.stats.win_rate * 100).toFixed(0)}% n=${winner.stats.n})`;

  return {
    arm: winner.name,
    strategy: winner.stats.strategy,
    sol_split_pct: winner.stats.sol_split_pct,
    reason,
    draws: draws.map((d) => ({
      name: d.name,
      sampled_win_prob: Math.round(d.draw * 1000) / 1000,
      n: d.stats.n,
      win_rate: d.stats.win_rate == null ? null : Math.round(d.stats.win_rate * 1000) / 10,
      avg_pnl_pct: d.stats.avg_pnl_pct == null ? null : Math.round(d.stats.avg_pnl_pct * 100) / 100,
    })),
  };
}

/**
 * Formatted summary for injection into screener system prompt.
 * Keeps it compact — just the top recommendation plus per-arm stats.
 */
export function getExplorerSummary({ windowDays = WINDOW_DAYS } = {}) {
  try {
    const rec = recommendNextStrategy({ windowDays });
    const lines = [
      `Strategy Explorer (Thompson sampling, last ${windowDays}d):`,
      `  → RECOMMENDED NEXT: ${rec.arm}  (${rec.reason})`,
      "  Arm stats (n / WR / avgPnL):",
    ];
    for (const d of rec.draws) {
      const wr = d.win_rate == null ? "--" : `${d.win_rate.toFixed(0)}%`;
      const pnl = d.avg_pnl_pct == null ? "--" : `${d.avg_pnl_pct >= 0 ? "+" : ""}${d.avg_pnl_pct.toFixed(2)}%`;
      lines.push(`    ${d.name.padEnd(10)} n=${String(d.n).padEnd(4)} WR=${wr.padStart(4)}  avgPnL=${pnl}  sampled=${(d.sampled_win_prob * 100).toFixed(0)}%`);
    }
    lines.push("  Use the recommendation unless your LESSONS clearly contradict it.");
    return lines.join("\n");
  } catch (err) {
    log("strategy_explorer_error", `getExplorerSummary failed: ${err.message}`);
    return null;
  }
}
