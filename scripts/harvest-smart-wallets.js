#!/usr/bin/env node
/**
 * harvest-smart-wallets.js
 * Scrapes LP Agent API for top-performing LPers across active pools
 * and appends new entries to smart-wallets.json.
 *
 * Usage: node scripts/harvest-smart-wallets.js
 * Requires: LPAGENT_API_KEY in .env
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Load .env manually (no dotenv dependency needed)
const envPath = path.join(ROOT, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const LPAGENT_KEYS = (process.env.LPAGENT_API_KEY || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

const LPAGENT_API = "https://api.lpagent.io/open-api/v1";
const POOL_DISCOVERY = "https://pool-discovery-api.datapi.meteora.ag";
const SMART_WALLETS_PATH = path.join(ROOT, "smart-wallets.json");

// ── Config ───────────────────────────────────────────────────────
const POOLS_TO_SCAN     = 30;   // top N trending + new pools
const LPERS_PER_POOL    = 20;   // top LPers to fetch per pool
const MIN_WIN_RATE      = 0.65; // minimum win rate to include
const MIN_TOTAL_LP      = 5;    // minimum positions completed
const MIN_INFLOW        = 1000; // minimum total inflow USD
const CROSS_POOL_BONUS  = 2;    // extra score per additional pool appearance
const MAX_NEW_WALLETS   = 50;   // cap on how many new wallets to add per run

let keyIdx = 0;
function getApiKey() {
  if (LPAGENT_KEYS.length === 0) return null;
  const key = LPAGENT_KEYS[keyIdx % LPAGENT_KEYS.length];
  keyIdx++;
  return key;
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchLpa(urlPath, retries = 3) {
  const key = getApiKey();
  if (!key) throw new Error("No LPAGENT_API_KEY set");
  const url = `${LPAGENT_API}${urlPath}`;
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429) {
      const wait = 2000 * (attempt + 1);
      process.stdout.write(` [rate-limit, retry in ${wait}ms] `);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`Rate limited after ${retries} retries: ${url}`);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Pool discovery ────────────────────────────────────────────────
async function getActivePools() {
  const pools = new Map(); // address → pool info

  // Minimal filters — just want active DLMM pools with some volume
  const minFilters = [
    "pool_type=dlmm",
    "volume>=500",
    "tvl>=5000",
    "base_token_has_critical_warnings=false",
  ].join("&&");

  for (const category of ["trending", "new"]) {
    try {
      const url = `${POOL_DISCOVERY}/pools?page_size=${Math.ceil(POOLS_TO_SCAN / 2)}` +
        `&filter_by=${encodeURIComponent(minFilters)}` +
        `&timeframe=30m&category=${category}`;
      const data = await fetchJson(url);
      const items = Array.isArray(data) ? data : (data.data || data.pools || []);
      for (const p of items) {
        const addr = p.pool_address || p.address || p.poolAddress;
        if (addr) pools.set(addr, { address: addr, name: p.name || p.pair_name || p.pairName || addr.slice(0, 8) });
      }
    } catch (e) {
      console.warn(`  [warn] pool-discovery ${category}: ${e.message}`);
    }
  }

  return [...pools.values()].slice(0, POOLS_TO_SCAN);
}

// ── Top LPers per pool ────────────────────────────────────────────
async function getTopLPers(poolAddress) {
  try {
    const data = await fetchLpa(
      `/pools/${poolAddress}/top-lpers?sort_order=desc&page=1&limit=${LPERS_PER_POOL}`
    );
    return data.data || [];
  } catch (e) {
    process.stdout.write(`[err: ${e.message.slice(0, 30)}] `);
    return [];
  }
}

// ── Category assignment ───────────────────────────────────────────
function assignCategory(lper, poolCount) {
  const { total_inflow = 0, win_rate = 0, roi = 0 } = lper;
  if (total_inflow > 50_000 || poolCount >= 5) return "whale";
  if (win_rate >= 0.80 && roi > 0.1) return "alpha";
  if (win_rate >= 0.70) return "alpha";
  return "degen";
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  if (LPAGENT_KEYS.length === 0) {
    console.error("ERROR: LPAGENT_API_KEY not set in .env — cannot harvest wallets.");
    process.exit(1);
  }

  // Load existing wallets
  const existing = fs.existsSync(SMART_WALLETS_PATH)
    ? JSON.parse(fs.readFileSync(SMART_WALLETS_PATH, "utf8"))
    : { wallets: [] };
  const existingAddresses = new Set(existing.wallets.map((w) => w.address));

  console.log(`Existing wallets: ${existingAddresses.size}`);
  console.log("Fetching active pools...");

  const pools = await getActivePools();
  console.log(`Got ${pools.length} pools to scan`);

  // wallet address → { lper data, poolCount, pools[] }
  const walletMap = new Map();

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    process.stdout.write(`  [${i + 1}/${pools.length}] ${pool.name || pool.address.slice(0, 8)}... `);

    const lpers = await getTopLPers(pool.address);
    let added = 0;

    for (const lper of lpers) {
      const addr = lper.owner;
      if (!addr) continue;

      // Filter credibility
      if (
        (lper.win_rate ?? 0) < MIN_WIN_RATE ||
        (lper.total_lp ?? 0) < MIN_TOTAL_LP ||
        (lper.total_inflow ?? 0) < MIN_INFLOW
      ) continue;

      if (walletMap.has(addr)) {
        const entry = walletMap.get(addr);
        entry.poolCount++;
        entry.pools.push(pool.address);
        // Update with better stats if this pool shows higher win_rate
        if ((lper.win_rate ?? 0) > (entry.lper.win_rate ?? 0)) {
          entry.lper = lper;
        }
      } else {
        walletMap.set(addr, {
          address: addr,
          lper,
          poolCount: 1,
          pools: [pool.address],
        });
        added++;
      }
    }

    process.stdout.write(`${lpers.length} lpers, ${added} new candidates\n`);

    // Rate limiting: pause between requests (LP Agent ~1 req/sec)
    if (i < pools.length - 1) await sleep(1200);
  }

  console.log(`\nTotal unique candidates: ${walletMap.size}`);

  // Score and rank
  const scored = [...walletMap.values()]
    .filter((w) => !existingAddresses.has(w.address))
    .map((w) => {
      const { lper, poolCount } = w;
      const score =
        (lper.win_rate ?? 0) * 40 +
        Math.min((lper.roi ?? 0) * 20, 30) +
        poolCount * CROSS_POOL_BONUS +
        Math.min(Math.log10((lper.total_inflow ?? 1) / 1000) * 5, 10);
      return { ...w, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NEW_WALLETS);

  console.log(`New wallets to add: ${scored.length}`);

  if (scored.length === 0) {
    console.log("Nothing new to add.");
    return;
  }

  // Figure out current highest alpha/degen/whale index
  const counters = { alpha: 0, degen: 0, whale: 0 };
  for (const w of existing.wallets) {
    const m = w.name?.match(/^(alpha|degen|whale)-?(\d+)$/);
    if (m) {
      const cat = m[1];
      const num = parseInt(m[2], 10);
      if (num > counters[cat]) counters[cat] = num;
    }
  }

  const newWallets = [];
  for (const w of scored) {
    const cat = assignCategory(w.lper, w.poolCount);
    counters[cat]++;
    newWallets.push({
      name: `${cat}-${counters[cat]}`,
      address: w.address,
      category: cat,
      type: "lp",
      addedAt: new Date().toISOString(),
      _meta: {
        win_rate: Math.round((w.lper.win_rate ?? 0) * 1000) / 10,
        roi_pct: Math.round((w.lper.roi ?? 0) * 1000) / 10,
        total_lp: w.lper.total_lp ?? 0,
        total_inflow: Math.round(w.lper.total_inflow ?? 0),
        pool_count: w.poolCount,
        score: Math.round(w.score * 100) / 100,
      },
    });
  }

  existing.wallets.push(...newWallets);

  // Atomic write
  const tmp = SMART_WALLETS_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(existing, null, 2));
  fs.renameSync(tmp, SMART_WALLETS_PATH);

  console.log(`\nAdded ${newWallets.length} wallets. Total: ${existing.wallets.length}`);
  console.log("\nTop 10 new wallets:");
  for (const w of newWallets.slice(0, 10)) {
    const m = w._meta;
    console.log(
      `  ${w.name.padEnd(12)} ${w.address.slice(0, 8)}... ` +
      `wr=${m.win_rate}% roi=${m.roi_pct}% lps=${m.total_lp} pools=${m.pool_count} score=${m.score}`
    );
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
