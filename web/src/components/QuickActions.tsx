import { useState, useCallback, useEffect } from "react";
import type { QuickActionResult } from "../hooks/useWebSocket";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface QuickActionsProps {
  sendQuickAction: (action: string) => void;
  quickActionResult: QuickActionResult | null;
  clearQuickActionResult: () => void;
}

const ACTIONS = [
  { key: "top-pools",      label: "Top Pools",     icon: "🏊" },
  { key: "recent-closes", label: "Recent Closes",  icon: "📋" },
  { key: "lessons",       label: "Lessons",        icon: "📚" },
  { key: "memory",        label: "Memory",         icon: "🧠" },
  { key: "darwin-weights",label: "Darwin",         icon: "🧬" },
  { key: "autoresearch",  label: "Research",       icon: "🔬" },
  { key: "settings",      label: "Settings",       icon: "⚙️" },
  { key: "briefing",      label: "Briefing",       icon: "📰" },
  { key: "performance",   label: "Performance",    icon: "📊" },
] as const;

type ActionKey = (typeof ACTIONS)[number]["key"];

const ACTION_TITLES: Record<ActionKey, string> = {
  "top-pools": "Top Pools",
  "recent-closes": "Recent Closes",
  lessons: "Lessons",
  memory: "Memories",
  "darwin-weights": "Darwin Weights",
  autoresearch: "Autoresearch",
  settings: "Settings",
  briefing: "Briefing",
  performance: "Performance",
};

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center text-sm text-ash/46">
      {text}
    </div>
  );
}

function fmtNum(v: unknown): string {
  if (v == null) return "--";
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : n.toFixed(2);
}

function fmtUsd(v: unknown): string {
  if (v == null) return "--";
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(v: unknown): string {
  if (v == null) return "--";
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : `${n.toFixed(1)}%`;
}

function fmtHoldTime(v: unknown): string {
  if (v == null) return "--";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  if (n < 60) return `${Math.round(n)}m`;
  return `${(n / 60).toFixed(1)}h`;
}

function normalizeLessons(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object" && Array.isArray((data as { lessons?: unknown[] }).lessons)) {
    return (data as { lessons: Record<string, unknown>[] }).lessons;
  }
  return [];
}

function normalizeRecentCloses(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object" && Array.isArray((data as { positions?: unknown[] }).positions)) {
    return (data as { positions: Record<string, unknown>[] }).positions;
  }
  return [];
}

function renderTopPools(data: unknown) {
  const pools = Array.isArray(data) ? data : [];
  if (pools.length === 0) return <EmptyState text="No pool data available." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">Fee/TVL</TableHead>
          <TableHead className="text-right">Volume</TableHead>
          <TableHead className="text-right">Organic</TableHead>
          <TableHead className="text-right">Holders</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pools.map((p: Record<string, unknown>, i: number) => (
          <TableRow key={i}>
            <TableCell className="max-w-[140px] truncate">{String(p.name ?? p.pair ?? "--")}</TableCell>
            <TableCell className="text-right">{fmtNum(p.fee_tvl_ratio ?? p.fee_tvl)}</TableCell>
            <TableCell className="text-right">{fmtUsd(p.volume ?? p.volume_24h)}</TableCell>
            <TableCell className="text-right">{fmtPct(p.organic ?? p.organic_score)}</TableCell>
            <TableCell className="text-right">{p.holders != null ? String(p.holders) : "--"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type CloseSortKey = "newest" | "oldest" | "pnl_high" | "pnl_low";

function RecentClosesView({ data }: { data: unknown }) {
  const [sort, setSort] = useState<CloseSortKey>("newest");
  const closes = normalizeRecentCloses(data);
  if (closes.length === 0) return <EmptyState text="No recent closes." />;

  const sorted = [...closes].sort((a, b) => {
    if (sort === "newest") return String(b.closed_at ?? "").localeCompare(String(a.closed_at ?? ""));
    if (sort === "oldest") return String(a.closed_at ?? "").localeCompare(String(b.closed_at ?? ""));
    if (sort === "pnl_high") return Number(b.pnl_pct ?? 0) - Number(a.pnl_pct ?? 0);
    return Number(a.pnl_pct ?? 0) - Number(b.pnl_pct ?? 0);
  });

  const SORTS: { key: CloseSortKey; label: string }[] = [
    { key: "newest", label: "Newest" },
    { key: "oldest", label: "Oldest" },
    { key: "pnl_high", label: "PnL ↑" },
    { key: "pnl_low", label: "PnL ↓" },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Sort controls */}
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[9px] uppercase tracking-wider text-ash/50 mr-1">Sort:</span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSort(s.key)}
            className={`px-2 py-1 rounded-lg font-mono text-[9px] uppercase tracking-wider transition-colors cursor-pointer select-none ${sort === s.key ? "bg-amber-300/15 text-amber-200" : "text-ash/50 hover:text-ash/80 bg-white/4"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {sorted.map((c: Record<string, unknown>, i: number) => {
        const pnlPct = Number(c.pnl_pct ?? 0);
        const isWin = pnlPct >= 0;
        const pnlColor = isWin ? "text-emerald-300" : "text-red-400";
        const reason = String(c.close_reason ?? c.reason ?? "");

        // Format close time
        const closedAt = c.closed_at ? new Date(String(c.closed_at)) : null;
        const timeStr = closedAt && !isNaN(closedAt.getTime())
          ? closedAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" }) + " WIB"
          : null;

        return (
          <div key={i} className={`rounded-xl border px-3 py-2.5 ${isWin ? "border-emerald-300/12 bg-emerald-300/4" : "border-red-400/12 bg-red-400/4"}`}>
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="min-w-0">
                <span className="font-mono text-[12px] font-semibold text-cream truncate block">{String(c.pool_name ?? c.pool ?? c.pair ?? "--")}</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-[9px] text-ash/70">{String(c.strategy ?? "bid_ask")}</span>
                  {c.bin_step != null && <span className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-[9px] text-ash/70">bs{String(c.bin_step)}</span>}
                  {(c.minutes_held != null || c.hold_time != null) && <span className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-[9px] text-ash/70">{fmtHoldTime(c.minutes_held ?? c.hold_time)}</span>}
                  {timeStr && <span className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-[9px] text-ash/70">{timeStr}</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={`font-mono text-[14px] font-semibold ${pnlColor}`}>{pnlPct >= 0 ? "+" : ""}{fmtPct(c.pnl_pct)}</div>
                <div className="font-mono text-[11px] text-ash/60">{fmtUsd(c.pnl_usd)}</div>
              </div>
            </div>
            {reason && (
              <div className="mt-1 text-[11px] text-ash/50 break-words">{reason}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function renderRecentCloses(data: unknown) {
  return <RecentClosesView data={data} />;
}

function renderLessons(data: unknown) {
  const lessons = normalizeLessons(data);
  if (lessons.length === 0) return <EmptyState text="No lessons recorded yet." />;
  return (
    <div className="flex flex-col gap-2">
      {lessons.map((lesson, i) => (
        <div key={i} className="rounded-xl border border-white/8 bg-white/4 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-cream/90">{String(lesson.rule ?? lesson.text ?? lesson.content ?? "--")}</p>
            {!!lesson.pinned && (
              <Badge variant="secondary" className="shrink-0 text-[9px]">
                Pinned
              </Badge>
            )}
          </div>
          {Array.isArray(lesson.tags) && lesson.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {lesson.tags.map((tag: string, ti: number) => (
                <span
                  key={ti}
                  className="rounded-md bg-steel/20 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ash/70"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function renderMemory(data: unknown) {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length > 0) {
      return (
        <div className="flex flex-col gap-2">
          {entries.map(([key, val]) => (
            <div key={key} className="rounded-xl border border-white/8 bg-white/4 px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-amber-200/70 mb-1">{key}</div>
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-cream/85">
                {typeof val === "string" ? val : JSON.stringify(val, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      );
    }
  }
  const text = typeof data === "string" ? data : data == null ? "No memory facts promoted yet." : JSON.stringify(data, null, 2);
  return (
    <pre className="whitespace-pre-wrap break-words rounded-xl border border-white/8 bg-white/4 px-4 py-3 font-mono text-[11px] leading-relaxed text-cream/85">
      {text}
    </pre>
  );
}

function renderDarwinWeights(data: unknown) {
  if (!data || typeof data !== "object") return <EmptyState text="No Darwin weight data." />;
  const payload = data as {
    enabled?: boolean;
    last_recalc?: string | null;
    recalc_count?: number;
    weights?: Array<{ signal?: string; weight?: number; direction?: string }>;
  };
  const weights = Array.isArray(payload.weights) ? payload.weights : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-cream/84">
        <div>Darwin: {payload.enabled ? "enabled" : "disabled"}</div>
        <div>Last recalc: {payload.last_recalc || "--"}</div>
        <div>Total recalcs: {payload.recalc_count ?? 0}</div>
      </div>

      {weights.length ? (
        weights.map((entry, index) => {
          const weight = Number(entry.weight ?? 0);
          const width = `${Math.max(8, Math.min(100, (weight / 2.5) * 100))}%`;
          return (
            <div key={`${entry.signal}-${index}`} className="rounded-xl border border-white/8 bg-white/4 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-cream/90">{String(entry.signal ?? "--")}</div>
                  <div className="mt-1 text-xs text-ash/56">{String(entry.direction ?? "unknown")}</div>
                </div>
                <div className="font-mono text-lg text-cream">{weight.toFixed(2)}</div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-white/8">
                <div className="h-2 rounded-full bg-[linear-gradient(90deg,rgba(89,131,146,0.85),rgba(255,209,102,0.92))]" style={{ width }} />
              </div>
            </div>
          );
        })
      ) : (
        <EmptyState text="No Darwin weights available." />
      )}
    </div>
  );
}

function renderAutoresearch(data: unknown) {
  if (!data || typeof data !== "object") return <EmptyState text="No autoresearch data." />;
  const payload = data as {
    enabled?: boolean;
    cooldownRemaining?: number;
    keptOverrideSections?: string[];
    keptOverrides?: Record<string, string>;
    active?: { section?: string; hypothesis?: string } | null;
    recentLessons?: Array<{ id?: number; rule?: string; created_at?: string }>;
    recentExperiments?: Array<{ id?: string; section?: string; status?: string; hypothesis?: string }>;
  };

  const keptOverrides = payload.keptOverrides ?? {};
  const keptEntries = Object.entries(keptOverrides);

  return (
    <div className="flex flex-col gap-4">
      {/* Status bar */}
      <div className="rounded-xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-cream/84">
        <div className="flex items-center justify-between">
          <span>Autoresearch</span>
          <Badge variant={payload.enabled ? "secondary" : "outline"}>{payload.enabled ? "enabled" : "disabled"}</Badge>
        </div>
        <div className="mt-1 text-xs text-ash/60">
          Cooldown: {payload.cooldownRemaining ?? 0} closes remaining
          {(payload.keptOverrideSections?.length ?? 0) > 0 && (
            <span className="ml-2 text-amber-200/70">· {payload.keptOverrideSections!.length} patterns locked in</span>
          )}
        </div>
        {payload.active ? (
          <div className="mt-2 rounded-lg border border-amber-200/12 bg-amber-200/6 px-3 py-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-amber-200/70 mb-0.5">Active Experiment</div>
            <div className="font-medium text-cream text-sm">{payload.active.section || "—"}</div>
            <div className="mt-0.5 text-xs text-ash/60">{payload.active.hypothesis || "--"}</div>
          </div>
        ) : null}
      </div>

      {/* Key Patterns — kept_overrides content */}
      {keptEntries.length > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/60 mb-2">🔑 Key Patterns (Proven & Locked)</div>
          <div className="flex flex-col gap-2">
            {keptEntries.map(([section, text]) => (
              <div key={section} className="rounded-xl border border-amber-200/12 bg-amber-200/4 px-4 py-3">
                <div className="font-mono text-[10px] uppercase tracking-wider text-amber-200/80 mb-1.5">{section.replace(/_/g, " ")}</div>
                <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-cream/80">{text}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent lessons from autoresearch */}
      {Array.isArray(payload.recentLessons) && payload.recentLessons.length > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/60 mb-2">Recent Research Lessons</div>
          <div className="flex flex-col gap-2">
            {payload.recentLessons.map((lesson, index) => (
              <div key={`${lesson.id}-${index}`} className="rounded-xl border border-white/8 bg-white/4 px-4 py-3">
                <div className="text-sm text-cream/90">{String(lesson.rule ?? "--")}</div>
                <div className="mt-1 text-xs text-ash/56">{String(lesson.created_at ?? "--")}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Experiment history */}
      {Array.isArray(payload.recentExperiments) && payload.recentExperiments.length > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/60 mb-2">Experiment History</div>
          <div className="flex flex-col gap-2">
            {payload.recentExperiments.map((experiment, index) => (
              <div key={`${experiment.id}-${index}`} className="rounded-xl border border-white/8 bg-white/4 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-cream">{String(experiment.section ?? "--")}</div>
                  <Badge variant={experiment.status === "kept" ? "secondary" : "outline"}>{String(experiment.status ?? "--")}</Badge>
                </div>
                <div className="mt-1 text-sm text-cream/84">{String(experiment.hypothesis ?? "--")}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {keptEntries.length === 0 && !payload.recentLessons?.length && !payload.recentExperiments?.length && (
        <EmptyState text="No autoresearch data yet — patterns accumulate after position closes." />
      )}
    </div>
  );
}

function renderSettings(data: unknown) {
  if (!data || typeof data !== "object") return <EmptyState text="No settings data." />;
  const entries = Object.entries(data as Record<string, unknown>);
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-white/8 bg-white/4 px-4 py-3 font-mono text-[11px]">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-start justify-between gap-3 border-b border-white/5 py-1 last:border-0">
          <span className="shrink-0 text-ash/70">{key}</span>
          <span className="break-all text-right text-cream/85">
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function renderBriefing(data: unknown) {
  // Handle structured briefing data
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const s = (d.structured ?? d) as Record<string, unknown>;
    if (s.activity || s.performance || s.recent_closes) {
      const activity = s.activity as Record<string, number> | undefined;
      const performance = s.performance as Record<string, string | null> | undefined;
      const portfolio = s.portfolio as Record<string, number | null> | undefined;
      const closes = Array.isArray(s.recent_closes) ? s.recent_closes as Record<string, unknown>[] : [];
      const lessons = Array.isArray(s.lessons) ? s.lessons as string[] : [];

      return (
        <div className="flex flex-col gap-4">
          {/* Activity */}
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/60 mb-2">Activity (24h)</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/4 border border-white/8 px-3 py-2.5">
                <div className="font-mono text-[9px] uppercase text-ash/50 mb-1">Opened</div>
                <div className="font-mono text-[18px] font-semibold text-cream">{activity?.opened ?? 0}</div>
              </div>
              <div className="rounded-xl bg-white/4 border border-white/8 px-3 py-2.5">
                <div className="font-mono text-[9px] uppercase text-ash/50 mb-1">Closed</div>
                <div className="font-mono text-[18px] font-semibold text-cream">{activity?.closed ?? 0}</div>
              </div>
            </div>
          </div>

          {/* Performance */}
          {performance && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/60 mb-2">Performance</div>
              <div className="rounded-xl bg-white/4 border border-white/8 px-3 py-2.5 flex flex-col gap-1 text-[12px] text-cream/85 font-mono">
                {performance.pnl && <div>{performance.pnl}</div>}
                {performance.fees && <div>{performance.fees}</div>}
                {performance.win_rate && <div>{performance.win_rate}</div>}
                {performance.all_time && <div className="text-ash/60 text-[11px]">{performance.all_time}</div>}
              </div>
            </div>
          )}

          {/* Portfolio */}
          {portfolio && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/60 mb-2">Portfolio</div>
              <div className="rounded-xl bg-white/4 border border-white/8 px-3 py-2.5 text-[12px] text-cream/85 font-mono">
                Open positions: {portfolio.open_positions ?? 0}
                {portfolio.lp_positions != null && <span className="text-ash/60"> ({portfolio.lp_positions} LP Agent)</span>}
              </div>
            </div>
          )}

          {/* Recent Closes */}
          {closes.length > 0 && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/60 mb-2">Recent Closes</div>
              <div className="flex flex-col gap-1.5">
                {closes.map((c, i) => {
                  const pnl = Number(c.pnl_pct ?? 0);
                  const isWin = pnl >= 0;
                  return (
                    <div key={i} className={`flex items-center justify-between rounded-xl border px-3 py-2 ${isWin ? "border-emerald-300/12 bg-emerald-300/4" : "border-red-400/12 bg-red-400/4"}`}>
                      <div className="flex flex-col min-w-0">
                        <span className="font-mono text-[12px] text-cream truncate">{String(c.pool ?? "--")}</span>
                        <div className="flex flex-wrap gap-1.5 mt-0.5">
                          <span className="font-mono text-[9px] text-ash/50">{String(c.strategy ?? "")}</span>
                          {c.hold ? <span className="font-mono text-[9px] text-ash/50">{String(c.hold)}</span> : null}
                          {c.closed_at ? <span className="font-mono text-[9px] text-ash/50">{String(c.closed_at)}</span> : null}
                        </div>
                      </div>
                      <div className={`font-mono text-[13px] font-semibold shrink-0 ${isWin ? "text-emerald-300" : "text-red-400"}`}>
                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}% <span className="text-[10px] text-ash/50">${Number(c.pnl_usd ?? 0).toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Lessons */}
          {lessons.length > 0 && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/60 mb-2">Recent Lessons</div>
              <div className="flex flex-col gap-1.5">
                {lessons.map((l, i) => (
                  <div key={i} className="rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-[11px] text-cream/80 break-words">{l}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Fallback: html or text
    const html = typeof d.html === "string" ? d.html : "";
    const text = typeof d.text === "string" ? d.text : "";
    if (html) {
      return (
        <div className="prose prose-invert prose-sm max-w-none text-cream/85 [&_a]:text-amber-200 [&_h2]:font-semibold [&_h2]:text-amber-200 [&_strong]:text-cream" dangerouslySetInnerHTML={{ __html: html }} />
      );
    }
    if (text) {
      return <pre className="whitespace-pre-wrap break-words rounded-xl border border-white/8 bg-white/4 px-4 py-3 font-mono text-[11px] leading-relaxed text-cream/85">{text}</pre>;
    }
  }

  // Plain string fallback
  if (typeof data === "string" && data) {
    return <pre className="whitespace-pre-wrap break-words rounded-xl border border-white/8 bg-white/4 px-4 py-3 font-mono text-[11px] leading-relaxed text-cream/85">{data}</pre>;
  }

  return <EmptyState text="No briefing content." />;
}

function fmtHoldTime2(mins: number | null | undefined): string {
  if (mins == null) return "--";
  if (mins < 60) return `${Math.round(mins)}m`;
  return `${(mins / 60).toFixed(1)}h`;
}

function StrategyCard({ label, stats }: { label: string; stats: Record<string, unknown> | null }) {
  if (!stats) return (
    <div className="rounded-xl border border-white/8 bg-white/4 px-4 py-3 text-center text-ash/40 text-sm">
      No {label} data
    </div>
  );
  const winRate = Number(stats.win_rate_pct ?? 0);
  const avgPnl = Number(stats.avg_pnl_pct ?? 0);
  return (
    <div className="rounded-xl border border-white/10 bg-white/4 px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[11px] uppercase tracking-wider text-amber-200/80">{label}</span>
        <span className="font-mono text-[11px] text-ash/60">{Number(stats.count ?? 0)} closes</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="font-mono text-[9px] uppercase text-ash/50 mb-0.5">Win Rate</div>
          <div className={`font-mono text-[15px] font-semibold ${winRate >= 50 ? "text-emerald-300" : "text-red-400"}`}>{winRate}%</div>
        </div>
        <div>
          <div className="font-mono text-[9px] uppercase text-ash/50 mb-0.5">Avg PnL</div>
          <div className={`font-mono text-[15px] font-semibold ${avgPnl >= 0 ? "text-emerald-300" : "text-red-400"}`}>{avgPnl >= 0 ? "+" : ""}{avgPnl.toFixed(2)}%</div>
        </div>
        <div>
          <div className="font-mono text-[9px] uppercase text-ash/50 mb-0.5">Net PnL</div>
          <div className={`font-mono text-[13px] font-semibold ${Number(stats.total_pnl_usd ?? 0) >= 0 ? "text-emerald-300" : "text-red-400"}`}>
            ${Number(stats.total_pnl_usd ?? 0).toFixed(2)}
          </div>
        </div>
        <div>
          <div className="font-mono text-[9px] uppercase text-ash/50 mb-0.5">Avg Hold</div>
          <div className="font-mono text-[13px] text-cream">{fmtHoldTime2(Number(stats.avg_hold_min ?? 0))}</div>
        </div>
      </div>
    </div>
  );
}

function renderPerformance(data: unknown) {
  if (!data || typeof data !== "object") return <EmptyState text="No performance data." />;
  const d = data as Record<string, unknown>;
  const byStrategy = d.by_strategy as Record<string, Record<string, unknown> | null> | undefined;
  const recentCloses = Array.isArray(d.recent_closes) ? d.recent_closes as Record<string, unknown>[] : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Overview */}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/60 mb-2">Overview</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            { label: "Total Closed", val: String(d.total_positions_closed ?? "--") },
            { label: "Win Rate", val: d.win_rate_pct != null ? `${Number(d.win_rate_pct).toFixed(0)}%` : "--" },
            { label: "Avg PnL", val: d.avg_pnl_pct != null ? `${Number(d.avg_pnl_pct) >= 0 ? "+" : ""}${Number(d.avg_pnl_pct).toFixed(2)}%` : "--", color: Number(d.avg_pnl_pct ?? 0) >= 0 ? "text-emerald-300" : "text-red-400" },
            { label: "Net PnL", val: d.total_pnl_usd != null ? `$${Number(d.total_pnl_usd).toFixed(2)}` : "--", color: Number(d.total_pnl_usd ?? 0) >= 0 ? "text-emerald-300" : "text-red-400" },
            { label: "Avg Hold", val: fmtHoldTime2(Number(d.avg_hold_min ?? 0)) },
            { label: "Lessons", val: String(d.total_lessons ?? "--") },
          ].map(({ label, val, color }) => (
            <div key={label} className="rounded-xl bg-white/4 border border-white/8 px-3 py-2.5">
              <div className="font-mono text-[9px] uppercase tracking-wider text-ash/50 mb-1">{label}</div>
              <div className={`font-mono text-[14px] font-semibold ${color ?? "text-cream"}`}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Strategy comparison */}
      {byStrategy && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/60 mb-2">Strategy Comparison</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <StrategyCard label="Bid Ask" stats={byStrategy.bid_ask ?? null} />
            <StrategyCard label="Spot" stats={byStrategy.spot ?? null} />
          </div>
        </div>
      )}

      {/* Recent closes */}
      {recentCloses.length > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/60 mb-2">Recent Closes</div>
          <div className="flex flex-col gap-1.5">
            {recentCloses.map((c, i) => {
              const pnl = Number(c.pnl_pct ?? 0);
              const isWin = pnl >= 0;
              return (
                <div key={i} className={`flex items-center justify-between rounded-xl border px-3 py-2 ${isWin ? "border-emerald-300/12 bg-emerald-300/4" : "border-red-400/12 bg-red-400/4"}`}>
                  <div className="flex flex-col">
                    <span className="font-mono text-[12px] text-cream">{String(c.pair ?? "--")}</span>
                    <span className="font-mono text-[10px] text-ash/50">
                      {String(c.strategy ?? "bid_ask")}
                      {c.bin_step ? ` · bs${c.bin_step}` : ""}
                      {c.minutes_held ? ` · ${fmtHoldTime2(Number(c.minutes_held))}` : ""}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className={`font-mono text-[13px] font-semibold ${isWin ? "text-emerald-300" : "text-red-400"}`}>
                      {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                    </div>
                    <div className="font-mono text-[10px] text-ash/50">${Number(c.pnl_usd ?? 0).toFixed(2)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const RENDERERS: Record<ActionKey, (data: unknown) => React.ReactNode> = {
  "top-pools": renderTopPools,
  "recent-closes": renderRecentCloses,
  lessons: renderLessons,
  memory: renderMemory,
  "darwin-weights": renderDarwinWeights,
  autoresearch: renderAutoresearch,
  settings: renderSettings,
  briefing: renderBriefing,
  performance: renderPerformance,
};

export default function QuickActions({
  sendQuickAction,
  quickActionResult,
  clearQuickActionResult,
}: QuickActionsProps) {
  const [activeAction, setActiveAction] = useState<ActionKey | null>(null);
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback((action: ActionKey) => {
    setActiveAction(action);
    setLoading(true);
    sendQuickAction(action);
  }, [sendQuickAction]);

  const handleClose = useCallback(() => {
    setActiveAction(null);
    setLoading(false);
    clearQuickActionResult();
  }, [clearQuickActionResult]);

  const hasResult =
    quickActionResult != null &&
    activeAction != null &&
    quickActionResult.action === activeAction;

  useEffect(() => {
    if (hasResult && loading) {
      setLoading(false);
    }
  }, [hasResult, loading]);

  const dialogOpen = activeAction != null;

  return (
    <>
      <div className="flex flex-wrap gap-2 px-1">
        {ACTIONS.map((action) => (
          <button
            key={action.key}
            onClick={() => handleClick(action.key)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/4 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-cream/80 transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-200/20 hover:bg-amber-200/8 hover:text-cream hover:shadow-[0_8px_20px_rgba(255,209,102,0.1)] active:translate-y-0"
          >
            <span className="text-[14px] leading-none not-italic">{action.icon}</span>
            {action.label}
          </button>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
        <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col gap-0 p-0">
          <DialogHeader className="flex flex-row items-center justify-between border-b border-white/8 px-5 py-4">
            <DialogTitle>
              {activeAction ? ACTION_TITLES[activeAction] : ""}
            </DialogTitle>
            <DialogClose className="rounded-lg p-1.5 text-ash/60 transition-colors hover:bg-white/8 hover:text-cream">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </DialogClose>
          </DialogHeader>

          <ScrollArea className="flex-1 overflow-auto px-5 py-4" style={{ maxHeight: "calc(80vh - 72px)" }}>
            {loading ? (
              <div className="flex min-h-32 flex-col items-center justify-center gap-3">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-200/30 border-t-amber-200" />
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ash/50">
                  Loading...
                </span>
              </div>
            ) : quickActionResult?.error ? (
              <div className="flex min-h-24 items-center justify-center text-sm text-red-400">
                {quickActionResult.error}
              </div>
            ) : hasResult && activeAction ? (
              RENDERERS[activeAction](quickActionResult.data)
            ) : (
              <div className="flex min-h-32 flex-col items-center justify-center gap-3">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-200/30 border-t-amber-200" />
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ash/50">
                  Loading...
                </span>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
