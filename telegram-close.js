/**
 * telegram-close.js
 * Minimal close-only Telegram notifier — completely independent from telegram.js.
 *
 * Uses its own env vars:
 *   TELEGRAM_CLOSE_TOKEN   — bot token (from @BotFather)
 *   TELEGRAM_CLOSE_CHAT_ID — your chat ID (send /start to the bot once to auto-register)
 *
 * Only notifies on:
 *   - Position closed (any reason)
 *   - Emergency auto-close (PnL watcher)
 *
 * To enable: set TELEGRAM_CLOSE_TOKEN in .env and import this file from index.js.
 * To disable: just remove/comment the import in index.js — no other side effects.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { on } from "./notifier.js";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_PATH = path.join(__dirname, "user-config.json");

const TOKEN = process.env.TELEGRAM_CLOSE_TOKEN || null;
const BASE  = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;

let chatId = process.env.TELEGRAM_CLOSE_CHAT_ID || null;

// ── Persist chatId ───────────────────────────────────────────────
function loadChatId() {
  try {
    if (fs.existsSync(USER_CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"));
      if (cfg.telegramCloseChatId) chatId = cfg.telegramCloseChatId;
    }
  } catch { /* ignore */ }
}

function saveChatId(id) {
  try {
    const cfg = fs.existsSync(USER_CONFIG_PATH)
      ? JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"))
      : {};
    cfg.telegramCloseChatId = id;
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch { /* ignore */ }
}

loadChatId();

export function isEnabled() { return !!TOKEN; }

// ── Auto-register chatId on first /start ─────────────────────────
async function startPolling() {
  if (!TOKEN) return;
  let offset = 0;
  while (true) {
    try {
      const res = await fetch(
        `${BASE}/getUpdates?offset=${offset}&timeout=30`,
        { signal: AbortSignal.timeout(35_000) }
      );
      if (!res.ok) { await sleep(5000); continue; }
      const data = await res.json();
      for (const update of (data.result || [])) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (msg?.chat?.id && !chatId) {
          chatId = String(msg.chat.id);
          saveChatId(chatId);
          await send(`✅ Close notifier active. You'll get notified on every closed position.`);
          log("tg_close", `Chat ID registered: ${chatId}`);
        }
      }
    } catch { await sleep(5000); }
  }
}

// ── Send ─────────────────────────────────────────────────────────
async function send(text) {
  if (!TOKEN || !chatId) return;
  try {
    await fetch(`${BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(text).slice(0, 4096),
        parse_mode: "HTML",
      }),
    });
  } catch (e) {
    log("tg_close_error", e.message);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Helpers ───────────────────────────────────────────────────────
function pnlMark(pnlPct) {
  const p = pnlPct ?? 0;
  if (p >= 1)  return "🟢";
  if (p > 0)   return "🟡";
  if (p === 0) return "⬜";
  if (p > -5)  return "🔴";
  return "💀";
}

function formatPnl(pnlSol, pnlUsd, pnlPct, unit = "sol") {
  const p    = pnlPct ?? 0;
  const sign = p >= 0 ? "+" : "";
  const pct  = `${sign}${p.toFixed(2)}%`;
  if (unit === "sol" && pnlSol != null) {
    return `${sign}${Math.abs(pnlSol).toFixed(4)} SOL  (${pct})`;
  }
  return `${sign}$${Math.abs(pnlUsd ?? 0).toFixed(2)}  (${pct})`;
}

function formatStrategy(strategy, solSplitPct) {
  if (!strategy) return null;
  const side = (solSplitPct != null && solSplitPct < 100)
    ? `two-sided  ${solSplitPct}/${100 - solSplitPct}`
    : "one-sided";
  return `${strategy}  ${side}`;
}

function formatHeld(min) {
  if (min == null) return null;
  if (min < 60)  return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatReason(reason) {
  if (!reason) return null;
  const map = {
    "agent decision (OOR upside)":   "OOR upside — price pumped above range",
    "agent decision (OOR downside)":  "OOR downside — price fell below range",
    "agent decision":                 "closed by agent",
    "trailing_stop":                  "trailing stop hit",
    "stop_loss":                      "stop-loss hit",
    "take_profit":                    "take-profit hit",
    "pnl_watcher":                    "emergency auto-close",
  };
  for (const [k, v] of Object.entries(map)) {
    if (reason.includes(k)) return v;
  }
  return reason;
}

// ── Subscribe: close events only ─────────────────────────────────
on("close", async (data) => {
  if (!isEnabled()) return;
  const { config } = await import("./config.js");
  const unit   = config.management?.pnlUnit || "sol";
  const mark   = pnlMark(data.pnlPct);
  const pnl    = formatPnl(data.pnlSol, data.pnlUsd, data.pnlPct, unit);
  const strat  = formatStrategy(data.strategy, data.solSplitPct);
  const held   = formatHeld(data.minutesHeld);
  const reason = formatReason(data.reason);
  const pair   = data.pair || "Position";

  const lines = [
    `🔒 <b>${pair}</b> — closed  ${mark}`,
    ``,
    `💰 <b>${pnl}</b>`,
    strat  ? `📊 ${strat}`   : null,
    held   ? `⏱ Held: ${held}` : null,
    reason ? `📌 ${reason}`  : null,
  ].filter(v => v !== null);

  await send(lines.join("\n"));
});

on("pnl_watcher_close", async (data) => {
  if (!isEnabled()) return;
  const { config } = await import("./config.js");
  const unit  = config.management?.pnlUnit || "sol";
  const mark  = pnlMark(data.pnlPct);
  const pnl   = formatPnl(data.pnlSol, data.pnlUsd, data.pnlPct, unit);
  const pair  = data.pair || "Position";

  await send([
    `⚡ <b>${pair}</b> — emergency close  ${mark}`,
    ``,
    `💰 <b>${pnl}</b>`,
    `📌 ${data.reason || "PnL watcher triggered"}`,
  ].join("\n"));
});

// ── Init ─────────────────────────────────────────────────────────
if (TOKEN) {
  log("tg_close", `Close notifier enabled (chatId: ${chatId || "waiting for /start"})`);
  startPolling().catch(() => {});
} else {
  log("tg_close", "Close notifier disabled — TELEGRAM_CLOSE_TOKEN not set");
}
