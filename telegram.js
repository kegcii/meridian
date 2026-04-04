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
  if (p >= 2)  return "🟢";
  if (p > 0)   return "🟡";
  if (p === 0) return "⬜";
  if (p > -5)  return "🔴";
  return "💀";
}

function fmtPnl(pnlSol, pnlUsd, pnlPct, unit = "sol") {
  const sign = (pnlPct ?? 0) >= 0 ? "+" : "";
  const pct  = `${sign}${(pnlPct ?? 0).toFixed(2)}%`;
  if (unit === "sol" && pnlSol != null) return `${sign}${Math.abs(pnlSol).toFixed(4)} SOL (${pct})`;
  return `${sign}$${Math.abs(pnlUsd ?? 0).toFixed(2)} (${pct})`;
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
    "agent decision (OOR upside)":   "⬆️ OOR upside — price pumped above range",
    "agent decision (OOR downside)":  "⬇️ OOR downside — price fell below range",
    "agent decision":                 "closed by agent",
    "trailing_stop":                  "trailing stop hit",
    "stop_loss":                      "stop-loss hit",
    "take_profit":                    "take-profit hit",
  };
  for (const [k, v] of Object.entries(map)) {
    if (reason.includes(k)) return v;
  }
  return reason;
}

function fmtStrat(strategy, solSplitPct) {
  if (!strategy) return null;
  const side = (solSplitPct != null && solSplitPct < 100)
    ? `two-sided ${solSplitPct}/${100 - solSplitPct}`
    : "one-sided";
  return `${strategy} · ${side}`;
}

// Convert LLM markdown (**bold**, *italic*) to Telegram HTML
function mdToHtml(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g,     "<i>$1</i>")
    .replace(/`([^`]+)`/g,       "<code>$1</code>");
}

// Parse management report into structured position blocks
function parseMgmtBlocks(report) {
  const blocks = [];
  let cur = null;
  for (const line of report.split("\n")) {
    const h = line.match(/\*{0,2}([A-Z0-9_\-/]+(?:-SOL|-USDC|-USDT)?)\*{0,2}\s*\|\s*Age:\s*([^|]+)\|\s*(?:Fees?:\s*([^|]+)\|)?\s*PnL:\s*([^|]+)\|\s*OOR:\s*(.+)/i);
    if (h) {
      if (cur) blocks.push(cur);
      cur = { pair: h[1].trim(), age: h[2].trim(), fees: h[3]?.trim(), pnl: h[4].trim(), oor: h[5].trim() };
      continue;
    }
    if (!cur) continue;
    const dec = line.match(/\*{0,2}Decision:\*{0,2}\s*(STAY|HOLD|CLOSE)/i);
    const rsn = line.match(/\*{0,2}Reason:\*{0,2}\s*(.+)/i);
    if (dec) cur.decision = dec[1].toUpperCase();
    if (rsn) cur.reason   = rsn[1].trim();
  }
  if (cur) blocks.push(cur);
  return blocks;
}

// ── Notification functions ────────────────────────────────────────
export async function notifyDeploy({ pair, amountSol, strategy, solSplitPct, position, tx }) {
  const strat = fmtStrat(strategy, solSplitPct);
  const lines = [
    `🚀 <b>${pair}</b> — deployed`,
    ``,
    `💰 ${amountSol} SOL`,
    strat ? `📊 ${strat}` : null,
    `📍 <code>${(position || "").slice(0, 10)}…</code>`,
    tx ? `🔗 <code>${tx.slice(0, 20)}…</code>` : null,
  ].filter(v => v !== null);
  await sendHTML(lines.join("\n"));
}

export async function notifyClose({ pair, pnlUsd, pnlSol, pnlPct, strategy, solSplitPct, minutesHeld, reason }) {
  const { config } = await import("./config.js");
  const unit  = config.management.pnlUnit || "sol";
  const mark  = pnlMark(pnlPct);
  const pnl   = fmtPnl(pnlSol, pnlUsd, pnlPct, unit);
  const strat = fmtStrat(strategy, solSplitPct);
  const held  = fmtHeld(minutesHeld);
  const rsn   = fmtReason(reason);
  const lines = [
    `🔒 <b>${pair}</b> — closed  ${mark}`,
    ``,
    `💰 <b>${pnl}</b>`,
    strat ? `📊 ${strat}` : null,
    held  ? `⏱ Held: ${held}` : null,
    rsn   ? `📌 ${rsn}` : null,
  ].filter(v => v !== null);
  await sendHTML(lines.join("\n"));
}

export async function notifyOutOfRange({ pair, minutesOOR, direction }) {
  const dirIcon = direction === "upside" ? "⬆️" : direction === "downside" ? "⬇️" : "↔️";
  const dirText = direction === "upside" ? "price pumped above range"
                : direction === "downside" ? "price fell below range"
                : "out of range";
  await sendHTML(
    `⚠️ <b>${pair}</b> — out of range\n\n${dirIcon} ${dirText}\n⏱ ${minutesOOR} min OOR`
  );
}

export async function notifyCycleSummary({ cycleType, positions, walletSol }) {
  const icon  = cycleType === "management" ? "🔄" : "🔍";
  const label = cycleType === "management" ? "Management" : "Screening";
  await sendHTML(`${icon} <b>${label} cycle</b>\n\n📂 ${positions} posisi terbuka\n💎 ${walletSol} SOL`);
}

function formatMgmtCycleHtml(report) {
  const blocks = parseMgmtBlocks(report);

  if (!blocks.length) {
    // No structured blocks found — fallback: convert markdown and send raw
    const cleaned = mdToHtml(report).slice(0, 3500);
    return `🔄 <b>Management Cycle</b>\n\n${cleaned}`;
  }

  const stays  = blocks.filter(b => !b.decision || b.decision === "STAY" || b.decision === "HOLD");
  const closes = blocks.filter(b => b.decision === "CLOSE");

  const lines = [`🔄 <b>Management Cycle</b>  —  ${blocks.length} posisi`];

  for (const b of closes) {
    const mark = pnlMark(parseFloat(b.pnl));
    lines.push(``, `🔒 <b>CLOSE</b>  ${b.pair}  ${mark}`);
    lines.push(`   Age: ${b.age}  •  PnL: ${b.pnl}  •  OOR: ${b.oor}`);
    if (b.reason) lines.push(`   📌 ${b.reason.slice(0, 120)}`);
  }

  for (const b of stays) {
    const mark = pnlMark(parseFloat(b.pnl));
    lines.push(``, `✅ <b>HOLD</b>  ${b.pair}  ${mark}`);
    lines.push(`   Age: ${b.age}  •  PnL: ${b.pnl}  •  OOR: ${b.oor}`);
    if (b.reason) lines.push(`   📌 ${b.reason.slice(0, 100)}`);
  }

  return lines.join("\n").slice(0, 4000);
}

function formatScreenCycleHtml(report) {
  const lower = report.toLowerCase();
  const deployed = lower.includes("deploy") && (lower.includes("success") || lower.includes("position opened") || lower.includes("deployed"));
  const noCandidate = lower.includes("no candidate") || lower.includes("no suitable") || lower.includes("no pools") || lower.includes("skipping");

  // Try to extract deployed pair name
  let deployLine = "";
  const dm = report.match(/deploy(?:ed)?[^a-z]*([A-Z0-9]{2,10}-SOL)/i);
  if (dm) deployLine = `\n🚀 ${dm[1]}`;

  const summary = deployed
    ? `🟢 Deploy berhasil${deployLine}`
    : noCandidate
      ? `📭 Tidak ada kandidat yang lolos threshold`
      : `ℹ️ Cycle selesai`;

  // Take first 2000 chars of report, convert markdown
  const body = mdToHtml(report.slice(0, 2000));
  return `🔍 <b>Screening Cycle</b>\n\n${summary}\n\n<i>${body}</i>`.slice(0, 4000);
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
  const pnl  = fmtPnl(data.pnlSol, data.pnlUsd, data.pnlPct);
  sendHTML([
    `⚡ <b>${data.pair}</b> — emergency close  ${mark}`,
    ``,
    `💰 <b>${pnl}</b>`,
    `📌 ${data.reason || "PnL watcher triggered"}`,
  ].join("\n")).catch(() => {});
});
on("cycle:management", ({ report }) => { if (isEnabled()) sendHTML(formatMgmtCycleHtml(report)).catch(() => {}); });
on("cycle:screening",  ({ report }) => { if (isEnabled()) sendHTML(formatScreenCycleHtml(report)).catch(() => {}); });
on("briefing", ({ html }) => { if (isEnabled()) sendHTML(html).catch(() => {}); });
