"use client";

import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import BacktestChart from "@/components/BacktestChart";
import PipelineProgress, {
  PIPELINE_STEPS,
} from "@/components/PipelineProgress";
import {
  analyzeTicker,
  buildHistoricalData,
  evaluateTrade,
  formatCurrency,
  formatConviction,
  formatNumber,
  formatPercent,
  type EvaluateResponse,
} from "@/lib/api";

const QUICK_PICKS = ["AAPL", "MSFT", "NVDA", "TSLA", "SPY"];

const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30";

function Stat({
  label,
  value,
  accent = "text-zinc-100",
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 font-mono text-sm font-semibold ${accent}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const palette =
    status === "SUCCESS" || status === "EXECUTED"
      ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-300"
      : status === "DRY_RUN"
        ? "border-zinc-700 bg-zinc-800 text-zinc-300"
        : status === "HOLD"
          ? "border-amber-700/60 bg-amber-900/30 text-amber-300"
          : status.includes("REJECT") || status.includes("ERROR")
            ? "border-red-800/70 bg-red-950/60 text-red-300"
            : "border-zinc-700 bg-zinc-800 text-zinc-300";

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${palette}`}
    >
      {status.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())}
    </span>
  );
}

function directionColor(direction: string) {
  if (direction === "BUY") return "text-emerald-400";
  if (direction === "SELL") return "text-red-400";
  return "text-amber-400";
}

function DataContextStrip({ result }: { result: EvaluateResponse }) {
  const context = result.data_context;
  if (!context) return null;
  const positive = context.daily_pnl_pct >= 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400">
      <span className="font-mono font-semibold text-zinc-200">
        {context.ticker}
      </span>
      <span>
        {context.feed} daily · {context.bars_count} bars
      </span>
      <span>last {formatCurrency(context.last_close)}</span>
      <span>{context.news_count} news</span>
      <span>equity {formatCurrency(context.equity)}</span>
      <span className={positive ? "text-emerald-300" : "text-red-300"}>
        day {positive ? "+" : ""}
        {context.daily_pnl_pct.toFixed(2)}%
      </span>
      {context.dry_run ? (
        <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-medium text-zinc-300">
          Dry run
        </span>
      ) : null}
    </div>
  );
}

export default function TradeEvaluatorForm() {
  const [ticker, setTicker] = useState("AAPL");
  const [dryRun, setDryRun] = useState(true);
  const [manualNews, setManualNews] = useState("");
  const [manualEquity, setManualEquity] = useState("10000");
  const [submitting, setSubmitting] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<EvaluateResponse | null>(null);

  useEffect(() => {
    if (!submitting) {
      setActiveStep(0);
      return;
    }

    setActiveStep(0);
    const interval = window.setInterval(() => {
      setActiveStep((step) =>
        step < PIPELINE_STEPS.length - 1 ? step + 1 : step
      );
    }, 1100);

    return () => window.clearInterval(interval);
  }, [submitting]);

  function notifyOutcome(response: EvaluateResponse) {
    const symbol = response.data_context?.ticker ?? ticker;
    const direction = response.trade_signal?.direction ?? "HOLD";

    if (response.status === "SUCCESS" || response.status === "EXECUTED") {
      toast.success(`${symbol} ${direction} submitted`, {
        description: `Broker status ${response.status} · paper account`,
      });
    } else if (response.status === "DRY_RUN") {
      toast.info(`${symbol} · ${direction} (dry run)`, {
        description: "Decision journaled. No order was sent.",
      });
    } else if (response.status === "HOLD") {
      toast.info(`${symbol} · holding`, {
        description: "Agent consensus was to stand down.",
      });
    }
  }

  function notifyError(requestError: unknown, fallback: string) {
    const message =
      requestError instanceof Error ? requestError.message : fallback;
    setError(message);

    const lowered = message.toLowerCase();
    if (
      lowered.includes("circuit breaker") ||
      lowered.includes("kill switch") ||
      lowered.includes("kill-switch")
    ) {
      toast.error("Kill-switch engaged", {
        description: "Trading is halted. Reset the breaker to continue.",
      });
    } else {
      toast.error("Evaluation failed", { description: message });
    }
  }

  async function runAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const symbol = ticker.trim().toUpperCase();
    if (!symbol) {
      setError("Ticker is required.");
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const response = await analyzeTicker(symbol, dryRun);
      setResult(response);
      notifyOutcome(response);
    } catch (requestError) {
      notifyError(requestError, "Agent run failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function runManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const symbol = ticker.trim().toUpperCase();
    const equityValue = Number(manualEquity);

    if (!symbol) {
      setError("Ticker is required.");
      return;
    }
    if (!manualNews.trim()) {
      setError("News summary is required for manual evaluation.");
      return;
    }
    if (!Number.isFinite(equityValue) || equityValue <= 0) {
      setError("Current equity must be a positive number.");
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const response = await evaluateTrade({
        ticker: symbol,
        news_summary: manualNews.trim(),
        current_equity: equityValue,
        current_daily_pnl: 0,
        historical_data: buildHistoricalData(symbol, 120),
      });
      setResult(response);
      notifyOutcome(response);
    } catch (requestError) {
      notifyError(requestError, "Trade evaluation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const report = result?.vectorbt_validation;
  const risk = result?.risk_allocation;
  const signal = result?.trade_signal;
  const execution = result?.broker_execution;

  return (
    <section className="glass-panel p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-amber-500">
            Agent evaluation
          </p>
          <h2 className="mt-1 text-xl font-medium text-zinc-100">
            Evaluate a trade
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Pick a ticker and the agent fetches Alpaca bars, news, and account
            equity, then runs the five-swimlane decision engine.
          </p>
        </div>
      </div>

      <form onSubmit={runAgent} className="mt-5 space-y-4">
        <div>
          <label
            htmlFor="ticker"
            className="mb-1.5 block text-xs font-medium text-zinc-400"
          >
            Ticker
          </label>
          <input
            id="ticker"
            value={ticker}
            onChange={(event) => setTicker(event.target.value.toUpperCase())}
            placeholder="AAPL"
            className={`${inputClass} font-mono uppercase`}
            maxLength={8}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_PICKS.map((symbol) => (
              <button
                key={symbol}
                type="button"
                onClick={() => setTicker(symbol)}
                className={`rounded-md border px-2.5 py-1 font-mono text-xs transition-colors ${
                  ticker === symbol
                    ? "border-amber-700 bg-amber-950/30 text-amber-300"
                    : "border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                {symbol}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(event) => setDryRun(event.target.checked)}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-amber-500"
              />
              Dry run — decide without submitting an order
            </label>
            {!dryRun ? (
              <p className="text-xs font-medium text-amber-300">
                A live paper order will be submitted to Alpaca.
              </p>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {submitting ? "Running evaluation…" : "Run evaluation"}
          </button>
        </div>
      </form>

      {submitting ? (
        <div className="mt-5">
          <PipelineProgress activeStep={activeStep} />
        </div>
      ) : null}

      <details className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/40">
        <summary className="cursor-pointer select-none px-4 py-3 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200">
          Manual simulation
        </summary>
        <form onSubmit={runManual} className="space-y-4 border-t border-zinc-800 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="manual-equity"
                className="mb-1.5 block text-xs font-medium text-zinc-400"
              >
                Current equity (USD)
              </label>
              <input
                id="manual-equity"
                type="number"
                min="1"
                step="0.01"
                value={manualEquity}
                onChange={(event) => setManualEquity(event.target.value)}
                placeholder="10000"
                className={`${inputClass} font-mono`}
              />
            </div>
            <div className="flex items-end">
              <p className="text-xs leading-relaxed text-zinc-500">
                120 synthetic OHLCV bars are generated from the ticker seed for
                the regime and backtest lanes.
              </p>
            </div>
          </div>

          <div>
            <label
              htmlFor="manual-news"
              className="mb-1.5 block text-xs font-medium text-zinc-400"
            >
              News summary
            </label>
            <textarea
              id="manual-news"
              value={manualNews}
              onChange={(event) => setManualNews(event.target.value)}
              rows={3}
              placeholder="Company beats earnings, raises guidance amid resilient demand…"
              className={`${inputClass} resize-y`}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {submitting ? "Evaluating…" : "Evaluate with synthetic data"}
          </button>
        </form>
      </details>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-800/70 bg-red-950/50 px-3 py-2 text-xs font-medium text-red-300">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-6 space-y-5 border-t border-zinc-800 pt-5">
          <DataContextStrip result={result} />

          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={result.status} />
            {result.regime ? (
              <span className="text-xs text-zinc-400">
                Regime:{" "}
                <span className="font-medium text-zinc-200">{result.regime}</span>
              </span>
            ) : null}
            {result.trade_id ? (
              <span className="font-mono text-xs text-zinc-500">
                #{result.trade_id.slice(0, 8)}
              </span>
            ) : null}
          </div>

          {result.reason || result.details ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-300">
              {result.reason ?? result.details}
            </p>
          ) : null}

          {signal ? (
            <div>
              <div className="flex flex-wrap items-center gap-4">
                <p className="text-xs font-semibold text-zinc-500">
                  Agent verdict
                </p>
                <span
                  className={`font-mono text-lg font-medium ${directionColor(
                    signal.direction
                  )}`}
                >
                  {signal.direction}
                </span>
                <span className="text-xs text-zinc-400">
                  Conviction{" "}
                  <span className="font-mono text-zinc-200">
                    {formatConviction(signal.conviction)}
                  </span>
                </span>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-zinc-300">
                {signal.plain_language_reasoning}
              </p>
              {signal.bull_catalysts?.length ? (
                <div className="mt-3">
                  <p className="text-xs text-emerald-400">
                    Bull Catalysts
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-zinc-400">
                    {signal.bull_catalysts.map((item, index) => (
                      <li key={`bull-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {signal.bear_risks?.length ? (
                <div className="mt-3">
                  <p className="text-xs text-red-400">
                    Bear Risks
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-zinc-400">
                    {signal.bear_risks.map((item, index) => (
                      <li key={`bear-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {risk ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-zinc-500">
                Risk metrics
              </p>
              <div className="grid grid-cols-2 gap-3 border-l-2 border-amber-700 pl-4 sm:grid-cols-4">
                <Stat label="Shares" value={formatNumber(risk.shares)} />
                <Stat
                  label="Allocated"
                  value={formatCurrency(risk.allocated_capital)}
                  accent="text-amber-400"
                />
                <Stat
                  label="Stop Loss"
                  value={formatCurrency(risk.stop_loss_price)}
                  accent="text-red-300"
                />
                <Stat
                  label="Risk"
                  value={formatPercent(risk.risk_percentage)}
                />
              </div>
            </div>
          ) : null}

          {report ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-zinc-500">
                VectorBT validation
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Strategy Return"
                  value={formatPercent(report.strategy_total_return_pct)}
                />
                <Stat
                  label="Benchmark"
                  value={formatPercent(report.benchmark_total_return_pct)}
                />
                <Stat
                  label="Sharpe"
                  value={formatNumber(report.strategy_sharpe_ratio)}
                />
                <Stat
                  label="Max Drawdown"
                  value={formatPercent(report.strategy_max_drawdown_pct)}
                />
              </div>
              <div className="mt-4">
                <BacktestChart report={report} />
              </div>
            </div>
          ) : null}

          {execution ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-zinc-500">
                Broker execution
              </p>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                <span
                  className={`h-2 w-2 rounded-full ${
                    execution.success ? "bg-emerald-400" : "bg-red-400"
                  }`}
                />
                <span className="font-mono text-sm text-zinc-200">
                  {execution.status ?? (execution.success ? "FILLED" : "FAILED")}
                </span>
                {execution.order_id ? (
                  <span className="font-mono text-xs text-zinc-500">
                    order {execution.order_id}
                  </span>
                ) : null}
                {execution.status === "DRY_RUN" ? (
                  <span className="text-xs text-zinc-400">
                    no order submitted
                  </span>
                ) : null}
                {execution.error ? (
                  <span className="text-xs text-red-300">{execution.error}</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
