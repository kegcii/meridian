#!/bin/bash
# claude-monitor.sh
# Autonomous Claude monitoring script — runs claude CLI non-interactively,
# analyzes bot performance, makes improvements, restarts if needed.
# Called by cron every 2 hours.
#
# Setup:
#   chmod +x scripts/claude-monitor.sh
#   crontab -e → add: 0 */2 * * * /root/meridian-bot/meridian/scripts/claude-monitor.sh

set -euo pipefail

REPO="/root/meridian-bot/meridian"
LOG_FILE="$REPO/logs/claude-monitor.log"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Load .env for TELEGRAM vars
if [ -f "$REPO/.env" ]; then
  export $(grep -v '^#' "$REPO/.env" | grep -v '^$' | xargs 2>/dev/null) || true
fi

TELEGRAM_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT="${TELEGRAM_CHAT_ID:-}"

send_telegram() {
  local msg="$1"
  if [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT}" \
      -d "text=${msg}" \
      -d "parse_mode=HTML" > /dev/null 2>&1 || true
  fi
}

echo "[$TIMESTAMP] Claude monitor starting..." >> "$LOG_FILE"

cd "$REPO"

# Run claude non-interactively with a monitoring prompt
CLAUDE_OUTPUT=$(claude --print \
  --allowedTools "Read,Edit,Write,Bash,Glob,Grep" \
  --max-turns 30 \
  "You are monitoring the Meridian DLMM LP bot autonomously. The bot is running in a screen session named 'meridian'.

Your job:
1. Check recent performance: read logs/agent-$(date +%Y-%m-%d).log (last 200 lines), pool-memory.json, state.json
2. Identify any issues: errors, repeated failures, poor PnL trends, strategy problems
3. If improvements needed: edit code files, commit with git, push to myfork/feature/upstream-merge
4. If bot needs restart after changes: run: screen -S meridian -X quit; sleep 1; screen -dmS meridian bash -c 'npm start 2>&1 | tee -a logs/agent-\$(date +%Y-%m-%d).log'
5. Summarize what you found and what you did (max 3 bullet points, concise)

Rules:
- Only make changes if there is a clear problem worth fixing
- Do NOT change user-config.json values (those are user preferences)
- Do NOT touch .env or wallet keys
- Always git add + commit + push after code changes
- If everything looks fine, just say so — do not make unnecessary changes
- Keep summary under 200 chars total for Telegram

Output ONLY the summary (3 bullets max), nothing else." 2>> "$LOG_FILE" || echo "Claude monitor failed")

echo "[$TIMESTAMP] Output: $CLAUDE_OUTPUT" >> "$LOG_FILE"

# Send to Telegram
if [ -n "$CLAUDE_OUTPUT" ]; then
  send_telegram "🤖 <b>Claude Monitor</b> [$TIMESTAMP]
$CLAUDE_OUTPUT"
fi

echo "[$TIMESTAMP] Done." >> "$LOG_FILE"
