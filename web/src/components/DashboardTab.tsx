import { useMemo, useState } from "react";
import type { PositionData, WalletData, LpOverviewData, QuickActionResult } from "../hooks/useWebSocket";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import PositionCard from "./PositionCard";
import QuickActions from "./QuickActions";

type StrategyStats = {
  trades?: number; wins?: number; losses?: number; win_rate_pct?: number;
  total_pnl_usd?: number; avg_pnl_pct?: number; avg_range_efficiency_pct?: number; avg_hold_min?: number;
};

type DailyEntry = { trades: number; wins: number; pnl_usd: number; pnl_sol?: number; win_rate_pct: number };
type TimeframeEntry = { trades: number; wins: number; losses: number; pnl_usd: number; pnl_sol?: number; win_rate_pct: number };

interface DashboardTabProps {
  positions: PositionData | null;
  wallet: WalletData | null;
  lpOverview: LpOverviewData | null;
  strategyBreakdown: Record<string, StrategyStats> | null;
  performanceExtra: { daily?: Record<string, DailyEntry>; timeframes?: Record<string, TimeframeEntry>; total_pnl_usd?: number } | null;
  sendQuickAction: (action: string) => void;
  quickActionResult: QuickActionResult | null;
  clearQuickActionResult: () => void;
  onCommand?: (text: string) => void;
}

export default function DashboardTab({ positions, wallet, lpOverview, strategyBreakdown, performanceExtra, sendQuickAction, quickActionResult, clearQuickActionResult, onCommand }: DashboardTabProps) {
  const [pnlTimeframe, setPnlTimeframe] = useState<"1d" | "7d" | "30d" | "all">("all");
  const [pnlUnit, setPnlUnit] = useState<"sol" | "usd">("sol");
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));

  const oorCount = useMemo(
    () => positions?.positions.filter((p) => !p.in_range).length ?? 0,
    [positions],
  );

  const inPositionsSol = useMemo(
    () => positions?.positions.reduce((s, p) => s + (p.total_value_sol ?? 0), 0) ?? 0,
    [positions],
  );

  const pnlForTimeframe = useMemo(() => {
    if (pnlTimeframe === "all") {
      if (!lpOverview) return null;
      return {
        sol: lpOverview.total_pnl_sol,
        usd: performanceExtra?.total_pnl_usd ?? lpOverview.total_pnl_usd ?? 0,
        trades: lpOverview.closed_positions,
        wr: lpOverview.win_rate_pct,
      };
    }
    const tf = performanceExtra?.timeframes?.[pnlTimeframe];
    if (!tf) return null;
    return { sol: tf.pnl_sol ?? 0, usd: tf.pnl_usd, trades: tf.trades, wr: tf.win_rate_pct };
  }, [pnlTimeframe, performanceExtra, lpOverview]);

  const dailyData = performanceExtra?.daily?.[selectedDate] ?? null;

  const shiftDate = (dir: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + dir);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-1">
        <Card className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-x-[-20%] top-0 h-px bg-gradient-to-r from-transparent via-amber-200/50 to-transparent" />
          <CardContent className="relative z-10 p-4">
            <div className="flex flex-col gap-4 rounded-[24px] border border-amber-200/8 bg-white/[0.03] p-5">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-200/72">
                    Portfolio Pulse
                  </span>
                  <div className="text-3xl font-semibold leading-none tracking-tight text-cream sm:text-4xl">
                    {wallet ? `${(wallet.sol + inPositionsSol).toFixed(2)} SOL` : <Skeleton className="h-10 w-36" />}
                  </div>
                </div>
                <Badge variant={oorCount > 0 ? "destructive" : "secondary"}>
                  {oorCount > 0 ? `${oorCount} OOR` : "Healthy"}
                </Badge>
              </div>

              {/* Wallet / In Positions / Total breakdown */}
              <div className="grid grid-cols-3 gap-3 border-t border-white/8 pt-3">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ash/56">Wallet</div>
                  <div className="mt-1 font-mono text-sm text-cream">{wallet ? wallet.sol.toFixed(2) : "--"}</div>
                </div>
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ash/56">In positions</div>
                  <div className="mt-1 font-mono text-sm text-cream">{inPositionsSol.toFixed(2)}</div>
                </div>
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ash/56">Total</div>
                  <div className="mt-1 font-mono text-sm text-cream">{wallet ? (wallet.sol + inPositionsSol).toFixed(2) : "--"} SOL</div>
                  <div className="font-mono text-[9px] text-ash/44">{wallet ? `$${(wallet.sol_usd + inPositionsSol * wallet.sol_price).toFixed(0)}` : ""}</div>
                </div>
              </div>

              {/* PnL with timeframe selector + unit toggle */}
              <div className="border-t border-white/8 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ash/56">Net PnL</div>
                    <div className="flex rounded-md border border-white/10 overflow-hidden">
                      <button type="button" onClick={() => setPnlUnit("sol")} className={`font-mono text-[9px] px-2 py-0.5 transition-colors ${pnlUnit === "sol" ? "bg-white/10 text-cream" : "text-ash/40 hover:text-cream"}`}>SOL</button>
                      <button type="button" onClick={() => setPnlUnit("usd")} className={`font-mono text-[9px] px-2 py-0.5 transition-colors ${pnlUnit === "usd" ? "bg-white/10 text-cream" : "text-ash/40 hover:text-cream"}`}>USD</button>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {(["1d", "7d", "30d", "all"] as const).map((tf) => (
                      <button
                        type="button"
                        key={tf}
                        onClick={() => setPnlTimeframe(tf)}
                        className={`font-mono text-[10px] px-2 py-0.5 rounded-md transition-colors ${pnlTimeframe === tf ? "bg-white/10 text-cream border border-white/15" : "text-ash/50 hover:text-cream"}`}
                      >
                        {tf.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                {pnlForTimeframe ? (() => {
                  const val = pnlUnit === "sol" ? pnlForTimeframe.sol : pnlForTimeframe.usd;
                  const fmt = pnlUnit === "sol" ? val.toFixed(4) : `$${val.toFixed(2)}`;
                  return (
                    <div className="flex items-baseline gap-3">
                      <span className={`font-mono text-2xl ${val >= 0 ? "text-emerald-300" : "text-red-400"}`}>
                        {val >= 0 ? "+" : ""}{fmt}
                      </span>
                      <span className="font-mono text-[10px] text-ash/50">{pnlUnit.toUpperCase()}</span>
                      <span className="font-mono text-[10px] text-ash/44">{pnlForTimeframe.trades} trades · {pnlForTimeframe.wr.toFixed(0)}% WR</span>
                    </div>
                  );
                })() : (
                  <Skeleton className="h-8 w-32" />
                )}
              </div>

              {/* Daily PnL calendar */}
              <div className="border-t border-white/8 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ash/56">Daily PnL</div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => shiftDate(-1)} className="text-ash/50 hover:text-cream text-sm px-1">◀</button>
                    <span className="font-mono text-[11px] text-cream/80 border border-white/10 rounded-md px-2 py-0.5">{selectedDate}</span>
                    <button type="button" onClick={() => shiftDate(1)} className="text-ash/50 hover:text-cream text-sm px-1">▶</button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-center">
                    <div className="font-mono text-[9px] uppercase text-ash/50">Trades</div>
                    <div className="font-mono text-sm text-cream mt-1">{dailyData?.trades ?? 0}</div>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-center">
                    <div className="font-mono text-[9px] uppercase text-ash/50">PnL</div>
                    <div className={`font-mono text-sm mt-1 ${((pnlUnit === "sol" ? dailyData?.pnl_sol : dailyData?.pnl_usd) ?? 0) >= 0 ? "text-emerald-300" : "text-red-400"}`}>
                      {dailyData ? (pnlUnit === "sol" ? `${(dailyData.pnl_sol ?? 0).toFixed(4)} SOL` : `$${dailyData.pnl_usd.toFixed(2)}`) : (pnlUnit === "sol" ? "0 SOL" : "$0.00")}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-center">
                    <div className="font-mono text-[9px] uppercase text-ash/50">WR</div>
                    <div className="font-mono text-sm text-cream mt-1">{dailyData?.win_rate_pct ?? 0}%</div>
                  </div>
                </div>
              </div>
            </div>

          </CardContent>
        </Card>

        {strategyBreakdown && Object.keys(strategyBreakdown).length > 0 && (() => {
          const stratKeys = Object.keys(strategyBreakdown);
          const rows: [string, (s: StrategyStats) => string][] = [
            ["Trades", (s) => String(s.trades ?? "--")],
            ["Win Rate", (s) => s.win_rate_pct != null ? `${s.win_rate_pct}%` : "--"],
            ["Total PnL", (s) => s.total_pnl_usd != null ? `$${s.total_pnl_usd.toFixed(2)}` : "--"],
            ["Avg PnL", (s) => s.avg_pnl_pct != null ? `${s.avg_pnl_pct.toFixed(2)}%` : "--"],
            ["Avg Hold", (s) => s.avg_hold_min != null ? `${s.avg_hold_min} min` : "--"],
            ["Range Eff", (s) => s.avg_range_efficiency_pct != null ? `${s.avg_range_efficiency_pct}%` : "--"],
            ["Losses", (s) => String(s.losses ?? "--")],
          ];
          return (
            <Card className="relative overflow-hidden">
              <div className="absolute inset-x-[-20%] top-0 h-px bg-gradient-to-r from-transparent via-teal/60 to-transparent" />
              <CardContent className="p-4">
                <div className="mb-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-200/72">
                    Strategy Breakdown
                  </span>
                  <div className="mt-1 text-base font-medium tracking-tight text-cream">
                    Performance by deployment strategy
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/8">
                        <th className="pb-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-ash/50" />
                        {stratKeys.map((k) => (
                          <th key={k} className="pb-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-ash/70">
                            {k.replace(/_/g, " ")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(([label, getter]) => (
                        <tr key={label} className="border-b border-white/5 last:border-0">
                          <td className="py-2 pr-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ash/60">{label}</td>
                          {stratKeys.map((k) => {
                            const val = getter(strategyBreakdown[k]);
                            const isWinRate = label === "Win Rate";
                            const isPnl = label === "Total PnL" || label === "Avg PnL";
                            let color = "text-cream/90";
                            if (isWinRate) {
                              const n = strategyBreakdown[k].win_rate_pct ?? 0;
                              color = n >= 80 ? "text-emerald-300" : n >= 60 ? "text-cream/90" : "text-red-400";
                            }
                            if (isPnl && val.startsWith("$-")) color = "text-red-400";
                            else if (isPnl && val.startsWith("$") && !val.startsWith("$0")) color = "text-emerald-300";
                            else if (isPnl && val.startsWith("-")) color = "text-red-400";
                            return (
                              <td key={k} className={`py-2 text-center font-mono text-sm ${color}`}>{val}</td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        <QuickActions
          sendQuickAction={sendQuickAction}
          quickActionResult={quickActionResult}
          clearQuickActionResult={clearQuickActionResult}
        />

        <div className="flex items-center justify-between px-1">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-200/70">
              Positions
            </span>
            <span className="text-base font-medium tracking-tight text-cream">
              Open range inventory
            </span>
            <span className="text-xs text-ash/56">
              Live PnL, fees, range state, and direct jump-outs to pool and token views.
            </span>
          </div>
          {positions && (
            <Badge variant="outline">
              {positions.total_positions} open
            </Badge>
          )}
        </div>

        {positions ? (
          positions.positions.length > 0 ? (
            <div className="flex flex-col gap-2">
              {positions.positions.map((p) => (
                <PositionCard key={p.position} position={p} onCommand={onCommand} screeningTimeframe={positions?.screening_config?.timeframe} screeningCategories={positions?.screening_config?.categories} />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex min-h-32 items-center justify-center text-sm text-ash/46">
                No open positions
              </CardContent>
            </Card>
          )
        ) : (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
