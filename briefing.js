import fs from "fs";
import { log } from "./logger.js";
import { getPerformanceSummary } from "./lessons.js";
import { config } from "./config.js";
import { getLpOverview } from "./tools/lp-overview.js";

const STATE_FILE = "./state.json";
const LESSONS_FILE = "./lessons.json";

export async function generateBriefing() {
  const state = loadJson(STATE_FILE) || { positions: {}, recentEvents: [] };
  const lessonsData = loadJson(LESSONS_FILE) || { lessons: [], performance: [] };

  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // 1. Positions Activity
  const allPositions = Object.values(state.positions || {});
  const openedLast24h = allPositions.filter(p => new Date(p.deployed_at) > last24h);
  const closedLast24h = allPositions.filter(p => p.closed && new Date(p.closed_at) > last24h);

  // 2. Performance — prefer LP Agent overview, fall back to local data
  const lpOverview = await getLpOverview().catch(() => null);
  const perfSummary = getPerformanceSummary();
  const unit = config.management.pnlUnit || "sol";
  const useSol = unit === "sol";

  let pnlLine, feesLine, winRateLine, allTimeLine;

  if (lpOverview) {
    const pnlLabel = useSol ? `${lpOverview.total_pnl_sol} SOL` : `$${lpOverview.total_pnl_usd}`;
    const feesLabel = useSol ? `${lpOverview.total_fees_sol} SOL` : `$${lpOverview.total_fees_usd}`;
    pnlLine = `Total PnL: ${pnlLabel}`;
    feesLine = `Fees Earned: ${feesLabel}`;
    winRateLine = `Win Rate: ${lpOverview.win_rate_pct}%`;
    allTimeLine = `Closed: ${lpOverview.closed_positions} | Avg Hold: ${lpOverview.avg_hold_hours}h | ROI: ${lpOverview.roi_pct}%`;
  } else if (perfSummary) {
    pnlLine = `Total PnL: $${perfSummary.total_pnl_usd}`;
    feesLine = null;
    winRateLine = `Win Rate: ${perfSummary.win_rate_pct}%`;
    allTimeLine = `Closed: ${perfSummary.total_positions_closed} | Avg PnL: ${perfSummary.avg_pnl_pct}%`;
  } else {
    pnlLine = "Total PnL: N/A";
    feesLine = null;
    winRateLine = "Win Rate: N/A";
    allTimeLine = null;
  }

  // 3. Lessons Learned
  const allLessons = lessonsData.lessons || [];
  const recentLessons = allLessons.slice(-5);

  // 4. Current State
  const openPositions = allPositions.filter(p => !p.closed);

  // 5. Recent closes (last 24h)
  const recentPerf = (lessonsData.performance || [])
    .filter(r => r.recorded_at >= last24h.toISOString())
    .slice(-10)
    .map(r => {
      const closedDate = new Date(r.recorded_at);
      const holdMins = r.minutes_held ?? 0;
      return {
        pool: r.pool_name || r.pool,
        pnl_pct: r.pnl_pct,
        pnl_usd: r.pnl_usd,
        strategy: r.strategy,
        hold: holdMins < 60 ? `${Math.round(holdMins)}m` : `${(holdMins / 60).toFixed(1)}h`,
        reason: r.close_reason,
        closed_at: closedDate.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) + " WIB",
      };
    });

  // 6. Return structured data (rendered by frontend, not raw HTML)
  return {
    html: null,
    text: null,
    structured: {
      title: "Briefing (Last 24h)",
      activity: {
        opened: openedLast24h.length,
        closed: closedLast24h.length,
      },
      performance: {
        pnl: pnlLine,
        fees: feesLine,
        win_rate: winRateLine,
        all_time: allTimeLine,
      },
      portfolio: {
        open_positions: openPositions.length,
        lp_positions: lpOverview?.open_positions ?? null,
      },
      recent_closes: recentPerf,
      lessons: recentLessons.map(l => l.rule),
    },
  };
}

export function formatBriefingText(briefing) {
  const s = briefing.structured;
  if (!s) return JSON.stringify(briefing);
  const lines = [
    s.title,
    "",
    "Activity",
    `  Positions Opened: ${s.activity.opened}`,
    `  Positions Closed: ${s.activity.closed}`,
    "",
    "Performance",
    s.performance.pnl ? `  ${s.performance.pnl}` : null,
    s.performance.fees ? `  ${s.performance.fees}` : null,
    s.performance.win_rate ? `  ${s.performance.win_rate}` : null,
    s.performance.all_time ? `  ${s.performance.all_time}` : null,
    "",
    "Lessons",
    ...(s.lessons.length > 0 ? s.lessons.map(l => `  - ${l}`) : ["  - No new lessons recorded."]),
    "",
    "Portfolio",
    `  Open Positions: ${s.portfolio.open_positions}`,
    s.portfolio.lp_positions != null ? `  LP Positions: ${s.portfolio.lp_positions}` : null,
  ];
  if (s.recent_closes?.length > 0) {
    lines.push("", "Recent Closes");
    for (const c of s.recent_closes) {
      lines.push(`  - ${c.pool}: ${c.pnl_pct}% (${c.hold}, ${c.reason || "manual"})`);
    }
  }
  return lines.filter(l => l !== null).join("\n");
}

function loadJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    log("briefing_error", `Failed to read ${file}: ${err.message}`);
    return null;
  }
}
