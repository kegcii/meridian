import type { CandidateData } from "../hooks/useWebSocket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

interface CandidatesTabProps {
  candidates: CandidateData | null;
  onCommand: (text: string) => void;
}

function formatVolume(v: number | undefined): string {
  if (v == null) return "--";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2.5">
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ash/56">{label}</div>
      <div className="mt-1.5 font-mono text-[15px] text-cream">{value}</div>
      {sub && <div className="mt-0.5 font-mono text-[10px] text-ash/44">{sub}</div>}
    </div>
  );
}

export default function CandidatesTab({ candidates, onCommand }: CandidatesTabProps) {
  if (!candidates) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  const topCandidate = candidates.candidates[0];

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-1">
        <div className="flex items-center justify-between px-1 flex-wrap gap-2">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ash/56">Top Pools</span>
            <span className="text-xs text-ash/56">Ranked opportunities from Meteora.</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-ash/60">
              {candidates.total_eligible} eligible / {candidates.total_screened} screened
            </span>
          </div>
        </div>

        {/* Top candidate hero card */}
        {topCandidate && (
          <Card className="relative overflow-hidden">
            <div className="absolute -right-10 top-0 size-32 rounded-full bg-[radial-gradient(circle,rgba(255,209,102,0.18),transparent_70%)]" />
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <CardTitle className="flex items-center gap-2 flex-wrap">
                    Best Right Now
                  </CardTitle>
                  <CardDescription>
                    {topCandidate.name || topCandidate.pool.slice(0, 8)}
                    {topCandidate._meteora_verified === false && " — unverified pool"}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge>Rank #1</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
                <Metric label="Fee / TVL" value={topCandidate.fee_active_tvl_ratio != null ? `${topCandidate.fee_active_tvl_ratio.toFixed(2)}%` : "--"} />
                <Metric label="Pool Vol" value={formatVolume(topCandidate.volume)} />
                <Metric label="Organic" value={topCandidate.organic_score != null ? `${topCandidate.organic_score.toFixed(0)}` : "--"} />
                <Metric label="Bin Step" value={topCandidate.bin_step != null ? String(topCandidate.bin_step) : "--"} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => onCommand("1")}>Deploy #1</Button>
                <Button variant="secondary" onClick={() => onCommand(`What makes ${topCandidate.name || topCandidate.pool} the best candidate right now?`)}>Ask Why</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Candidate list */}
        {candidates.candidates.length > 0 ? (
          <div className="flex flex-col gap-2">
            {candidates.candidates.map((c, i) => {
              const ratio = c.fee_active_tvl_ratio ?? c.fee_tvl_ratio;
              const vol = c.volume ?? c.volume_window ?? c.volume_24h;
              const activePct = c.active_pct ?? c.active_bin_pct;
              return (
                <Card key={c.pool} className="relative">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-[11px] text-ash/50">#{i + 1}</span>
                          <span className="font-medium text-cream truncate">{c.name || c.pool.slice(0, 8)}</span>
                          {c._meteora_verified === false && <Badge variant="outline" className="text-[9px] text-red-300/60 border-red-300/15 px-1.5 py-0">unverified</Badge>}
                        </div>
                        <span className="text-[10px] text-ash/40 truncate font-mono">{c.pool}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Button size="sm" onClick={() => onCommand(String(i + 1))}>Deploy</Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
                      <div>
                        <div className="font-mono text-[8px] uppercase tracking-wider text-ash/44">Fee/TVL</div>
                        <div className="font-mono text-[12px] text-cream">{ratio != null ? `${ratio.toFixed(2)}%` : "--"}</div>
                      </div>
                      <div>
                        <div className="font-mono text-[8px] uppercase tracking-wider text-ash/44">Volume</div>
                        <div className="font-mono text-[12px] text-cream">{formatVolume(vol)}</div>
                      </div>
                      <div>
                        <div className="font-mono text-[8px] uppercase tracking-wider text-ash/44">Organic</div>
                        <div className="font-mono text-[12px] text-cream">{c.organic_score != null ? c.organic_score.toFixed(0) : "--"}</div>
                      </div>
                      <div className="hidden sm:block">
                        <div className="font-mono text-[8px] uppercase tracking-wider text-ash/44">Active</div>
                        <div className="font-mono text-[12px] text-cream">{activePct != null ? `${activePct.toFixed(0)}%` : "--"}</div>
                      </div>
                      <div className="hidden sm:block">
                        <div className="font-mono text-[8px] uppercase tracking-wider text-ash/44">Bin Step</div>
                        <div className="font-mono text-[12px] text-cream">{c.bin_step ?? "--"}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="flex min-h-32 items-center justify-center text-sm text-ash/40">
              No candidates available
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
