import { useState } from "react";
import type { PositionData, WalletData, CandidateData, Notification, StatusInfo, LpOverviewData, QuickActionResult } from "../hooks/useWebSocket";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import DashboardTab from "./DashboardTab";
import CandidatesTab from "./CandidatesTab";
import ActivityTab from "./ActivityTab";
import IntelTab from "./IntelTab";

interface DataSidebarProps {
  positions: PositionData | null;
  wallet: WalletData | null;
  candidates: CandidateData | null;
  notifications: Notification[];
  status: StatusInfo;
  lpOverview: LpOverviewData | null;
  onCommand: (text: string) => void;
  sendQuickAction: (action: string) => void;
  quickActionResult: QuickActionResult | null;
  clearQuickActionResult: () => void;
  // Mobile sync
  mobileActiveTab?: string;
  onMobileTabChange?: (tab: string) => void;
}

export default function DataSidebar({
  positions, wallet, candidates, notifications, lpOverview,
  onCommand, sendQuickAction, quickActionResult, clearQuickActionResult,
  mobileActiveTab, onMobileTabChange,
}: DataSidebarProps) {
  const activeAlerts = positions?.positions.filter((p) => !p.in_range).length ?? 0;
  const openPositions = positions?.total_positions ?? 0;

  // Desktop uses local state; mobile uses parent-controlled tab from bottom nav
  const [localTab, setLocalTab] = useState("dashboard");
  const resolvedTab = mobileActiveTab != null
    ? (mobileActiveTab === "chat" ? "dashboard" : mobileActiveTab)
    : localTab;
  const handleTabChange = onMobileTabChange ?? setLocalTab;

  return (
    <Tabs
      value={resolvedTab}
      onValueChange={handleTabChange}
      className="flex h-full flex-col gap-2 px-3 py-3 lg:gap-3 lg:px-4"
    >
      {/* Header — compact on mobile */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-[linear-gradient(180deg,rgba(255,209,102,0.08),rgba(255,209,102,0.02))] px-3 py-2.5 shadow-[0_18px_34px_rgba(0,0,0,0.16)] lg:rounded-[28px] lg:px-4 lg:py-3">
        <div className="flex flex-col gap-0.5 lg:gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-amber-200/70 lg:text-[10px]">
            Mission Control
          </span>
          <div className="flex flex-wrap items-end gap-x-2 gap-y-0.5">
            <span className="text-base font-semibold tracking-tight text-cream lg:text-xl">Trading Desk</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ash/56">
              {openPositions} open
            </span>
          </div>
        </div>
        <Badge variant={activeAlerts > 0 ? "destructive" : "secondary"} className="shrink-0">
          {activeAlerts > 0 ? `${activeAlerts} alerts` : "stable"}
        </Badge>
      </div>

      {/* Tabs — hidden on mobile (bottom nav handles navigation) */}
      <TabsList className="hidden lg:flex">
        <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        <TabsTrigger value="candidates">Candidates</TabsTrigger>
        <TabsTrigger value="intel">Intel</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>

      <TabsContent value="dashboard" className="flex-1 min-h-0 overflow-y-auto">
        <DashboardTab positions={positions} wallet={wallet} lpOverview={lpOverview} sendQuickAction={sendQuickAction} quickActionResult={quickActionResult} clearQuickActionResult={clearQuickActionResult} onCommand={onCommand} />
      </TabsContent>

      <TabsContent value="candidates" className="flex-1 min-h-0 overflow-y-auto">
        <CandidatesTab candidates={candidates} onCommand={onCommand} />
      </TabsContent>

      <TabsContent value="intel" className="flex-1 min-h-0 overflow-y-auto">
        <IntelTab />
      </TabsContent>

      <TabsContent value="activity" className="flex-1 min-h-0 overflow-y-auto">
        <ActivityTab notifications={notifications} />
      </TabsContent>
    </Tabs>
  );
}
