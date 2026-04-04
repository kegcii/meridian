import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";
import { on } from "./notifier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_PATH = path.join(__dirname, "user-config.json");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || null;
const BASE  = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;

let chatId   = process.env.TELEGRAM_CHAT_ID || null;
let _offset  = 0;
let _polling = false;

// ─── chatId persistence ──────────────────────────────────────────
function loadChatId() {
  try {
    if (fs.existsSync(USER_CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"));
      if (cfg.telegramChatId) chatId = cfg.telegramChatId;
    }
  } catch { /**/ }
}

function saveChatId(id) {
  try {
    let cfg = fs.existsSync(USER_CONFIG_PATH)
      ? JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"))
      : {};
    cfg.telegramChatId = id;
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) {
    log("telegram_error", `Failed to persist chatId: ${e.message}`);
  }
}

loadChatId();

// ─── Core send ───────────────────────────────────────────────────
export function isEnabled() {
  return !!TOKEN;
}

export async function sendMessage(text) {
  if (!TOKEN || !chatId) return;
  try {
    const res = await fetch(`${BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(text).slice(0, 4096),
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      log("telegram_error", `sendMessage ${res.status}: ${err.slice(0, 100)}`);
    }
  } catch (e) {
    log("telegram_error", `sendMessage failed: ${e.message}`);
  }
}

export async function sendHTML(html) {
  if (!TOKEN || !chatId) return;
  try {
    const res = await fetch(`${BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: html.slice(0, 4096),
        parse_mode: "HTML",
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      log("telegram_error", `sendHTML ${res.status}: ${err.slice(0, 100)}`);
    }
  } catch (e) {
    log("telegram_error", `sendHTML failed: ${e.message}`);
  }
}


// ─── Long polling ────────────────────────────────────────────────
async function poll(onMessage) {
  while (_polling) {
    try {
      const res = await fetch(
        `${BASE}/getUpdates?offset=${_offset}&timeout=30`,
        { signal: AbortSignal.timeout(35_000) }
      );
      if (!res.ok) { await sleep(5000); continue; }
      const data = await res.json();
      for (const update of data.result || []) {
        _offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text) continue;

        const incomingChatId = String(msg.chat.id);

        // Auto-register first sender as the owner
        if (!chatId) {
          chatId = incomingChatId;
          saveChatId(chatId);
          log("telegram", `Registered chat ID: ${chatId}`);
          await sendMessage("Connected! I'm your LP agent. Ask me anything or use commands like /status.");
        }

        // Only accept messages from the registered chat
        if (incomingChatId !== chatId) continue;

        await onMessage(msg.text);
      }
    } catch (e) {
      if (!e.message?.includes("aborted")) {
        log("telegram_error", `Poll error: ${e.message}`);
      }
      await sleep(5000);
    }
  }
}

export function startPolling(onMessage) {
  if (!TOKEN) return;
  _polling = true;
  poll(onMessage); // fire-and-forget
  log("telegram", "Bot polling started");
}

export function stopPolling() {
  _polling = false;
}

// ─── Notification helpers ────────────────────────────────────────
// ── Helpers ───────────────────────────────────────────────────────
function pnlMark(pnlPct) {
  const p = pnlPct ?? 0;
  if (p >= 1)  return "🟢";
  if (p > 0)   return "🟡";
  if (p === 0) return "⬜";
  if (p > -5)  return "🔴";
  return "💀";
}

function fmtPnl(pnlSol, pnlUsd, pnlPct, unit = "sol") {
  const sign = (pnlPct ?? 0) >= 0 ? "+" : "";
  const pct  = `${sign}${(pnlPct ?? 0).toFixed(2)}%`;
  if (unit === "sol" && pnlSol != null) return `${sign}${pnlSol.toFixed(4)} SOL  (${pct})`;
  return `${sign}$${(pnlUsd ?? 0).toFixed(2)}  (${pct})`;
}

function fmtHeld(min) {
  if (min == null) return null;
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtReason(reason) {
  if (!reason) return null;
  const map = {
    "agent decision (OOR upside)":  "OOR upside — price pumped above range",
    "agent decision (OOR downside)": "OOR downside — price fell below range",
    "agent decision":               "closed by agent",
    "trailing_stop":                "trailing stop hit",
    "stop_loss":                    "stop-loss hit",
    "take_profit":                  "take-profit hit",
  };
  for (const [k, v] of Object.entries(map)) {
    if (reason.includes(k)) return v;
  }
  return reason;
}

function fmtStrat(strategy, solSplitPct) {
  if (!strategy) return null;
  const side = (solSplitPct != null && solSplitPct < 100)
    ? `two-sided  ${solSplitPct}/${100 - solSplitPct}`
    : "one-sided";
  return `${strategy}  ${side}`;
}

function table(rows) {
  const pad = Math.max(...rows.map(r => r[0].length));
  return rows.map(([k, v]) => `  ${k.padEnd(pad)}  ${v}`).join("\n");
}

// ── Notification functions ────────────────────────────────────────
export async function notifyDeploy({ pair, amountSol, strategy, solSplitPct, position, tx }) {
  const strat = fmtStrat(strategy, solSplitPct);
  const rows = [
    ["💰 Amount",   `${amountSol} SOL`],
    strat ? ["📊 Strategy", strat] : null,
    ["📍 Position", `<code>${(position || "").slice(0, 8)}...</code>`],
    tx    ? ["🔗 Tx",       `<code>${tx.slice(0, 16)}...</code>`] : null,
  ].filter(Boolean);
  await sendHTML(`🚀 <b>${pair}</b>  —  deployed\n\n${table(rows)}`);
}

export async function notifyClose({ pair, pnlUsd, pnlSol, pnlPct, strategy, solSplitPct, minutesHeld, reason }) {
  const { config } = await import("./config.js");
  const unit   = config.management.pnlUnit || "sol";
  const mark   = pnlMark(pnlPct);
  const pnl    = fmtPnl(pnlSol, pnlUsd, pnlPct, unit);
  const strat  = fmtStrat(strategy, solSplitPct);
  const held   = fmtHeld(minutesHeld);
  const rsn    = fmtReason(reason);
  const rows = [
    ["💰 PnL",      `${mark}  <b>${pnl}</b>`],
    strat ? ["📊 Strategy", strat] : null,
    held  ? ["⏱ Held",     held]  : null,
    rsn   ? ["📌 Reason",  rsn]   : null,
  ].filter(Boolean);
  await sendHTML(`🔒 <b>${pair}</b>  —  closed\n\n${table(rows)}`);
}

export async function notifyOutOfRange({ pair, minutesOOR, direction }) {
  const dir = direction === "upside" ? "price pumped above range" :
              direction === "downside" ? "price fell below range" : "";
  const rows = [
    ["⏱ Duration", `${minutesOOR} min OOR`],
    dir ? ["📌 Direction", dir] : null,
  ].filter(Boolean);
  await sendHTML(`⚠️ <b>${pair}</b>  —  out of range\n\n${table(rows)}`);
}

export async function notifyCycleSummary({ cycleType, positions, walletSol }) {
  const icon  = cycleType === "management" ? "🔄" : "🔍";
  const label = cycleType === "management" ? "Management" : "Screening";
  const rows  = [
    ["📂 Positions", `${positions} open`],
    ["💎 Wallet",    `${walletSol} SOL`],
  ];
  await sendHTML(`${icon} <b>${label} cycle</b>\n\n${table(rows)}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Subscribe to notifier events ────────────────────────────────
on("deploy", (data) => { if (isEnabled()) notifyDeploy(data).catch(() => {}); });
on("close",  (data) => { if (isEnabled()) notifyClose(data).catch(() => {}); });
on("out_of_range", (data) => { if (isEnabled()) notifyOutOfRange(data).catch(() => {}); });
on("pnl_watcher_close", (data) => {
  if (!isEnabled()) return;
  const mark = pnlMark(data.pnlPct);
  const rows = [
    ["💰 PnL",    `${mark}  <b>${fmtPnl(data.pnlSol, data.pnlUsd, data.pnlPct)}</b>`],
    ["📌 Reason", data.reason || "PnL watcher triggered"],
  ];
  sendHTML(`⚡ <b>${data.pair}</b>  —  emergency close\n\n${table(rows)}`).catch(() => {});
});
on("cycle:management", ({ report }) => { if (isEnabled()) sendMessage(`🔄 Management Cycle\n\n${report}`).catch(() => {}); });
on("cycle:screening",  ({ report }) => { if (isEnabled()) sendMessage(`🔍 Screening Cycle\n\n${report}`).catch(() => {}); });
on("briefing", ({ html }) => { if (isEnabled()) sendHTML(html).catch(() => {}); });
