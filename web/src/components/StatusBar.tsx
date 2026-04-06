import { Wifi, WifiOff, Network } from "lucide-react";
import type { StatusInfo, TimerInfo, WalletData, PositionData } from "../hooks/useWebSocket";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface StatusBarProps {
  connected: boolean;
  status: StatusInfo;
  timers: TimerInfo;
  wallet: WalletData | null;
  positions: PositionData | null;
  onOpenGraph?: () => void;
}

export default function StatusBar({ connected, status, timers, wallet, positions, onOpenGraph }: StatusBarProps) {
  const posValueSol = positions?.positions.reduce((s, p) => s + (p.total_value_sol ?? 0), 0) ?? 0;
  const posValueUsd = positions?.positions.reduce((s, p) => s + (p.total_value_usd ?? 0), 0) ?? 0;
  const totalSol = wallet ? wallet.sol + posValueSol : null;
  const totalUsd = wallet ? wallet.sol_usd + posValueUsd : null;
  const busyLabel = status.managementBusy
    ? "Managing"
    : status.screeningBusy
      ? "Screening"
      : "Working";

  const busyTooltip = [
    status.managementBusy && "Management cycle active",
    status.screeningBusy && "Screening cycle active",
    status.busy && !status.managementBusy && !status.screeningBusy && "Agent is working",
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-2 border-b border-white/8 bg-[linear-gradient(180deg,rgba(18,69,89,0.82),rgba(9,43,56,0.82))] px-3 py-2 text-xs shadow-[0_10px_28px_rgba(0,0,0,0.18)] backdrop-blur-sm lg:gap-4 lg:px-4 lg:py-2.5">

        {/* Connection dot — icon only on mobile, label on desktop */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 font-medium">
              {connected ? (
                <Wifi size={14} className="text-emerald-300" />
              ) : (
                <WifiOff size={14} className="text-ash/58" />
              )}
              <span className={`hidden lg:inline ${connected ? "text-cream" : "text-ash/70"}`}>
                {connected ? "Connected" : "Disconnected"}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>{connected ? "Connected" : "Disconnected"} — WebSocket</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-3" />

        {/* Timers */}
        <div className="flex items-center gap-2 text-ash lg:gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] lg:text-[11px] lg:tracking-[0.14em]">
                <span className="text-ash/60">M:</span>{" "}
                {timers.management === "--" ? (
                  <Skeleton className="h-3 w-7 inline-block" />
                ) : (
                  <span className="text-cream">{timers.management}</span>
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent>Next management cycle</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] lg:text-[11px] lg:tracking-[0.14em]">
                <span className="text-ash/60">S:</span>{" "}
                {timers.screening === "--" ? (
                  <Skeleton className="h-3 w-7 inline-block" />
                ) : (
                  <span className="text-cream">{timers.screening}</span>
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent>Next screening cycle</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-3" />

        {/* Total portfolio */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-[10px] text-ash tracking-[0.12em] lg:text-[11px] lg:tracking-[0.14em]">
              {totalSol != null ? (
                <>
                  <span className="text-cream">{totalSol.toFixed(2)}</span>
                  <span className="text-ash/60"> SOL</span>
                  <span className="ml-1 hidden text-ash/60 lg:inline">(${totalUsd!.toFixed(0)})</span>
                </>
              ) : (
                <Skeleton className="h-3 w-12 inline-block" />
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Total: {totalSol?.toFixed(3) ?? "..."} SOL (${totalUsd?.toFixed(0) ?? "..."}) — Wallet: {wallet?.sol.toFixed(3) ?? "..."} + Positions: {posValueSol.toFixed(3)} @ ${wallet?.sol_price.toFixed(2) ?? "..."}/SOL
          </TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        {/* Busy indicator */}
        {(status.busy || status.managementBusy || status.screeningBusy) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 rounded-full border border-emerald-300/15 bg-emerald-300/8 px-2 py-0.5 lg:px-2.5 lg:py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-subtle-glow lg:h-2 lg:w-2" />
                <span className="font-mono text-[10px] text-emerald-200 lg:text-[11px]">{busyLabel}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>{busyTooltip}</TooltipContent>
          </Tooltip>
        )}

        {/* Mind Map — desktop only */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onOpenGraph}
              className="hidden lg:flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-ash/70 transition-colors hover:border-amber-300/20 hover:bg-amber-300/8 hover:text-amber-200"
            >
              <Network size={13} />
              <span className="font-mono text-[10px] tracking-wider">Mind Map</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>Open knowledge graph visualization</TooltipContent>
        </Tooltip>

        {/* Mind Map icon only — mobile */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onOpenGraph}
              className="flex lg:hidden items-center justify-center rounded-full border border-white/10 bg-white/5 p-1.5 text-ash/70 transition-colors hover:border-amber-300/20 hover:bg-amber-300/8 hover:text-amber-200"
            >
              <Network size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Knowledge graph</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
