// tools/fabriq.js — Fabriq.trade trending pools integration
// Fabriq has no public API; data is imported via browser bookmarklet → POST to Meridian server.
// This module manages the cache and exposes data for the screener pipeline.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, "..", "data", "fabriq-trending.json");
const SOL_MINT = "So11111111111111111111111111111111111111112";

// Cache TTL — data older than this is considered stale
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

// ─── Column mapping from Fabriq DOM table ──────────────────────
// Columns: # | Pool | Score | Trend | Age | FDV | Liquidity | Holders |
//          5m Fees | 1h Fees | 6h Fees | 5m % | 1h % | 6h % | 24h % |
//          5m Vol | 1h Vol | 5m APR | 1h APR
const COL = {
  rank: 0,
  pool: 1,
  score: 2,
  trend: 3,
  age: 4,
  fdv: 5,
  liquidity: 6,
  holders: 7,
  fees_5m: 8,
  fees_1h: 9,
  fees_6h: 10,
  pct_5m: 11,
  pct_1h: 12,
  pct_6h: 13,
  pct_24h: 14,
  vol_5m: 15,
  vol_1h: 16,
  apr_5m: 17,
  apr_1h: 18,
};

// ─── Parse helpers ─────────────────────────────────────────────

function parseDollar(s) {
  if (!s) return null;
  const clean = s.replace(/[▲▼$,\s]/g, "");
  if (!clean || clean === "-") return null;
  const m = clean.match(/([\d.]+)([KkMm]?)/);
  if (!m) return null;
  let val = parseFloat(m[1]);
  if (m[2] === "K" || m[2] === "k") val *= 1000;
  if (m[2] === "M" || m[2] === "m") val *= 1_000_000;
  return isNaN(val) ? null : Math.round(val * 100) / 100;
}

function parsePct(s) {
  if (!s) return null;
  const clean = s.replace(/[▲▼%,\s]/g, "");
  if (!clean || clean === "-") return null;
  const val = parseFloat(clean);
  return isNaN(val) ? null : val;
}

function parseNum(s) {
  if (!s) return null;
  const clean = s.replace(/[▲▼,\s]/g, "");
  if (!clean || clean === "-") return null;
  const m = clean.match(/([\d.]+)([KkMm]?)/);
  if (!m) return null;
  let val = parseFloat(m[1]);
  if (m[2] === "K" || m[2] === "k") val *= 1000;
  if (m[2] === "M" || m[2] === "m") val *= 1_000_000;
  return isNaN(val) ? null : val;
}

/**
 * Parse the pool cell which contains multi-line text:
 * "9Lbu...pump\nFREG\n-\nSOL\n75\n21\n4\nDLMM\n80\n2%\n3.08%"
 * Fields: address, symbol, -, quote, organic(?), ?, ?, type, bin_step, base_fee, current_fee
 */
function parsePoolCell(raw) {
  if (!raw) return null;
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return null;

  return {
    address_short: lines[0] || null,
    symbol: lines[1] || null,
    quote_symbol: lines[3] || "SOL",
    pool_type: lines[7] || "DLMM",
    bin_step: parseInt(lines[8]) || null,
    base_fee_pct: parseFloat(lines[9]) || null,
    current_fee_pct: parseFloat(lines[10]) || null,
  };
}

// ─── Parse raw row array into structured object ────────────────

function parseRow(cells) {
  if (!cells || cells.length < 17) return null;

  const pool = parsePoolCell(cells[COL.pool]);
  if (!pool) return null;
  if (pool.pool_type !== "DLMM") return null;

  return {
    rank: parseInt(cells[COL.rank]) || null,
    symbol: pool.symbol,
    address_short: pool.address_short,
    quote_symbol: pool.quote_symbol,
    bin_step: pool.bin_step,
    base_fee_pct: pool.base_fee_pct,
    current_fee_pct: pool.current_fee_pct,
    fabriq_score: parseNum(cells[COL.score]),
    age: cells[COL.age] || null,
    fdv: parseDollar(cells[COL.fdv]),
    liquidity: parseDollar(cells[COL.liquidity]),
    holders: parseNum(cells[COL.holders]),
    fees_5m: parseDollar(cells[COL.fees_5m]),
    fees_1h: parseDollar(cells[COL.fees_1h]),
    fees_6h: parseDollar(cells[COL.fees_6h]),
    pct_5m: parsePct(cells[COL.pct_5m]),
    pct_1h: parsePct(cells[COL.pct_1h]),
    pct_6h: parsePct(cells[COL.pct_6h]),
    pct_24h: parsePct(cells[COL.pct_24h]),
    vol_5m: parseDollar(cells[COL.vol_5m]),
    vol_1h: parseDollar(cells[COL.vol_1h]),
    apr_5m: parsePct(cells[COL.apr_5m]),
    apr_1h: parsePct(cells[COL.apr_1h]),
  };
}

// ─── Import (called from server.js POST endpoint) ──────────────

/**
 * Import raw cell data from the browser bookmarklet.
 * @param {string[][]} rawRows - Array of arrays, each inner array is cell texts from one <tr>
 * @returns {{ imported: number, pools: object[] }}
 */
export function importFabriqTrending(rawRows) {
  if (!Array.isArray(rawRows)) throw new Error("Expected array of rows");

  const pools = rawRows.map(parseRow).filter(Boolean);

  const payload = {
    imported_at: new Date().toISOString(),
    count: pools.length,
    pools,
  };

  // Ensure data directory exists
  const dataDir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2));
  log("fabriq", `Imported ${pools.length} trending pools from Fabriq`);

  return { imported: pools.length, pools };
}

// ─── Read cached data ──────────────────────────────────────────

/**
 * Load cached Fabriq trending data.
 * Returns null if cache doesn't exist or is stale.
 */
export function loadFabriqTrending({ maxAge = MAX_AGE_MS } = {}) {
  if (!fs.existsSync(CACHE_PATH)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    const age = Date.now() - new Date(raw.imported_at).getTime();
    if (age > maxAge) {
      log("fabriq", `Cache stale (${Math.round(age / 60000)}m old)`);
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * Get Fabriq trending pools formatted as screener candidates.
 * Cross-references with Meteora DLMM pool search to get full pool addresses.
 */
export async function getFabriqCandidates() {
  const cached = loadFabriqTrending();
  if (!cached || !cached.pools?.length) return [];

  const { searchPools } = await import("./dlmm.js");
  const { isBlacklisted } = await import("../token-blacklist.js");
  const { config } = await import("../config.js");
  const s = config.screening;

  const results = [];

  for (const pool of cached.pools) {
    if (!pool.symbol) continue;

    // Search Meteora for this token's DLMM pools
    try {
      const { pools: meteoraPools } = await searchPools({ query: pool.symbol, limit: 5 });

      // Match by bin_step and quote=SOL
      const match = meteoraPools.find((mp) => {
        if (!mp.pool) return false;
        const quoteIsSol = mp.token_y?.mint === SOL_MINT || mp.name?.includes("-SOL");
        const bsMatch = pool.bin_step ? mp.bin_step === pool.bin_step : true;
        return quoteIsSol && bsMatch;
      });

      if (!match) continue;

      const baseMint = match.token_x?.mint;
      if (baseMint && isBlacklisted(baseMint)) continue;

      // Apply basic screening filters
      if (pool.bin_step && (pool.bin_step < s.minBinStep || pool.bin_step > s.maxBinStep)) continue;
      if (pool.liquidity && (pool.liquidity < s.minTvl || pool.liquidity > s.maxTvl)) continue;

      results.push({
        pool: match.pool,
        name: `${pool.symbol}-${pool.quote_symbol}`,
        base: {
          symbol: pool.symbol,
          mint: baseMint,
        },
        quote: { symbol: pool.quote_symbol, mint: SOL_MINT },
        pool_type: "dlmm",
        bin_step: pool.bin_step,
        fee_pct: pool.current_fee_pct ?? pool.base_fee_pct,
        active_tvl: pool.liquidity ? Math.round(pool.liquidity) : null,
        volume: pool.vol_1h ? Math.round(pool.vol_1h) : null,
        fee: pool.fees_1h,
        fee_active_tvl_ratio: pool.liquidity && pool.fees_1h
          ? Math.round((pool.fees_1h / pool.liquidity) * 10000) / 100
          : null,
        holders: pool.holders,
        mcap: pool.fdv ? Math.round(pool.fdv) : null,
        price_change_pct: pool.pct_1h,
        fabriq_score: pool.fabriq_score,
        fabriq_rank: pool.rank,
        fabriq_apr_1h: pool.apr_1h,
        _source: "fabriq_trending",
      });

      // Small delay to avoid hammering Meteora search
      await new Promise((r) => setTimeout(r, 300));
    } catch {
      continue;
    }
  }

  log("fabriq", `${results.length}/${cached.pools.length} Fabriq pools matched to Meteora DLMM`);
  return results;
}
