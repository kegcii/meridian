/**
 * tele-agent.js
 * Autonomous Claude agent for Meridian — accessible via Telegram.
 * Run independently: node tele-agent.js
 *
 * Architecture:
 *   Telegram message → Claude (via OpenRouter) → tool calls → reply to Telegram
 */

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config as dotenv } from "dotenv";

dotenv();

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOT_DIR   = __dirname;

// ── Config ───────────────────────────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_AGENT_TOKEN;
if (!TELEGRAM_TOKEN) { console.error("TELEGRAM_AGENT_TOKEN not set in .env"); process.exit(1); }

const OR_KEY  = process.env.OPENROUTER_API_KEY;
const MODEL   = "anthropic/claude-sonnet-4-5";
const OR_BASE = "https://openrouter.ai/api/v1";

// ── Chat ID — load from env, fallback to user-config.json, auto-register on first msg ──
const USER_CONFIG = path.join(BOT_DIR, "user-config.json");
let chatId = process.env.TELEGRAM_CHAT_ID || null;

function loadChatId() {
  try {
    const cfg = JSON.parse(fs.readFileSync(USER_CONFIG, "utf8"));
    if (cfg.telegramAgentChatId) chatId = cfg.telegramAgentChatId;
  } catch { /**/ }
}

function saveChatId(id) {
  try {
    const cfg = fs.existsSync(USER_CONFIG)
      ? JSON.parse(fs.readFileSync(USER_CONFIG, "utf8"))
      : {};
    cfg.telegramAgentChatId = id;
    fs.writeFileSync(USER_CONFIG, JSON.stringify(cfg, null, 2));
    console.log(`[agent] Chat ID saved: ${id}`);
  } catch (e) {
    console.error(`[agent] Failed to save chat ID: ${e.message}`);
  }
}

loadChatId();

if (!OR_KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }

// ── Conversation history (in-memory, trimmed to last 30 turns) ───────────────
let history = [];

// ── Tool definitions (OpenAI-compatible format for OpenRouter) ────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "bash",
      description: "Run a bash command. Working directory is the Meridian bot root.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read contents of a file. Path relative to Meridian root or absolute.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          lines: { type: "number", description: "Max lines to return (default 200)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Overwrite a file with new content.",
      parameters: {
        type: "object",
        properties: {
          path:    { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files matching a glob pattern.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern, e.g. 'tools/*.js'" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "Search for a pattern in files.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path:    { type: "string", description: "File or directory to search (default: .)" },
        },
        required: ["pattern"],
      },
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────
async function runTool(name, input) {
  try {
    switch (name) {
      case "bash": {
        const { stdout, stderr } = await execAsync(input.command, {
          cwd: BOT_DIR,
          timeout: 30_000,
        });
        return (stdout + stderr).trim() || "(no output)";
      }
      case "read_file": {
        const p = input.path.startsWith("/") ? input.path : path.join(BOT_DIR, input.path);
        const raw = fs.readFileSync(p, "utf8");
        const maxLines = input.lines || 200;
        const lines = raw.split("\n").slice(0, maxLines);
        const truncated = lines.length < raw.split("\n").length;
        return lines.join("\n") + (truncated ? `\n... (truncated to ${maxLines} lines)` : "");
      }
      case "write_file": {
        const p = input.path.startsWith("/") ? input.path : path.join(BOT_DIR, input.path);
        fs.writeFileSync(p, input.content, "utf8");
        return `Written: ${p}`;
      }
      case "list_files": {
        const { stdout } = await execAsync(`ls -la ${input.pattern} 2>/dev/null || echo "(no matches)"`, {
          cwd: BOT_DIR,
        });
        return stdout.trim();
      }
      case "grep": {
        const target = input.path || ".";
        const { stdout, stderr } = await execAsync(
          `grep -rn --include="*.js" --include="*.json" -m 50 "${input.pattern}" ${target} 2>/dev/null || echo "(no matches)"`,
          { cwd: BOT_DIR }
        );
        return (stdout + stderr).trim();
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM = `You are an autonomous agent managing the Meridian Solana DLMM liquidity bot.
Bot root: /root/meridian-bot/meridian

Key files:
- state.json         — open positions (live runtime state)
- user-config.json   — bot config (thresholds, models, etc.)
- lessons.json       — trade lessons from past outcomes
- index.js           — main entry + cron loops
- agent.js           — LLM ReAct loop
- tools/             — all on-chain tools

You have full access to read/write files and run bash commands.
You CAN edit code, fix bugs, tune thresholds, restart the bot, check logs.

RESPONSE FORMAT RULES:
- Reply in the same language the user writes (Indonesian or English)
- Use emojis and clear sections to structure your response
- For status/data: use bullet points with emojis
- For code changes: briefly state what you changed and why
- Keep responses concise — no filler text
- For numbers: always show units (SOL, %, etc.)
- Lead with the key finding or result, then details

WHEN CHECKING POSITIONS: read state.json directly, filter closed=false, show pool_name, amount_sol, strategy, peak_pnl_pct, age, in_range status.
WHEN EDITING CONFIG: read user-config.json, make the change, confirm with old→new value.`;

// ── Claude call with agentic tool loop ───────────────────────────────────────
async function askClaude(userMessage) {
  history.push({ role: "user", content: userMessage });
  const messages = [...history];

  while (true) {
    const res = await fetch(`${OR_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OR_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://meridian-bot",
        "X-Title": "Meridian Claude Agent",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM }, ...messages],
        tools: TOOLS,
        tool_choice: "auto",
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${err.slice(0, 200)}`);
    }

    const data  = await res.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error("Empty response from model");

    const msg = choice.message;
    messages.push(msg);

    // No tool calls → final answer
    if (!msg.tool_calls?.length) {
      const reply = msg.content || "(no response)";
      history.push({ role: "assistant", content: reply });
      if (history.length > 40) history = history.slice(-20);
      return reply;
    }

    // Execute all tool calls
    for (const tc of msg.tool_calls) {
      let input;
      try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
      console.log(`[tool] ${tc.function.name}:`, JSON.stringify(input).slice(0, 120));
      const result = await runTool(tc.function.name, input);
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: String(result).slice(0, 8000),
      });
    }
  }
}

// ── Telegram helpers ──────────────────────────────────────────────────────────
const TG_BASE = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

async function tgSend(text) {
  await fetch(`${TG_BASE}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
  }).catch(() => {});
}

async function tgSendChunked(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += 4000) chunks.push(text.slice(i, i + 4000));
  for (const chunk of chunks) await tgSend(chunk);
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmtAge(deployedAt) {
  if (!deployedAt) return "?";
  const min = Math.round((Date.now() - new Date(deployedAt)) / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtPnl(pct) {
  if (pct == null) return null;
  const sign = pct >= 0 ? "+" : "";
  if (pct >= 2)   return `🟢 ${sign}${pct.toFixed(2)}%`;
  if (pct >= 0)   return `🟡 ${sign}${pct.toFixed(2)}%`;
  if (pct >= -5)  return `🔴 ${sign}${pct.toFixed(2)}%`;
  return `💀 ${sign}${pct.toFixed(2)}%`;
}

function fmtNum(n) {
  if (n == null) return "?";
  return n.toLocaleString("en-US");
}

// ── Fast commands (no LLM, direct file reads) ─────────────────────────────────
function cmdPositions() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(BOT_DIR, "state.json"), "utf8"));
    const positions = Object.values(raw.positions || {}).filter(p => !p.closed);

    if (!positions.length) return "📭 Tidak ada posisi terbuka.";

    const lines = ["📊 Posisi Terbuka — " + positions.length, ""];

    for (const p of positions) {
      const oor      = p.out_of_range_since;
      const oorDir   = p.oor_direction === "upside" ? "⬆️ OOR upside" : p.oor_direction === "downside" ? "⬇️ OOR downside" : "⚠️ OOR";
      const status   = oor ? oorDir : "✅ In range";
      const pnlStr   = fmtPnl(p.peak_pnl_pct);
      const oorAge   = oor ? ` (${fmtAge(oor)})` : "";

      lines.push(`🏦 ${p.pool_name}`);
      lines.push(`   ${status}${oorAge}`);
      lines.push(`   💰 ${p.amount_sol} SOL  •  ${p.strategy} bs${p.bin_step}`);
      if (pnlStr) lines.push(`   📈 Peak PnL: ${pnlStr}`);
      lines.push(`   ⏱ Usia: ${fmtAge(p.deployed_at)}`);
      if (p.organic_score != null) lines.push(`   🎯 Score: ${p.organic_score}  •  Vol: ${p.volatility ?? "?"}`);
      lines.push("");
    }

    return lines.join("\n").trimEnd();
  } catch (e) {
    return `❌ Error: ${e.message}`;
  }
}

function cmdConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(BOT_DIR, "user-config.json"), "utf8"));

    return [
      "⚙️ Konfigurasi Meridian",
      "",
      "💰 Deploy",
      `   Per posisi  : ${c.deployAmountSol ?? "?"} SOL`,
      `   Max per TX  : ${c.maxDeployAmount ?? "?"} SOL`,
      `   Min saldo   : ${c.minSolToOpen ?? "?"} SOL`,
      `   Max posisi  : ${c.maxPositions ?? "?"}`,
      "",
      "🔍 Screening",
      `   Fee/TVL min : ${c.minFeeActiveTvlRatio ?? "?"}`,
      `   TVL         : ${fmtNum(c.minTvl)} – ${fmtNum(c.maxTvl)}`,
      `   Volume min  : ${fmtNum(c.minVolume)}`,
      `   Organic min : ${c.minOrganic ?? "?"}`,
      `   Holders min : ${fmtNum(c.minHolders)}`,
      `   MCap        : ${fmtNum(c.minMcap)} – ${fmtNum(c.maxMcap)}`,
      `   Bin step    : ${c.minBinStep ?? "?"} – ${c.maxBinStep ?? "?"}`,
      `   Max vol     : ${c.maxVolatility ?? "?"}`,
      "",
      "🛡 Management",
      `   Stop loss   : ${c.stopLossPct ?? "?"}%`,
      `   Take profit : +${c.takeProfitFeePct ?? "?"}%`,
      `   Trail TP    : ${c.trailingTriggerPct ?? "?"}% trigger / ${c.trailingDropPct ?? "?"}% drop`,
      `   OOR wait    : ${c.outOfRangeWaitMinutes ?? "?"} min`,
      `   Emergency   : ${c.emergencyPriceDropPct ?? "?"}%`,
      "",
      "⏰ Schedule",
      `   Screening   : ${c.screeningIntervalMin ?? "?"} min`,
      `   Management  : ${c.managementIntervalMin ?? "?"} min`,
      "",
      `🤖 Model: ${c.screeningModel ?? "?"} / ${c.managementModel ?? "?"}`,
      `📅 Last evolved: ${c._lastEvolved ? c._lastEvolved.slice(0, 10) : "never"}`,
    ].join("\n");
  } catch (e) {
    return `❌ Error: ${e.message}`;
  }
}

function cmdLogs() {
  try {
    const logsDir = path.join(BOT_DIR, "logs");
    if (!fs.existsSync(logsDir)) return "❌ Folder logs tidak ditemukan.";
    const files = fs.readdirSync(logsDir).filter(f => f.endsWith(".log") || f.endsWith(".txt")).sort().reverse();
    if (!files.length) return "📭 Belum ada file log.";
    const latest = path.join(logsDir, files[0]);
    const raw = fs.readFileSync(latest, "utf8");
    const lines = raw.trim().split("\n").slice(-25);
    return `📋 Log terakhir — ${files[0]}\n\n${lines.join("\n")}`;
  } catch (e) {
    return `❌ Error: ${e.message}`;
  }
}

// ── Long polling loop ─────────────────────────────────────────────────────────
let offset = 0;

async function poll() {
  while (true) {
    try {
      const res = await fetch(`${TG_BASE}/getUpdates?offset=${offset}&timeout=30`, {
        signal: AbortSignal.timeout(35_000),
      });
      if (!res.ok) { await sleep(5000); continue; }

      const data = await res.json();
      for (const update of data.result || []) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text) continue;

        const incomingId = String(msg.chat.id);

        // Auto-register first sender as owner
        if (!chatId) {
          chatId = incomingId;
          saveChatId(chatId);
          await tgSend(
            "🤖 Meridian Claude Agent terdaftar!\n\n" +
            "Chat ID kamu sudah disimpan. Ketik /help untuk daftar command."
          );
          continue;
        }

        if (incomingId !== chatId) continue;

        const text = msg.text.trim();
        console.log(`[in] ${text}`);

        if (text === "/start") {
          await tgSend(
            "🤖 Meridian Claude Agent online\n\n" +
            "Gue bisa:\n" +
            "  • Monitor posisi & PnL\n" +
            "  • Edit config & threshold\n" +
            "  • Fix bug & improve kode\n" +
            "  • Cek log & status bot\n\n" +
            "Ketik /help untuk daftar command."
          );
          continue;
        }

        if (text === "/clear") {
          history = [];
          await tgSend("Conversation cleared.");
          continue;
        }

        // Fast commands — no LLM round-trip
        const lc = text.toLowerCase();
        if (text === "/pos" || text === "/positions" ||
            lc.match(/^(cek|lihat|show|status)\s*(posisi|position|pos)s?$/)) {
          await tgSend(cmdPositions());
          continue;
        }
        if (text === "/config" || lc.match(/^(cek|lihat|show)\s*(config|threshold|setting)s?$/)) {
          await tgSend(cmdConfig());
          continue;
        }
        if (text === "/logs" || lc.match(/^(cek|lihat|show)\s*logs?$/)) {
          await tgSend(cmdLogs());
          continue;
        }
        if (text === "/help") {
          await tgSend(
            "⚡ Command Cepat (instant, tanpa AI)\n" +
            "  /pos     — posisi terbuka\n" +
            "  /config  — konfigurasi & threshold\n" +
            "  /logs    — log terakhir\n" +
            "  /clear   — reset percakapan\n\n" +
            "💬 Chat Bebas (lewat Claude)\n" +
            "  Ketik apa aja dalam bahasa Indonesia\n" +
            "  atau Inggris — bot akan jawab,\n" +
            "  edit file, jalankan command, dll."
          );
          continue;
        }

        try {
          const reply = await askClaude(text);
          console.log(`[out] ${reply.slice(0, 100)}`);
          await tgSendChunked(reply);
        } catch (e) {
          console.error("[error]", e.message);
          await tgSend(`Error: ${e.message}`);
        }
      }
    } catch (e) {
      if (!e.message?.includes("aborted")) console.error("[poll]", e.message);
      await sleep(5000);
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Start ─────────────────────────────────────────────────────────────────────
console.log("Meridian Claude Agent starting...");
console.log(`  Model : ${MODEL}`);
console.log(`  Chat  : ${chatId || "(waiting for first message to register)"}`);
tgSend("Meridian Claude Agent online. Ask me anything.").catch(() => {});
poll();
