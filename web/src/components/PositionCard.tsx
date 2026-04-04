import { memo, useState, useCallback } from "react";
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
  const remainMins = minutes % 60;
  if (hrs < 24) return `${hrs}h ${remainMins}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function PositionCardInner({ position, onCommand, screeningTimeframe, screeningCategories }: { position: PositionInfo; onCommand?: (text: string) => void; screeningTimeframe?: string; screeningCategories?: string[] }) {
  const { pair, pool, base_mint, in_range, pnl_pct, unclaimed_fees_sol, unclaimed_fees_usd, age_minutes, active_bin, lower_bin, upper_bin } = position;
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const handleClose = useCallback(() => {
    if (!confirmClose) {
      setConfirmClose(true);
      setTimeout(() => setConfirmClose(false), 5000); // reset after 5s
      return;
    }
    if (!onCommand) return;
    setClosing(true);
    onCommand(`close my ${pair} position`);
    setTimeout(() => { setClosing(false); setConfirmClose(false); }, 10000);
  }, [confirmClose, onCommand, pair]);

  const pnlColor = pnl_pct >= 0 ? "text-emerald-400" : "text-red-400";
  const fees = unclaimed_fees_sol != null ? `${unclaimed_fees_sol.toFixed(4)} SOL` : unclaimed_fees_usd != null ? `$${unclaimed_fees_usd.toFixed(2)}` : "--";
  const canOpenToken = Boolean(base_mint && base_mint !== WRAPPED_SOL_MINT);

  return (
    <div className={`group rounded-[22px] border bg-[linear-gradient(180deg,rgba(18,69,89,0.2),rgba(3,29,38,0.5))] p-3 text-xs shadow-[0_12px_26px_rgba(0,0,0,0.14)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_34px_rgba(0,0,0,0.2)] ${in_range ? "border-emerald-300/18" : "border-red-400/26"}`}>
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] font-medium text-cream">{pair}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash/44 transition-colors group-hover:text-ash/68">
              Quick links
            </span>
          </div>
          <div className="flex flex-wrap gap-2 opacity-88 transition-opacity group-hover:opacity-100">
            <Button asChild size="sm" variant="outline">
              <a href={getMeteoraPoolUrl(pool)} target="_blank" rel="noreferrer">
                Pool
              </a>
            </Button>
            {canOpenToken && (
              <Button asChild size="sm" variant="outline">
                <a href={getOrbTokenUrl(base_mint!)} target="_blank" rel="noreferrer">
                  Token
                </a>
              </Button>
            )}
            {onCommand && (
              <Button
                size="sm"
                variant={confirmClose ? "secondary" : "outline"}
                onClick={handleClose}
                disabled={closing}
              >
                {closing ? "Closing..." : confirmClose ? "Confirm Close" : "Close"}
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={in_range ? "outline" : "destructive"}>
            {in_range ? "IN RANGE" : `OOR${position.oor_direction ? ` ${position.oor_direction}` : ""}`}
          </Badge>
          {!in_range && position.minutes_out_of_range != null && position.minutes_out_of_range > 0 && (
            <span className="font-mono text-[9px] text-red-400/70">{position.minutes_out_of_range}m OOR</span>
          )}
          {in_range && age_minutes != null && (
            <span className="font-mono text-[9px] text-emerald-300/50">in range {formatAge(age_minutes)}</span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div>
          <span className="block text-[10px] text-ash">Value</span>
          <span className="font-mono text-[11px] text-cream">
            {position.total_value_sol != null ? `${position.total_value_sol.toFixed(4)} SOL` : position.total_value_usd != null ? `$${position.total_value_usd.toFixed(2)}` : "--"}
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-ash">PnL</span>
          <span className={`font-mono text-[11px] font-medium ${pnlColor}`}>
            {pnl_pct >= 0 ? "+" : ""}{pnl_pct.toFixed(2)}%
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-ash">Fees</span>
          <span className="font-mono text-[11px] text-cream">{fees}</span>
        </div>
        <div>
          <span className="block text-[10px] text-ash">Age</span>
          <span className="font-mono text-[11px] text-steel">{age_minutes != null ? formatAge(age_minutes) : "--"}</span>
        </div>
        <div>
          <span className="block text-[10px] text-ash">Strategy</span>
          <span className="font-mono text-[11px] text-cream">{position.strategy ?? "--"}</span>
        </div>
      </div>

      {/* Pool metrics (live where available, fallback to deploy-time) */}
      <div className="mb-2 flex flex-wrap items-center gap-3 border-t border-white/6 pt-2">
        <div>
          <span className="block text-[10px] text-ash">Bin step</span>
          <span className="font-mono text-[11px] text-cream">{position.bin_step ?? "--"}</span>
        </div>
        <div>
          <span className="block text-[10px] text-ash">Fee %</span>
          <span className="font-mono text-[11px] text-cream">{position.bin_step ? `${(position.bin_step / 100).toFixed(2)}%` : "--"}</span>
        </div>
        <div>
          <span className="block text-[10px] text-ash">Volatility {position.live_volatility != null ? "" : ""}</span>
          <span className="font-mono text-[11px] text-cream">
            {position.live_volatility != null ? position.live_volatility.toFixed(2) : (position.volatility != null ? position.volatility.toFixed(2) : "--")}
            {position.live_volatility != null && <span className="ml-1 text-[8px] text-emerald-300/60">LIVE</span>}
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-ash">Fee/TVL</span>
          <span className="font-mono text-[11px] text-cream">
            {position.live_fee_tvl_ratio != null ? `${position.live_fee_tvl_ratio.toFixed(2)}%` : (position.fee_tvl_ratio != null ? `${position.fee_tvl_ratio.toFixed(2)}%` : "--")}
            {position.live_fee_tvl_ratio != null && <span className="ml-1 text-[8px] text-emerald-300/60">LIVE</span>}
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-ash">Volume</span>
          <span className="font-mono text-[11px] text-cream">
            {position.live_volume != null ? `$${position.live_volume >= 1000 ? `${(position.live_volume / 1000).toFixed(1)}k` : position.live_volume.toFixed(0)}` : "--"}
            {position.live_volume != null && <span className="ml-1 text-[8px] text-emerald-300/60">LIVE</span>}
          </span>
        </div>
        {(screeningTimeframe || position.deploy_timeframe) && (
          <div className="mt-1 flex flex-col gap-0.5 border-t border-white/6 pt-1.5">
            {position.deploy_timeframe && (
              <span className="font-mono text-[8px] text-ash/36 break-all">deploy: {position.deploy_timeframe} · {(position.deploy_categories || []).join("+")}</span>
            )}
            <span className="font-mono text-[9px] text-ash/50 break-all">live: {screeningTimeframe || "?"} · {(screeningCategories || []).join("+")}</span>
          </div>
        )}
      </div>

      {/* Smart wallets */}
      {(position.smart_wallets_total ?? 0) > 0 && (
        <div className="mb-2 flex items-center gap-2 border-t border-white/6 pt-2">
          <span className="text-[10px] text-ash">Smart Wallets:</span>
          <span className={`font-mono text-[11px] ${(position.smart_wallets_in_pool ?? 0) > 0 ? "text-emerald-300" : "text-ash/50"}`}>
            {position.smart_wallets_in_pool ?? 0}/{position.smart_wallets_total ?? 0} in pool
          </span>
          {(position.smart_wallets_names?.length ?? 0) > 0 && (
            <span className="text-[10px] text-amber-200/60">
              ({position.smart_wallets_names!.join(", ")})
            </span>
          )}
        </div>
      )}

      {/* Bin range chart */}
      {lower_bin != null && upper_bin != null && active_bin != null ? (
        <BinRangeChart
          lowerBin={lower_bin}
          upperBin={upper_bin}
          activeBin={active_bin}
          inRange={in_range}
          strategy={position.strategy}
        />
      ) : (
        <div className="h-6 rounded bg-ink/40 flex items-center justify-center">
          <span className="font-mono text-[9px] text-ash/40">bin data unavailable</span>
        </div>
      )}
    </div>
  );
}

const PositionCard = memo(PositionCardInner, (prev, next) =>
  prev.position.pnl_pct === next.position.pnl_pct &&
  prev.position.in_range === next.position.in_range &&
  prev.position.unclaimed_fees_sol === next.position.unclaimed_fees_sol &&
  prev.position.active_bin === next.position.active_bin &&
  prev.position.live_volatility === next.position.live_volatility &&
  prev.position.live_volume === next.position.live_volume &&
  prev.position.smart_wallets_in_pool === next.position.smart_wallets_in_pool
);

export default PositionCard;
