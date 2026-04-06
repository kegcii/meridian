import { LayoutDashboard, MessageSquare, Search, Activity } from "lucide-react";

interface MobileNavProps {
  activeTab: string;
  onChange: (tab: string) => void;
  alertCount: number;
}

const tabs = [
  { id: "dashboard", label: "Portfolio", icon: LayoutDashboard },
  { id: "chat",      label: "Chat",      icon: MessageSquare },
  { id: "candidates",label: "Scan",      icon: Search },
  { id: "activity",  label: "Activity",  icon: Activity },
];

export default function MobileNav({ activeTab, onChange, alertCount }: MobileNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-white/8 bg-[rgba(1,22,30,0.96)] backdrop-blur-md lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {tabs.map(({ id, label, icon: Icon }) => {
        const active = activeTab === id;
        const showBadge = id === "dashboard" && alertCount > 0;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`relative flex flex-1 flex-col items-center gap-1 py-3 transition-colors ${
              active ? "text-amber-300" : "text-ash/50"
            }`}
          >
            <span className="relative">
              <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
              {showBadge && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                  {alertCount}
                </span>
              )}
            </span>
            <span className={`text-[10px] font-medium tracking-wide ${active ? "text-amber-200" : "text-ash/40"}`}>
              {label}
            </span>
            {active && (
              <span className="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-amber-300/70" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
