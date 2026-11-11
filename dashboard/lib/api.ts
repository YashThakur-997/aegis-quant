export type TradeDirection = "BUY" | "SELL" | "HOLD";

export type TradeSignal = {
  direction: TradeDirection;
  conviction: number;
  bull_catalysts: string[];
  bear_risks: string[];
  plain_language_reasoning: string;
  citations?: string[];
};

export type VectorbtReport = {
  strategy_total_return_pct: number | null;
  benchmark_total_return_pct: number | null;
  strategy_sharpe_ratio: number | null;
  benchmark_sharpe_ratio: number | null;
  strategy_max_drawdown_pct: number | null;
  validation_status: string;
};

export type RiskAllocation = {
  approved?: boolean;
  shares?: number;
  allocated_capital?: number;
  stop_loss_price?: number;
  risk_percentage?: number;
  guardrail_status?: string;
  reason?: string;
};

export type BrokerExecution = {
  success?: boolean;
  order_id?: string;
  ticker?: string;
  shares?: number;
  side?: string;
  status?: string;
  error?: string;
};

export type DataContext = {
  ticker: string;
  feed: string;
  bars_count: number;
  last_close: number;
  news_count: number;
  equity: number;
  daily_pnl_pct: number;
  dry_run: boolean;
};

export type EvaluateResponse = {
  status: string;
  reason?: string;
  details?: string;
  regime?: string;
  vectorbt_validation?: VectorbtReport;
  trade_signal?: TradeSignal;
  risk_allocation?: RiskAllocation;
  broker_execution?: BrokerExecution;
  data_context?: DataContext;
  trade_id?: string;
};

export type JournalEntry = {
  trade_id: string;
  timestamp: string | null;
  action: string;
  ticker: string;
  shares: number | null;
  allocated_capital: number | null;
  stop_loss_price: number | null;
  regime: string | null;
  conviction: number | null;
  status: string;
  plain_language_reasoning: string | null;
  bull_catalysts: string[];
  bear_risks: string[];
};

export type KillSwitchResponse = {
  status: string;
  reason: string;
};

export type OhlcvRow = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const record = data as Record<string, unknown> | null;
    const detail = record?.detail ?? record?.error ?? res.statusText;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail)
    );
  }

  return data as T;
}

export function analyzeTicker(
  ticker: string,
  dryRun = true
): Promise<EvaluateResponse> {
  const symbol = encodeURIComponent(ticker.trim().toUpperCase());
  return request<EvaluateResponse>(
    `/api/v1/analyze/${symbol}?dry_run=${dryRun ? "true" : "false"}`,
    { method: "POST" }
  );
}

export function evaluateTrade(payload: {
  ticker: string;
  news_summary: string;
  current_equity: number;
  current_daily_pnl: number;
  historical_data: OhlcvRow[];
}): Promise<EvaluateResponse> {
  return request<EvaluateResponse>("/api/v1/evaluate-trade", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function triggerKillSwitch(reason: string): Promise<KillSwitchResponse> {
  return request<KillSwitchResponse>(
    `/api/v1/kill-switch/trigger?reason=${encodeURIComponent(reason)}`,
    { method: "POST" }
  );
}

export function fetchJournals(limit = 50): Promise<JournalEntry[]> {
  return request<JournalEntry[]>(`/api/v1/journals?limit=${limit}`);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function buildHistoricalData(ticker: string, points = 120): OhlcvRow[] {
  const rand = mulberry32(hashString(ticker.toUpperCase() || "AEGIS"));
  let price = 40 + rand() * 220;
  const rows: OhlcvRow[] = [];

  for (let i = 0; i < points; i += 1) {
    const open = price;
    const drift = (rand() - 0.48) * 0.03;
    const close = Math.max(1, open * (1 + drift));
    const high = Math.max(open, close) * (1 + rand() * 0.012);
    const low = Math.min(open, close) * (1 - rand() * 0.012);
    rows.push({
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      volume: Math.round(500000 + rand() * 2500000),
    });
    price = close;
  }

  return rows;
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}%`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US");
}

export function formatConviction(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
