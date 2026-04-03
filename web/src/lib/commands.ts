export const COMMANDS = [
  { label: "/status", desc: "Wallet & positions" },
  { label: "/briefing", desc: "Morning briefing (last 24h)" },
  { label: "/candidates", desc: "Top pool picks" },
  { label: "/thresholds", desc: "Screening thresholds + stats" },
  { label: "/learn", desc: "Study top LPers & save lessons" },
  { label: "/evolve", desc: "Evolve thresholds from performance" },
  { label: "/auto", desc: "Agent picks & deploys automatically" },
];

export const SUGGESTIONS = [
  ...COMMANDS,
  { label: "1", desc: "Deploy into pool #1" },
  { label: "2", desc: "Deploy into pool #2" },
  { label: "3", desc: "Deploy into pool #3" },
  { label: "4", desc: "Deploy into pool #4" },
  { label: "5", desc: "Deploy into pool #5" },
  { label: "Show my positions", desc: null },
  { label: "What pools look good?", desc: null },
  { label: "How is my portfolio doing?", desc: null },
  { label: "Explain my worst position", desc: null },
];
