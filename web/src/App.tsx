import { useState, useEffect, useCallback } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useToastNotifications } from "./hooks/useToastNotifications";
import ChatPanel from "./components/ChatPanel";
import DataSidebar from "./components/DataSidebar";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";
import KnowledgeGraph from "./components/KnowledgeGraph";
import ToastProvider from "./components/ToastProvider";

export default function App() {
  const { connected, messages, notifications, status, timers, positions, wallet, candidates, lpOverview, strategyBreakdown, performanceExtra, sendMessage, sendQuickAction, quickActionResult, clearQuickActionResult } = useWebSocket();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  useToastNotifications(notifications);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleCommandExecute = useCallback((command: string) => {
    sendMessage(command);
  }, [sendMessage]);

  return (
    <div className="flex flex-col overflow-hidden bg-transparent" style={{ height: '100dvh' }}>
      <StatusBar connected={connected} status={status} timers={timers} wallet={wallet} onOpenGraph={() => setGraphOpen(true)} />

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row" style={{ minHeight: 0 }}>
        {/* Chat panel — hidden on mobile by default, toggle button below */}
        <div
          className={`flex-col overflow-hidden border-b border-white/8 bg-[linear-gradient(180deg,rgba(2,24,33,0.72),rgba(0,15,20,0.82))] lg:flex lg:flex-[1.08] lg:border-b-0 lg:border-r ${chatOpen ? "flex max-h-[50vh] lg:max-h-none" : "hidden"}`}
          style={{ minHeight: 0 }}
        >
          <ChatPanel
            messages={messages}
            status={status}
            timers={timers}
            positions={positions}
            candidates={candidates}
            onSend={sendMessage}
            onOpenCommandPalette={() => setCmdOpen(true)}
          />
        </div>

        {/* Mobile chat toggle */}
        <button
          onClick={() => setChatOpen((prev) => !prev)}
          className="flex items-center justify-center gap-2 border-b border-white/8 bg-[linear-gradient(180deg,rgba(18,69,89,0.5),rgba(9,43,56,0.5))] px-3 py-1.5 text-ash/70 transition-colors hover:text-cream lg:hidden"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em]">
            {chatOpen ? "Hide Chat" : "Show Chat"}
          </span>
          {!chatOpen && messages.length > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-200/20 px-1 font-mono text-[9px] text-amber-200">
              {messages.length}
            </span>
          )}
        </button>

        {/* Data Sidebar — primary view on mobile */}
        <div className="flex flex-1 flex-col overflow-y-auto bg-[linear-gradient(180deg,rgba(8,31,40,0.54),rgba(0,15,20,0.72))] pb-20 sm:pb-4 lg:flex-[0.92]" style={{ minHeight: 0 }}>
          <DataSidebar
            positions={positions}
            wallet={wallet}
            candidates={candidates}
            notifications={notifications}
            status={status}
            lpOverview={lpOverview}
            strategyBreakdown={strategyBreakdown}
            performanceExtra={performanceExtra}
            onCommand={sendMessage}
            sendQuickAction={sendQuickAction}
            quickActionResult={quickActionResult}
            clearQuickActionResult={clearQuickActionResult}
          />
        </div>
      </div>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} onExecute={handleCommandExecute} />
      <KnowledgeGraph open={graphOpen} onClose={() => setGraphOpen(false)} sendQuickAction={sendQuickAction} quickActionResult={quickActionResult} clearQuickActionResult={clearQuickActionResult} />
      <ToastProvider />
    </div>
  );
}
