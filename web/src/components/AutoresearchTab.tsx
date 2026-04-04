import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

// ─── Types ───────────────────────────────────────────────────────────
interface ExperimentBaseline {
  win_rate: number;
  avg_pnl_pct: number;
  positions: number;
}

interface Experiment {
  id: string;
  section: string;
  hypothesis: string;
  status: "kept" | "reverted" | "inconclusive" | "running";
  started_at: string;
  baseline: ExperimentBaseline;
  trial: ExperimentBaseline;
  original_text?: string;
  modified_text?: string;
  weights_at_start?: Record<string, number>;
}

interface AutoresearchData {
  enabled: boolean;
  experiments: Experiment[];
  active: Experiment | null;
  cooldownRemaining: number;
  kept_overrides: Record<string, string>;
}

// ─── Sub-views ───────────────────────────────────────────────────────
type SubView = "overview" | "experiments" | "patterns";

// ─── Helpers ─────────────────────────────────────────────────────────
function statusLabel(s: string) {
  if (s === "kept") return "KEPT";
  if (s === "reverted") return "REVERTED";
  if (s === "running") return "RUNNING";
  return "INCONCLUSIVE";
}

function statusClasses(s: string) {
  if (s === "kept") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/20";
  if (s === "reverted") return "bg-red-400/15 text-red-300 border-red-400/20";
  if (s === "running") return "bg-amber-400/15 text-amber-300 border-amber-400/20 animate-subtle-glow";
  return "bg-steel/15 text-steel border-steel/20";
}

function formatSection(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function delta(baseline: number | null, trial: number | null): { value: string; positive: boolean } | null {
  if (baseline == null || trial == null) return null;
  const d = trial - baseline;
  return { value: `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`, positive: d >= 0 };
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) +
    " " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

// ─── Component ───────────────────────────────────────────────────────
export default function AutoresearchTab() {
  const [data, setData] = useState<AutoresearchData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subView, setSubView] = useState<SubView>("overview");
  const [expandedExp, setExpandedExp] = useState<string | null>(null);

  // Fetch from /api/autoresearch
  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await fetch("/api/autoresearch");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) { setData(json); setError(null); }
      } catch (err: unknown) {
        if (!cancelled) setError((err as Error).message);
      }
    };
    fetchData();
    const id = setInterval(fetchData, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Computed stats
  const stats = useMemo(() => {
    if (!data) return null;
    const exps = data.experiments;
    const kept = exps.filter((e) => e.status === "kept").length;
    const reverted = exps.filter((e) => e.status === "reverted").length;
    const inconclusive = exps.filter((e) => e.status !== "kept" && e.status !== "reverted" && e.status !== "running").length;
    const last10 = exps.slice(-10);
    const last10Kept = last10.filter((e) => e.status === "kept").length;
    const avgWrImprovement = exps
      .filter((e) => e.status === "kept" && e.trial?.win_rate != null && e.baseline?.win_rate != null)
      .reduce((acc, e) => acc + (e.trial.win_rate - e.baseline.win_rate), 0) /
      (exps.filter((e) => e.status === "kept").length || 1);
    return { total: exps.length, kept, reverted, inconclusive, last10Kept, last10Total: last10.length, avgWrImprovement };
  }, [data]);

  // Key patterns (derived from data)
  const patterns = useMemo(() => {
    if (!data) return [];
    const exps = data.experiments;
    const lines: { text: string; type: "positive" | "warning" | "neutral" }[] = [];

    const last10 = exps.slice(-10);
    const k = last10.filter((e) => e.status === "kept").length;
    const r = last10.filter((e) => e.status === "reverted").length;
    const i = last10.length - k - r;
    lines.push({ text: `${k} kept, ${r} reverted, ${i} inconclusive in the last 10`, type: "neutral" });

    // Find recurring kept themes
    const keptHypotheses = exps.filter((e) => e.status === "kept").map((e) => e.hypothesis.toLowerCase());
    if (keptHypotheses.some((h) => h.includes("mid-pump") || h.includes("mid-rally") || h.includes("appreciation gate"))) {
      lines.push({ text: "System consistently learning to avoid mid-pump entries", type: "positive" });
    }
    if (keptHypotheses.some((h) => h.includes("cooldown") || h.includes("oor"))) {
      lines.push({ text: "Cooldown & OOR management rules proving effective", type: "positive" });
    }

    // Find reverted patterns
    const revertedHypotheses = exps.filter((e) => e.status === "reverted").map((e) => e.hypothesis.toLowerCase());
    if (revertedHypotheses.some((h) => h.includes("tighten") || h.includes("aggressive"))) {
      lines.push({ text: "Over-tightening thresholds consistently gets reverted", type: "warning" });
    }

    // Active experiment
    if (data.active) {
      lines.push({ text: `Active experiment running: ${data.active.hypothesis.slice(0, 80)}...`, type: "neutral" });
    } else if (data.cooldownRemaining > 0) {
      lines.push({ text: `Cooldown: ${data.cooldownRemaining} closes until next experiment`, type: "neutral" });
    }

    // Kept overrides count
    const overrideCount = Object.keys(data.kept_overrides).length;
    if (overrideCount > 0) {
      lines.push({ text: `${overrideCount} prompt section(s) permanently modified by kept experiments`, type: "positive" });
    }

    return lines;
  }, [data]);

  if (error) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="text-center">
          <div className="font-mono text-xs text-red-300/80">Autoresearch unavailable</div>
          <div className="mt-1 text-[11px] text-ash/46">{error}</div>
        </div>
      </div>
    );
  }

  if (!data || !stats) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="font-mono text-xs text-ash/46 animate-pulse">Loading autoresearch data...</div>
      </div>
    );
  }

  const subViews: { key: SubView; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "experiments", label: `Experiments (${stats.total})` },
    { key: "patterns", label: "Patterns" },
  ];

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-1">

        {/* ─── HEADER CARD ─── */}
        <Card className="relative overflow-hidden">
          <div className="absolute inset-x-[-20%] top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/60 to-transparent" />
          <div className="absolute -left-10 top-10 h-36 w-36 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.12),transparent_72%)]" />
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-300/70">
                  Autoresearch
                </span>
                <span className="text-xl font-semibold tracking-tight text-cream">
                  Prompt Evolution
                </span>
                <span className="text-sm text-cream/70">
                  {stats.total} experiments completed · {stats.kept} kept · {((stats.kept / stats.total) * 100).toFixed(0)}% adoption
                </span>
              </div>
              <Badge variant={data.active ? "destructive" : data.enabled ? "secondary" : "outline"}>
                {data.active ? "running" : data.enabled ? "enabled" : "paused"}
              </Badge>
            </div>

            {/* Quick stats */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Total", value: stats.total, color: "text-cream" },
                { label: "Kept", value: stats.kept, color: "text-emerald-300" },
                { label: "Reverted", value: stats.reverted, color: "text-red-300" },
                { label: "Avg WR↑", value: `+${stats.avgWrImprovement.toFixed(0)}%`, color: "text-emerald-300" },
              ].map((s) => (
                <div key={s.label} className="flex flex-col items-center rounded-xl border border-white/6 bg-white/[0.03] px-2 py-2.5">
                  <span className={`font-mono text-lg font-semibold ${s.color}`}>{s.value}</span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ash/50">{s.label}</span>
                </div>
              ))}
            </div>

            {/* Success bar */}
            <div className="mt-3 flex gap-0.5 overflow-hidden rounded-lg" style={{ height: 6 }}>
              <div className="bg-emerald-400/80" style={{ flex: stats.kept }} />
              <div className="bg-red-400/60" style={{ flex: stats.reverted }} />
              {stats.inconclusive > 0 && <div className="bg-steel/40" style={{ flex: stats.inconclusive }} />}
            </div>
          </CardContent>
        </Card>

        {/* ─── SUB-VIEW SELECTOR ─── */}
        <div className="flex gap-1 rounded-xl border border-white/6 bg-white/[0.02] p-1">
          {subViews.map((sv) => (
            <button
              key={sv.key}
              onClick={() => setSubView(sv.key)}
              className={`flex-1 rounded-lg px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-all ${
                subView === sv.key
                  ? "bg-teal/60 text-cream shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
                  : "text-ash/50 hover:text-ash/70"
              }`}
            >
              {sv.label}
            </button>
          ))}
        </div>

        {/* ─── OVERVIEW ─── */}
        {subView === "overview" && (
          <>
            {/* Active experiment */}
            {data.active && (
              <Card className="border-amber-400/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-200/70">
                      Active Experiment
                    </span>
                  </div>
                  <p className="text-sm text-cream/86 leading-relaxed">{data.active.hypothesis}</p>
                  <div className="mt-2 flex gap-3 text-[11px]">
                    <span className="text-ash/50">Section: <span className="text-steel">{formatSection(data.active.section)}</span></span>
                    <span className="text-ash/50">Since: <span className="text-steel">{formatDate(data.active.started_at)}</span></span>
                  </div>
                  {data.active.baseline && (
                    <div className="mt-2 flex gap-4 text-[11px]">
                      <span className="text-ash/50">Baseline WR: <span className="text-cream">{data.active.baseline.win_rate}%</span></span>
                      <span className="text-ash/50">Baseline PnL: <span className="text-cream">{data.active.baseline.avg_pnl_pct}%</span></span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Cooldown */}
            {!data.active && data.cooldownRemaining > 0 && (
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="h-2 w-2 rounded-full bg-steel/60" />
                  <span className="text-sm text-ash/70">
                    Cooldown: <span className="font-mono text-cream">{data.cooldownRemaining}</span> closes until next experiment
                  </span>
                </CardContent>
              </Card>
            )}

            {/* Recent 5 experiments */}
            <div className="flex items-center justify-between px-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash/58">
                Recent Experiments
              </span>
              <button onClick={() => setSubView("experiments")} className="font-mono text-[10px] text-steel hover:text-cream transition-colors">
                View all →
              </button>
            </div>
            {data.experiments.slice(-5).reverse().map((exp) => (
              <ExperimentCard key={exp.id} exp={exp} expanded={expandedExp === exp.id} onToggle={() => setExpandedExp(expandedExp === exp.id ? null : exp.id)} />
            ))}
          </>
        )}

        {/* ─── EXPERIMENTS LIST ─── */}
        {subView === "experiments" && (
          <>
            {data.experiments.slice().reverse().map((exp) => (
              <ExperimentCard key={exp.id} exp={exp} expanded={expandedExp === exp.id} onToggle={() => setExpandedExp(expandedExp === exp.id ? null : exp.id)} />
            ))}
          </>
        )}

        {/* ─── PATTERNS ─── */}
        {subView === "patterns" && (
          <>
            {patterns.map((p, i) => (
              <Card key={i}>
                <CardContent className="flex items-start gap-3 p-4">
                  <div className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${
                    p.type === "positive" ? "bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.4)]" :
                    p.type === "warning" ? "bg-red-400 shadow-[0_0_6px_rgba(244,63,94,0.4)]" :
                    "bg-steel/60"
                  }`} />
                  <span className="text-sm text-cream/80 leading-relaxed">{p.text}</span>
                </CardContent>
              </Card>
            ))}

            {/* Kept overrides */}
            {Object.keys(data.kept_overrides).length > 0 && (
              <>
                <div className="px-1 pt-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash/58">
                    Active Prompt Overrides
                  </span>
                </div>
                {Object.entries(data.kept_overrides).map(([section]) => (
                  <Card key={section}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        <span className="font-mono text-xs text-emerald-300/80">{formatSection(section)}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-ash/46">
                        Prompt section modified by kept experiment(s)
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  );
}

// ─── Experiment Card ─────────────────────────────────────────────────
function ExperimentCard({ exp, expanded, onToggle }: { exp: Experiment; expanded: boolean; onToggle: () => void }) {
  const wrDelta = delta(exp.baseline?.win_rate, exp.trial?.win_rate);
  const pnlDelta = delta(exp.baseline?.avg_pnl_pct, exp.trial?.avg_pnl_pct);

  return (
    <Card className="cursor-pointer transition-all hover:border-white/12" onClick={onToggle}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${statusClasses(exp.status)}`}>
                {statusLabel(exp.status)}
              </span>
              <span className="font-mono text-[10px] text-ash/40">{formatSection(exp.section)}</span>
            </div>
            <p className="text-[13px] text-cream/86 leading-relaxed line-clamp-2">{exp.hypothesis}</p>
          </div>
        </div>

        {/* Metrics row */}
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
          {exp.baseline?.win_rate != null && exp.trial?.win_rate != null && (
            <div className="text-[11px]">
              <span className="text-ash/46">WR </span>
              <span className="text-ash/60">{exp.baseline.win_rate}%</span>
              <span className="text-ash/30"> → </span>
              <span className={`font-medium ${wrDelta?.positive ? "text-emerald-300" : "text-red-300"}`}>
                {exp.trial.win_rate}%
              </span>
              {wrDelta && (
                <span className={`ml-1 text-[10px] ${wrDelta.positive ? "text-emerald-400/60" : "text-red-400/60"}`}>
                  ({wrDelta.value})
                </span>
              )}
            </div>
          )}
          {exp.baseline?.avg_pnl_pct != null && exp.trial?.avg_pnl_pct != null && (
            <div className="text-[11px]">
              <span className="text-ash/46">PnL </span>
              <span className="text-ash/60">{exp.baseline.avg_pnl_pct}%</span>
              <span className="text-ash/30"> → </span>
              <span className={`font-medium ${pnlDelta?.positive ? "text-emerald-300" : "text-red-300"}`}>
                {exp.trial.avg_pnl_pct}%
              </span>
              {pnlDelta && (
                <span className={`ml-1 text-[10px] ${pnlDelta.positive ? "text-emerald-400/60" : "text-red-400/60"}`}>
                  ({pnlDelta.value})
                </span>
              )}
            </div>
          )}
          <div className="text-[11px] text-ash/36">{formatDate(exp.started_at)}</div>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div className="mt-3 border-t border-white/6 pt-3 space-y-2">
            <div className="text-[11px] text-ash/46">
              <span className="text-ash/60">Positions evaluated:</span> {exp.trial?.positions ?? "—"} trial vs {exp.baseline?.positions ?? "—"} baseline
            </div>
            {exp.weights_at_start && (
              <div>
                <span className="text-[10px] text-ash/40 font-mono uppercase tracking-wide">Signal weights at start</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(exp.weights_at_start).map(([k, v]) => (
                    <span key={k} className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] text-ash/50">
                      {k}: {(v as number).toFixed(2)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
