#!/bin/bash
# claude-monitor.sh
# Autonomous Claude improvement agent — runs every 4 hours via cron.
# Reads .claude/auto-improve.md and executes all steps.
#
# Crontab: 0 */4 * * * /root/meridian-bot/meridian/scripts/claude-monitor.sh

REPO="/root/meridian-bot/meridian"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M WIB')
LOG="$REPO/logs/claude-monitor-$(date +%Y-%m-%d).log"

mkdir -p "$REPO/logs"

# Load .env
set -a
source "$REPO/.env" 2>/dev/null || true
set +a

TELEGRAM_TOKEN="${TELEGRAM_AGENT_TOKEN:-}"

send_telegram() {
  local msg="$1"
  [ -z "$TELEGRAM_TOKEN" ] && return
  local chat_id
  chat_id=$(node --input-type=module << 'EOF' 2>/dev/null
import fs from 'fs';
try {
  const c = JSON.parse(fs.readFileSync('/root/meridian-bot/meridian/user-config.json','utf8'));
  process.stdout.write(c.telegramAgentChatId || process.env.TELEGRAM_CHAT_ID || '');
} catch { process.stdout.write(''); }
EOF
)
  [ -z "$chat_id" ] && return
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\":\"${chat_id}\",\"text\":\"${msg//\"/\\\"}\",\"parse_mode\":\"HTML\"}" \
    > /dev/null 2>&1 || true
}

{
  echo ""
  echo "══════════════════════════════════════"
  echo "[$TIMESTAMP] Autonomous run starting"
  echo "══════════════════════════════════════"
} >> "$LOG"

send_telegram "⏳ <b>Meridian Auto-Improve</b> dimulai...
🕐 ${TIMESTAMP}"

cd "$REPO"

PROMPT="Read /root/meridian-bot/meridian/.claude/auto-improve.md carefully, then execute every step from top to bottom. Working directory: /root/meridian-bot/meridian. This is a fully autonomous scheduled run — complete all steps without asking for confirmation."

claude \
  --print \
  --allowedTools "Bash,Read,Write,Edit,Glob,Grep,MultiEdit" \
  --max-turns 80 \
  --output-format text \
  "$PROMPT" >> "$LOG" 2>&1

EXIT_CODE=$?

echo "[$TIMESTAMP] Exit code: $EXIT_CODE" >> "$LOG"

if [ $EXIT_CODE -ne 0 ]; then
  send_telegram "❌ <b>Auto-Improve FAILED</b>
🕐 ${TIMESTAMP}
Exit: ${EXIT_CODE} — cek logs/claude-monitor-$(date +%Y-%m-%d).log"
fi

echo "[$TIMESTAMP] Done." >> "$LOG"
