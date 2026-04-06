import { useMemo, useState, useEffect } from "react";
import type { PositionData, WalletData, LpOverviewData, QuickActionResult } from "../hooks/useWebSocket";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import PositionCard from "./PositionCard";
import QuickActions from "./QuickActions";

type PnlUnit = "sol" | "usd";
type Period = "1d" | "7d" | "30d" | "all";

interface PeriodStats {
  count: number;
  win_rate: number;
  net_pnl_sol: number;
  net_pnl_usd: number;
  total_fees_sol: number;
}

interface DashboardTabProps {
  positions: PositionData | null;
  wallet: WalletData | null;
  lpOverview: LpOverviewData | null;
  sendQuickAction: (action: string) => void;
  quickActionResult: QuickActionResult | null;
  clearQuickActionResult: () => void;
  onCommand?: (cmd: string) => void;
}

function periodCutoff(period: Period): number {
  const now = Date.now();
  if (period === "1d") return now - 86400_000;
  if (period === "7d") return now - 7 * 86400_000;
  if (period === "30d") return now - 30 * 86400_000;
  return 0;
}

export default function DashboardTab({
  positions, wallet, lpOverview,
  sendQuickAction, quickActionResult, clearQuickActionResult,
  onCommand,
}: DashboardTabProps) {
  const [pnlUnit, setPnlUnit] = useState<PnlUnit>("sol");
  const [period, setPeriod] = useState<Period>("all");
  const [perfData, setPerfData] = useState<Record<string, unknown> | null>(null);

  const oorCount = useMemo(() => positions?.positions.filter((p) => !p.in_range).length ?? 0, [positions]);

  // Total portfolio = wallet + position values
  const positionsValueSol = useMemo(() => positions?.positions.reduce((s, p) => s + (p.total_value_sol ?? 0), 0) ?? 0, [positions]);
  const positionsValueUsd = useMemo(() => positions?.positions.reduce((s, p) => s + (p.total_value_usd ?? 0), 0) ?? 0, [positions]);
  const totalPortfolioSol = wallet ? wallet.sol + positionsValueSol : null;
  const totalPortfolioUsd = wallet ? wallet.sol_usd + positionsValueUsd : null;

  // Auto-fetch performance data once for period filtering
  useEffect(() => {
    sendQuickAction("performance");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (quickActionResult?.action === "performance" && quickActionResult.data) {
      setPerfData(quickActionResult.data as Record<string, unknown>);
    }
  }, [quickActionResult]);

  // Period-filtered stats from recent_closes
  const periodStats = useMemo<PeriodStats | null>(() => {
    if (!perfData) return null;
    const closes = Array.isArray(perfData.recent_closes) ? perfData.recent_closes as Record<string, unknown>[] : [];
    const cutoff = periodCutoff(period);
    const filtered = period === "all" ? closes : closes.filter((c) => {
      const ts = c.deployed_at ? new Date(c.deployed_at as string).getTime() : 0;
      return ts >= cutoff;
    });
    if (filtered.length === 0) return period === "all" ? null : { count: 0, win_rate: 0, net_pnl_sol: 0, net_pnl_usd: 0, total_fees_sol: 0 };
    const wins = filtered.filter((c) => Number(c.pnl_usd ?? 0) > 0).length;
    return {
      count: filtered.length,
      win_rate: Math.round((wins / filtered.length) * 100),
      net_pnl_usd: filtered.reduce((s, c) => s + Number(c.pnl_usd ?? 0), 0),
      net_pnl_sol: filtered.reduce((s, c) => {
        // pnl_pct is SOL-denominated; amount_sol * pnl_pct / 100 gives SOL PnL
        const amt = Number((c as Record<string, unknown>).amount_sol ?? 0);
        const pct = Number(c.pnl_pct ?? 0);
        return s + (amt * pct / 100);
      }, 0),
      total_fees_sol: 0,
    };
  }, [perfData, period, wallet]);

  // Use period stats when available, fall back to lpOverview
  const showPeriodStats = period !== "all" && periodStats !== null;
  const netPnl = showPeriodStats
    ? (pnlUnit === "sol" ? periodStats!.net_pnl_sol : periodStats!.net_pnl_usd)
    : (pnlUnit === "sol" ? lpOverview?.total_pnl_sol : lpOverview?.total_pnl_usd);
  const winRate = showPeriodStats ? periodStats!.win_rate : lpOverview?.win_rate_pct;
  const closedCount = showPeriodStats ? periodStats!.count : lpOverview?.closed_positions;
  const totalFees = pnlUnit === "sol" ? lpOverview?.total_fees_sol : lpOverview?.total_fees_usd;

  const pnlDisplay = netPnl != null
    ? pnlUnit === "sol" ? `${netPnl >= 0 ? "+" : ""}${netPnl.toFixed(3)} SOL` : `${netPnl >= 0 ? "+" : ""}$${Math.abs(netPnl).toFixed(2)}`
    : null;
  const feesDisplay = totalFees != null
    ? pnlUnit === "sol" ? `${totalFees.toFixed(4)} SOL` : `$${totalFees.toFixed(2)}`
    : null;

  const PERIODS: Period[] = ["1d", "7d", "30d", "all"];

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-1">

        {/* Portfolio card */}
        <Card className="relative overflow-hidden">
          <div className="absolute inset-x-[-20%] top-0 h-px bg-gradient-to-r from-transparent via-amber-200/80 to-transparent pointer-events-none" />
          <div className="absolute -left-10 top-10 h-36 w-36 rounded-full bg-[radial-gradient(circle,rgba(255,209,102,0.16),transparent_72%)] pointer-events-none" />
          <CardContent className="relative z-10 p-3 lg:p-4">
            <div className="rounded-2xl border border-amber-200/12 bg-[linear-gradient(180deg,rgba(255,209,102,0.1),rgba(255,209,102,0.02))] p-4">

              {/* Top row */}
              <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-200/72">Portfolio Pulse</span>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Period filter */}
                  <div className="flex rounded-lg border border-white/10 overflow-hidden">
                    {PERIODS.map((p) => (
                      <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className={`px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider transition-colors cursor-pointer select-none ${period === p ? "bg-amber-300/15 text-amber-200" : "text-ash/50 hover:text-ash/80"}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  {/* PnL unit toggle */}
                  <div className="flex rounded-lg border border-white/10 overflow-hidden">
                    {(["sol", "usd"] as PnlUnit[]).map((u) => (
                      <button
                        key={u}
                        onClick={() => setPnlUnit(u)}
                        className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer select-none ${pnlUnit === u ? "bg-amber-300/15 text-amber-200" : "text-ash/50 hover:text-ash/80"}`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                  <Badge variant={oorCount > 0 ? "destructive" : "secondary"}>
                    {oorCount > 0 ? `${oorCount} OOR` : "Healthy"}
                  </Badge>
                </div>
              </div>

              {/* Total portfolio value */}
              <div className="mb-3">
                <div className="text-2xl font-semibold leading-none tracking-tight text-cream lg:text-3xl">
                  {totalPortfolioSol != null
                    ? pnlUnit === "sol" ? `${totalPortfolioSol.toFixed(3)} SOL` : `$${totalPortfolioUsd!.toFixed(0)}`
                    : <Skeleton className="h-8 w-32" />}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-cream/50">
                  {wallet ? (
                    <>
                      <span>Wallet: <span className="text-cream/70">{pnlUnit === "sol" ? `${wallet.sol.toFixed(3)} SOL` : `$${wallet.sol_usd.toFixed(0)}`}</span></span>
                      <span>Positions: <span className="text-cream/70">{pnlUnit === "sol" ? `${positionsValueSol.toFixed(3)} SOL` : `$${positionsValueUsd.toFixed(0)}`}</span></span>
                      <span className="text-cream/35">@ ${wallet.sol_price.toFixed(0)}/SOL</span>
                    </>
                  ) : (
                    <Skeleton className="h-3 w-40" />
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <MiniStat label={`Net PnL ${period !== "all" ? `(${period})` : ""}`} value={pnlDisplay ?? "--"} color={netPnl != null && netPnl >= 0 ? "text-emerald-300" : "text-red-400"} />
                <MiniStat label="Fees earned" value={feesDisplay ?? "--"} color="text-amber-200" />
                <MiniStat label="Win rate" value={winRate != null ? `${winRate.toFixed(0)}%` : "--"} />
                <MiniStat label="Closed" value={closedCount != null ? String(closedCount) : "--"} />
              </div>
            </div>
          </CardContent>
        </Card>

        <QuickActions sendQuickAction={sendQuickAction} quickActionResult={quickActionResult} clearQuickActionResult={clearQuickActionResult} />

        {/* Positions */}
        <div className="flex items-center justify-between px-1">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-200/70">Positions</span>
            <span className="text-sm font-medium tracking-tight text-cream">Open Range Inventory</span>
          </div>
          {positions && <Badge variant="outline">{positions.total_positions} open</Badge>}
        </div>

        {positions ? (
          positions.positions.length > 0 ? (
            <div className="flex flex-col gap-2">
              {positions.positions.map((p) => (
                <PositionCard key={p.position} position={p} onCommand={onCommand} />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex min-h-24 items-center justify-center text-sm text-ash/46">
                No open positions
              </CardContent>
            </Card>
          )
        ) : (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-44 w-full rounded-2xl" />
            <Skeleton className="h-44 w-full rounded-2xl" />
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function MiniStat({ label, value, color = "text-cream" }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl bg-black/20 px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ash/50 mb-0.5">{label}</div>
      <div className={`font-mono text-[13px] font-semibold ${color}`}>{value}</div>
    </div>
  );
}
