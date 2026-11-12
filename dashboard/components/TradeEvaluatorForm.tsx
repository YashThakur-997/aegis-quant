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
const TICKER_PATTERN = /^[A-Z0-9.-]{1,10}$/;

const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 disabled:cursor-not-allowed disabled:opacity-60";

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
      <p className="text-xs text-zinc-400">{label}</p>
      <p className={`mt-1 font-mono text-sm font-semibold ${accent}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const palette =
    status === "SUCCESS" || status === "EXECUTED" || status === "PAPER_SUBMITTED"
      ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-300"
      : status === "DRY_RUN" || status === "SIMULATED"
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

  function notifyOutcome(response: EvaluateResponse, submittedSymbol: string) {
    const symbol = response.data_context?.ticker ?? submittedSymbol;
    const direction = response.trade_signal?.direction ?? "HOLD";

    if (response.status === "PAPER_SUBMITTED" || response.status === "SIMULATED") {
      if (response.broker_execution?.success === false) {
        toast.error(`${symbol} ${direction} order failed`, {
          description:
            response.broker_execution.error ?? "Broker execution failed.",
        });
      } else {
        toast.success(`${symbol} ${direction} ${response.status === "SIMULATED" ? "simulated" : "submitted"}`, {
          description: response.status === "SIMULATED" ? "Offline simulation only; no broker order was sent." : "Protective stop submitted to Alpaca paper.",
        });
      }
    } else if (response.status === "DRY_RUN") {
      toast.info(`${symbol} · ${direction} (dry run)`, {
        description: "Decision journaled. No order was sent.",
      });
    } else if (response.status === "HOLD") {
      toast.info(`${symbol} · holding`, {
        description: "Agent consensus was to stand down.",
      });
    } else if (response.status === "REJECTED_BY_RISK_ENGINE") {
      toast.warning(`${symbol} rejected by risk guardrails`, {
        description:
          response.details ?? response.reason ?? "Trade did not pass risk checks.",
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

  function validateSymbol(raw: string): string | null {
    const symbol = raw.trim().toUpperCase();
    if (!symbol) {
      setError("Ticker is required.");
      return null;
    }
    if (!TICKER_PATTERN.test(symbol)) {
      setError(
        "Enter a valid ticker symbol (1–10 letters, numbers, dots, or hyphens)."
      );
      return null;
    }
    return symbol;
  }

  async function runAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");

    const symbol = validateSymbol(ticker);
    if (!symbol) return;

    setSubmitting(true);
    setResult(null);

    try {
      const response = await analyzeTicker(symbol, dryRun);
      setResult(response);
      notifyOutcome(response, symbol);
      window.dispatchEvent(new Event("aegis:journal-updated"));
    } catch (requestError) {
      notifyError(requestError, "Agent run failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function runManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");

    const symbol = validateSymbol(ticker);
    if (!symbol) return;

    const equityValue = Number(manualEquity);
    if (!Number.isFinite(equityValue) || equityValue <= 0) {
      setError("Current equity must be a positive number.");
      return;
    }
    if (!manualNews.trim()) {
      setError("News summary is required for manual evaluation.");
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
      notifyOutcome(response, symbol);
      window.dispatchEvent(new Event("aegis:journal-updated"));
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
          <p className="text-xs font-medium text-blue-300">
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

      <form onSubmit={runAgent} noValidate className="mt-5 space-y-4">
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
            onChange={(event) => {
              setTicker(event.target.value.toUpperCase());
              if (error) setError("");
            }}
            disabled={submitting}
            placeholder="AAPL"
            aria-invalid={Boolean(error && error.toLowerCase().includes("ticker"))}
            aria-describedby={error ? "evaluator-error" : undefined}
            className={`${inputClass} font-mono uppercase`}
            maxLength={10}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_PICKS.map((symbol) => (
              <button
                key={symbol}
                type="button"
                disabled={submitting}
                aria-pressed={ticker === symbol}
                onClick={() => {
                  setTicker(symbol);
                  if (error) setError("");
                }}
                className={`rounded-md border px-2.5 py-1 font-mono text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  ticker === symbol
                    ? "border-blue-500/60 bg-blue-500/10 text-blue-200"
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
                disabled={submitting}
                onChange={(event) => setDryRun(event.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-zinc-700 bg-zinc-950 accent-blue-400"
              />
              Dry run — decide without submitting an order
            </label>
            {!dryRun ? (
              <p className="text-xs font-medium text-blue-200">
                A paper-only Alpaca bracket order with a protective stop will be submitted.
              </p>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
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
        <form
          onSubmit={runManual}
          noValidate
          className="space-y-4 border-t border-zinc-800 p-4"
        >
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
                disabled={submitting}
                value={manualEquity}
                onChange={(event) => {
                  setManualEquity(event.target.value);
                  if (error) setError("");
                }}
                aria-invalid={Boolean(error && error.toLowerCase().includes("equity"))}
                placeholder="10000"
                className={`${inputClass} font-mono`}
              />
            </div>
            <div className="flex items-end">
              <p className="text-xs leading-relaxed text-zinc-400">
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
              disabled={submitting}
              value={manualNews}
              onChange={(event) => {
                setManualNews(event.target.value);
                if (error) setError("");
              }}
              aria-invalid={Boolean(error && error.toLowerCase().includes("news"))}
              rows={3}
              placeholder="Company beats earnings, raises guidance amid resilient demand…"
              className={`${inputClass} resize-y`}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {submitting ? "Evaluating…" : "Evaluate with synthetic data"}
          </button>
        </form>
      </details>

      {error ? (
        <p
          id="evaluator-error"
          role="alert"
          className="mt-4 break-words rounded-lg border border-red-800/70 bg-red-950/50 px-3 py-2 text-xs font-medium text-red-300"
        >
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-6 space-y-5 border-t border-zinc-800 pt-5">
          <DataContextStrip result={result} />

          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge
              status={
                (result.status === "SUCCESS" || result.status === "EXECUTED") &&
                execution?.success === false
                  ? "ORDER_FAILED"
                  : result.status
              }
            />
            {result.regime ? (
              <span className="text-xs text-zinc-400">
                Regime:{" "}
                <span className="font-medium text-zinc-200">{result.regime}</span>
              </span>
            ) : null}
            {result.strategy ? (
              <span className="text-xs text-zinc-400">
                Policy:{" "}
                <span className="font-mono font-medium text-zinc-200">{result.strategy}</span>
              </span>
            ) : null}
            {result.trade_id ? (
              <span className="font-mono text-xs text-zinc-400">
                #{result.trade_id.slice(0, 8)}
              </span>
            ) : null}
          </div>

          {result.reason || result.details ? (
            <p className="break-words rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-300">
              {result.reason ?? result.details}
            </p>
          ) : null}

          {signal ? (
            <div>
              <div className="flex flex-wrap items-center gap-4">
                <p className="text-xs font-semibold text-zinc-400">
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
              <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-zinc-300">
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
              <p className="mb-2 text-xs font-semibold text-zinc-400">
                Risk metrics
              </p>
              <div className="grid grid-cols-2 gap-3 border-l-2 border-blue-500/70 pl-4 sm:grid-cols-4">
                <Stat label="Shares" value={formatNumber(risk.shares)} />
                <Stat
                  label="Allocated"
                  value={formatCurrency(risk.allocated_capital)}
                  accent="text-blue-300"
                />
                <Stat
                  label="Stop Loss"
                  value={formatCurrency(risk.stop_loss_price)}
                  accent="text-red-300"
                />
                <Stat
                  label="Take Profit"
                  value={formatCurrency(risk.take_profit_price)}
                  accent="text-emerald-300"
                />
                <Stat
                  label="Risk"
                  value={formatPercent(risk.risk_percentage)}
                />
                <Stat
                  label="Risk Budget"
                  value={formatCurrency(risk.risk_budget)}
                />
              </div>
            </div>
          ) : null}

          {report ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-zinc-400">
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
              <p className="mt-2 text-xs text-zinc-400">
                {report.evaluation_method ?? "Validation method unavailable"}
                {report.fee_bps !== undefined && report.slippage_bps !== undefined
                  ? ` · ${report.fee_bps} bps fees · ${report.slippage_bps} bps slippage`
                  : ""}
              </p>
              <div className="mt-4">
                <BacktestChart report={report} />
              </div>
            </div>
          ) : null}

          {execution ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-zinc-400">
                Broker execution
              </p>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    execution.success ? "bg-emerald-400" : "bg-red-400"
                  }`}
                />
                <span className="font-mono text-sm text-zinc-200">
                  {execution.status ?? (execution.success ? "FILLED" : "FAILED")}
                </span>
                {execution.mode ? (
                  <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
                    {execution.mode === "SIMULATED" ? "Simulation only" : "Alpaca paper"}
                  </span>
                ) : null}
                {execution.order_id ? (
                  <span className="break-all font-mono text-xs text-zinc-400">
                    order {execution.order_id}
                  </span>
                ) : null}
                {execution.protective_stop_attached ? (
                  <span className="text-xs text-emerald-300">
                    Protective stop {formatCurrency(execution.protective_stop_price)}
                  </span>
                ) : null}
                {execution.status === "DRY_RUN" ? (
                  <span className="text-xs text-zinc-400">
                    no order submitted
                  </span>
                ) : null}
                {execution.error ? (
                  <span className="break-words text-xs text-red-300">
                    {execution.error}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
