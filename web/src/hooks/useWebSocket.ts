import { useCallback, useEffect, useRef, useState } from "react";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts?: string;
}

export interface Notification {
  id: string;
  event: string;
  data: Record<string, unknown>;
  ts: string;
}

export interface StatusInfo {
  busy: boolean;
  managementBusy: boolean;
  screeningBusy: boolean;
}

export interface TimerInfo {
  management: string;
  screening: string;
}

export interface PositionInfo {
  position: string;
  pair: string;
  pool: string;
  base_mint?: string | null;
  strategy?: "bid_ask" | "spot";
  in_range: boolean;
  active_bin: number;
  lower_bin: number;
  upper_bin: number;
  bin_step?: number | null;
  fee_pct?: number | null;
  volatility?: number | null;
  pnl_pct: number;
  pnl_sol?: number | null;
  pnl_usd?: number | null;
  unclaimed_fees_sol?: number | null;
  unclaimed_fees_usd?: number | null;
  collected_fees_sol?: number | null;
  collected_fees_usd?: number | null;
  total_value_sol?: number | null;
  total_value_usd?: number | null;
  age_minutes?: number;
  oor_direction?: "upside" | "downside" | null;
  minutes_out_of_range?: number;
}

export interface PositionData {
  total_positions: number;
  positions: PositionInfo[];
}

export interface WalletData {
  sol: number;
  sol_usd: number;
  sol_price: number;
  tokens?: Array<{ symbol: string; amount: number; usd: number }>;
}

export interface CandidateInfo {
  name: string;
  pool: string;
  bin_step?: number;
  fee_tvl_ratio?: number;
  fee_active_tvl_ratio?: number;
  volume?: number;
  volume_24h?: number;
  volume_window?: number;
  organic_score?: number;
  active_pct?: number;
  active_bin_pct?: number;
  _source?: string;
  _meteora_verified?: boolean;
}

export interface CandidateData {
  candidates: CandidateInfo[];
  total_eligible: number;
  total_screened: number;
}

function isCandidateInfo(value: unknown): value is CandidateInfo {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.pool === "string";
}

function isCandidateData(value: unknown): value is CandidateData {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return Array.isArray(payload.candidates)
    && payload.candidates.every(isCandidateInfo)
    && typeof payload.total_eligible === "number"
    && typeof payload.total_screened === "number";
}

export interface LpOverviewData {
  total_pnl: number;
  total_fees: number;
  win_rate_pct: number;
  closed_positions: number;
  open_positions: number;
  avg_hold_hours: number;
  roi_pct: number;
  pnl_unit: string;
  total_pnl_usd: number;
  total_pnl_sol: number;
  total_fees_usd: number;
  total_fees_sol: number;
  win_rate_usd_pct: number;
  win_rate_sol_pct: number;
  total_pools: number;
}

export interface QuickActionResult {
  action: string;
  data: unknown;
  error?: string;
}

// ─── LocalStorage persistence ─────────────────────────────────
const CHAT_KEY   = "meridian:chat";
const NOTIF_KEY  = "meridian:notifications";
const MAX_STORED_MSGS  = 200;
const MAX_STORED_NOTIF = 100;

function loadStored<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveStored<T>(key: string, items: T[]) {
  try { localStorage.setItem(key, JSON.stringify(items)); } catch { /* storage full */ }
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadStored<ChatMessage>(CHAT_KEY));
  const [notifications, setNotifications] = useState<Notification[]>(() => loadStored<Notification>(NOTIF_KEY));
  const [status, setStatus] = useState<StatusInfo>({ busy: false, managementBusy: false, screeningBusy: false });
  const [timers, setTimers] = useState<TimerInfo>({ management: "--", screening: "--" });
  const [positions, setPositions] = useState<PositionData | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [candidates, setCandidates] = useState<CandidateData | null>(null);
  const [lpOverview, setLpOverview] = useState<LpOverviewData | null>(null);
  const [quickActionResult, setQuickActionResult] = useState<QuickActionResult | null>(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => { ws.close(); };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        switch (msg.type) {
          case "init": {
            if (msg.history) {
              // Merge server history with locally stored — server is source of truth for content
              // but keep local messages that are newer than server history
              const serverMsgs: ChatMessage[] = msg.history;
              setMessages(serverMsgs);
              saveStored(CHAT_KEY, serverMsgs.slice(-MAX_STORED_MSGS));
            }
            if (msg.status) setStatus(msg.status);
            if (msg.timers) setTimers(msg.timers);
            if (msg.positions) setPositions(msg.positions);
            if (msg.wallet) setWallet(msg.wallet);
            if (isCandidateData(msg.candidates)) setCandidates(msg.candidates);
            if (msg.lpOverview) setLpOverview(msg.lpOverview);
            break;
          }
          case "chat:response": {
            const newMsg: ChatMessage = { role: "assistant", content: msg.text, ts: msg.ts };
            setMessages((prev) => {
              const next = [...prev, newMsg];
              saveStored(CHAT_KEY, next.slice(-MAX_STORED_MSGS));
              return next;
            });
            break;
          }
          case "notification": {
            const newNotif: Notification = {
              id: crypto.randomUUID(),
              event: msg.event,
              data: msg.data,
              ts: msg.ts || new Date().toISOString(),
            };
            setNotifications((prev) => {
              const next = [newNotif, ...prev].slice(0, MAX_STORED_NOTIF);
              saveStored(NOTIF_KEY, next);
              return next;
            });
            break;
          }
          case "status":
            setStatus({ busy: msg.busy, managementBusy: msg.managementBusy, screeningBusy: msg.screeningBusy });
            break;
          case "timer":
            setTimers({ management: msg.management, screening: msg.screening });
            break;
          case "positions":
            if (msg.data) setPositions(msg.data);
            break;
          case "wallet":
            if (msg.data) setWallet(msg.data);
            break;
          case "candidates":
            if (isCandidateData(msg.data)) setCandidates(msg.data);
            break;
          case "quick-action:result":
            setQuickActionResult({ action: msg.action, data: msg.data });
            break;
          case "quick-action:error":
            setQuickActionResult({ action: msg.action, data: null, error: msg.error || "Unknown error" });
            break;
          case "error":
            setMessages((prev) => {
              const next = [...prev, { role: "assistant" as const, content: `Error: ${msg.text}`, ts: new Date().toISOString() }];
              saveStored(CHAT_KEY, next.slice(-MAX_STORED_MSGS));
              return next;
            });
            break;
        }
      } catch { /* ignore malformed messages */ }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const newMsg: ChatMessage = { role: "user", content: text, ts: new Date().toISOString() };
    setMessages((prev) => {
      const next = [...prev, newMsg];
      saveStored(CHAT_KEY, next.slice(-MAX_STORED_MSGS));
      return next;
    });
    const isCommand = text.startsWith("/") || text.toLowerCase() === "auto" || /^\d+$/.test(text.trim());
    if (isCommand) {
      const cmd = text.toLowerCase() === "auto" ? "/auto" : /^\d+$/.test(text.trim()) ? text.trim() : text;
      wsRef.current.send(JSON.stringify({ type: "command", command: cmd }));
    } else {
      wsRef.current.send(JSON.stringify({ type: "chat", text }));
    }
  }, []);

  const sendQuickAction = useCallback((action: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setQuickActionResult(null);
    wsRef.current.send(JSON.stringify({ type: "quick-action", action }));
  }, []);

  const clearQuickActionResult = useCallback(() => {
    setQuickActionResult(null);
  }, []);

  return { connected, messages, notifications, status, timers, positions, wallet, candidates, lpOverview, sendMessage, sendQuickAction, quickActionResult, clearQuickActionResult };
}
