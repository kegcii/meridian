import { memo, useState } from "react";
import type { PositionInfo } from "../hooks/useWebSocket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import BinRangeChart from "./BinRangeChart";

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

function getMeteoraPoolUrl(pool: string) {
  return `https://meteora.ag/dlmm/${pool}`;
}
function getOrbTokenUrl(mint: string) {
  return `https://orbmarkets.io/token/${mint}`;
}
function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hrs = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hrs < 24) return `${hrs}h ${rem}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

interface PositionCardProps {
  position: PositionInfo;
  onCommand?: (cmd: string) => void;
}

function PositionCardInner({ position, onCommand }: PositionCardProps) {
  const [unit, setUnit] = useState<"sol" | "usd">("sol");
  const [confirming, setConfirming] = useState<"close" | "rebalance" | null>(null);

  const {
    position: addr, pair, pool, base_mint, in_range,
    pnl_pct, pnl_usd, pnl_sol,
    unclaimed_fees_sol, unclaimed_fees_usd,
    collected_fees_sol, collected_fees_usd,
    total_value_usd, total_value_sol,
    age_minutes, active_bin, lower_bin, upper_bin,
    bin_step, volatility, strategy,
    oor_direction, minutes_out_of_range,
  } = position;

  const canOpenToken = Boolean(base_mint && typeof base_mint === "string" && base_mint !== WRAPPED_SOL_MINT);
  const binCount = (lower_bin != null && upper_bin != null) ? upper_bin - lower_bin : null;

  // PnL display: value + % in parens
  const pnlMain = unit === "sol"
    ? (pnl_sol != null ? `${pnl_sol >= 0 ? "+" : ""}${pnl_sol.toFixed(4)} SOL` : "--")
    : (pnl_usd != null ? `${pnl_usd >= 0 ? "+" : ""}$${Math.abs(pnl_usd).toFixed(2)}` : "--");
  const pnlSuffix = `(${pnl_pct >= 0 ? "+" : ""}${pnl_pct.toFixed(1)}%)`;
  const pnlColor = pnl_pct >= 0 ? "text-emerald-400" : "text-red-400";

  // Fees
  const feesUnclaimed = unit === "sol"
    ? (unclaimed_fees_sol != null ? `${unclaimed_fees_sol.toFixed(4)} SOL` : "--")
    : (unclaimed_fees_usd != null ? `$${unclaimed_fees_usd.toFixed(2)}` : "--");

  const feesCollected = unit === "sol"
    ? (collected_fees_sol != null ? `${collected_fees_sol.toFixed(4)} SOL` : null)
    : (collected_fees_usd != null ? `$${collected_fees_usd.toFixed(2)}` : null);

  const tvl = unit === "sol"
    ? (total_value_sol != null ? `${total_value_sol.toFixed(3)} SOL` : "--")
    : (total_value_usd != null ? `$${total_value_usd.toFixed(0)}` : "--");

  // Hourly yield: (unclaimed + collected fees) / TVL / age_hours * 100
  let yieldDisplay: string | null = null;
  if (age_minutes && age_minutes > 0) {
    const totalFeesSol = (unclaimed_fees_sol ?? 0) + (collected_fees_sol ?? 0);
    const tvlSol = total_value_sol ?? 0;
    if (tvlSol > 0 && totalFeesSol >= 0) {
      const hourlyYield = (totalFeesSol / tvlSol) / (age_minutes / 60) * 100;
      yieldDisplay = `${hourlyYield.toFixed(3)}%/h`;
    }
  }

  // OOR / in-range time
  const oorMinutes = minutes_out_of_range ?? 0;
  const inRangeMinutes = age_minutes != null ? Math.max(0, age_minutes - oorMinutes) : null;
  const timeLabel = in_range
    ? (inRangeMinutes != null ? `In range ${formatAge(inRangeMinutes)}` : "In range")
    : (oorMinutes > 0 ? `OOR ${formatAge(oorMinutes)}` : "OOR");

  const handleAction = (action: "close" | "rebalance") => {
    if (confirming === action) {
      onCommand?.(action === "close"
        ? `close position ${addr}`
        : `rebalance position ${addr}`);
      setConfirming(null);
    } else {
      setConfirming(action);
      setTimeout(() => setConfirming(null), 3000);
    }
  };

  return (
    <div className={`group rounded-2xl border bg-[linear-gradient(180deg,rgba(18,69,89,0.2),rgba(3,29,38,0.5))] p-3 text-xs shadow-[0_12px_26px_rgba(0,0,0,0.14)] transition-all duration-200 active:scale-[0.99] lg:rounded-[22px] lg:hover:-translate-y-0.5 ${in_range ? "border-emerald-300/18" : "border-red-400/26"}`}>

      {/* Header row */}
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px] font-semibold text-cream">{pair}</span>
            {strategy && (
              <span className="rounded bg-steel/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ash/70">{strategy}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-[11px]">
              <a href={getMeteoraPoolUrl(pool)} target="_blank" rel="noreferrer">Pool ↗</a>
            </Button>
            {canOpenToken && (
              <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-[11px]">
                <a href={getOrbTokenUrl(base_mint as string)} target="_blank" rel="noreferrer">Token ↗</a>
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={in_range ? "outline" : "destructive"} className="shrink-0">
            {in_range ? "IN RANGE" : `OOR${oor_direction === "upside" ? " ↑" : oor_direction === "downside" ? " ↓" : ""}`}
          </Badge>
          <span className={`font-mono text-[10px] ${in_range ? "text-emerald-300/70" : "text-red-400/70"}`}>
            {timeLabel}
          </span>
        </div>
      </div>

      {/* PnL section with unit toggle */}
      <div className="mb-2 flex items-center justify-between rounded-xl bg-white/4 px-3 py-2">
        <div>
          <span className="block text-[9px] text-ash/60 mb-0.5">PnL</span>
          <span className={`font-mono text-[15px] font-semibold ${pnlColor}`}>{pnlMain}</span>
          <span className={`ml-1.5 font-mono text-[11px] ${pnlColor} opacity-70`}>{pnlSuffix}</span>
        </div>
        <div className="flex items-center gap-2">
          {yieldDisplay && (
            <span className="rounded-md bg-amber-300/10 px-2 py-0.5 font-mono text-[10px] text-amber-200">
              {yieldDisplay}
            </span>
          )}
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            {(["sol", "usd"] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={`px-2 py-1 font-mono text-[9px] uppercase tracking-wider transition-colors ${unit === u ? "bg-white/12 text-cream" : "text-ash/40 hover:text-ash/70"}`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        <Stat label="Unclaimed" value={feesUnclaimed} amber />
        {feesCollected && <Stat label="Collected" value={feesCollected} />}
        <Stat label="TVL" value={tvl} />
        {age_minutes != null && <Stat label="Age" value={formatAge(age_minutes)} />}
        {binCount != null && lower_bin != null && upper_bin != null && (
          <div className="col-span-2 rounded-lg bg-white/4 px-2 py-1.5">
            <span className="block text-[9px] text-ash/60 mb-0.5">Bin Range</span>
            <span className="font-mono text-[10px] text-cream">{lower_bin} → {upper_bin}</span>
            <span className="font-mono text-[10px] text-ash/50"> ({binCount} bins{bin_step ? `, bs${bin_step}` : ""})</span>
          </div>
        )}
        {volatility != null && <Stat label="Volatility" value={volatility.toFixed(1)} />}
      </div>

      {/* Bin range chart */}
      {lower_bin != null && upper_bin != null && active_bin != null ? (
        <div className="mb-2">
          <BinRangeChart lowerBin={lower_bin} upperBin={upper_bin} activeBin={active_bin} inRange={in_range} strategy={position.strategy} />
        </div>
      ) : null}

      {/* Action buttons */}
      {onCommand && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => handleAction("rebalance")}
            className={`flex-1 rounded-xl border py-2 font-mono text-[10px] uppercase tracking-wider transition-all ${
              confirming === "rebalance"
                ? "border-amber-300/40 bg-amber-300/12 text-amber-200"
                : "border-white/10 bg-white/4 text-ash/60 hover:border-amber-300/20 hover:bg-amber-300/6 hover:text-amber-200"
            }`}
          >
            {confirming === "rebalance" ? "⚡ Confirm rebalance" : "⚡ Rebalance"}
          </button>
          <button
            onClick={() => handleAction("close")}
            className={`flex-1 rounded-xl border py-2 font-mono text-[10px] uppercase tracking-wider transition-all ${
              confirming === "close"
                ? "border-red-400/40 bg-red-400/12 text-red-300"
                : "border-white/10 bg-white/4 text-ash/60 hover:border-red-400/20 hover:bg-red-400/6 hover:text-red-300"
            }`}
          >
            {confirming === "close" ? "✕ Confirm close" : "✕ Close"}
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, amber }: { label: string; value: string; amber?: boolean }) {
  return (
    <div className={`rounded-lg px-2 py-1.5 ${amber ? "border border-amber-300/10 bg-amber-300/6" : "bg-white/4"}`}>
      <span className="block text-[9px] text-ash/60 mb-0.5">{label}</span>
      <span className={`font-mono text-[11px] font-medium ${amber ? "text-amber-200" : "text-cream"}`}>{value}</span>
    </div>
  );
}

const PositionCard = memo(PositionCardInner, (prev, next) =>
  prev.position.pnl_pct === next.position.pnl_pct &&
  prev.position.in_range === next.position.in_range &&
  prev.position.unclaimed_fees_sol === next.position.unclaimed_fees_sol &&
  prev.position.active_bin === next.position.active_bin &&
  prev.onCommand === next.onCommand
);

export default PositionCard;
