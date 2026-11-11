"use client";

import { useCallback, useEffect, useState } from "react";

import {
  fetchJournals,
  formatConviction,
  formatCurrency,
  formatNumber,
  formatTimestamp,
  type JournalEntry,
} from "@/lib/api";

function StatusPill({ status }: { status: string }) {
  const palette =
    status === "EXECUTED"
      ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-300"
      : status === "HOLD"
        ? "border-amber-700/60 bg-amber-900/30 text-amber-300"
        : status === "REJECTED"
          ? "border-red-800/70 bg-red-950/60 text-red-300"
          : "border-zinc-700/60 bg-zinc-800/40 text-zinc-300";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${palette}`}
    >
      {status}
    </span>
  );
}

function ActionTag({ action }: { action: string }) {
  const color =
    action === "BUY"
      ? "text-emerald-400"
      : action === "SELL"
        ? "text-red-400"
        : "text-amber-400";
  return (
    <span className={`font-mono text-xs font-bold ${color}`}>{action}</span>
  );
}

export default function JournalTable() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await fetchJournals(50);
      setEntries(Array.isArray(data) ? data : []);
      setError("");
      setLastUpdated(new Date());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load trade journal."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const interval = window.setInterval(() => {
      void load(false);
    }, 7000);
    return () => window.clearInterval(interval);
  }, [load]);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 shadow-xl backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-6 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-400">
            Audit Trail
          </p>
          <h2 className="mt-1 text-xl font-semibold text-zinc-100">
            Live Trade Journal
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            auto-refresh 7s
          </span>
          <button
            type="button"
            onClick={() => void load(true)}
            className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-indigo-500 hover:text-indigo-300"
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="mx-6 mt-4 rounded-lg border border-red-800/70 bg-red-950/50 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              <th className="px-6 py-3 font-medium">Time</th>
              <th className="px-3 py-3 font-medium">Ticker</th>
              <th className="px-3 py-3 font-medium">Action</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 text-right font-medium">Shares</th>
              <th className="px-3 py-3 text-right font-medium">Capital</th>
              <th className="px-3 py-3 text-right font-medium">Stop</th>
              <th className="px-3 py-3 font-medium">Regime</th>
              <th className="px-3 py-3 text-right font-medium">Conv.</th>
              <th className="px-6 py-3 font-medium">Trade Diary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {loading && entries.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-6 py-10 text-center text-xs text-zinc-500"
                >
                  Loading audit log…
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-6 py-10 text-center text-xs text-zinc-500"
                >
                  No journal entries yet. Evaluate a trade to populate the audit
                  trail.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr
                  key={entry.trade_id}
                  className="transition hover:bg-zinc-900/70"
                >
                  <td className="whitespace-nowrap px-6 py-3 font-mono text-[11px] text-zinc-400">
                    {formatTimestamp(entry.timestamp)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs font-semibold text-zinc-100">
                    {entry.ticker}
                  </td>
                  <td className="px-3 py-3">
                    <ActionTag action={entry.action} />
                  </td>
                  <td className="px-3 py-3">
                    <StatusPill status={entry.status} />
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs text-zinc-300">
                    {formatNumber(entry.shares)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs text-zinc-300">
                    {formatCurrency(entry.allocated_capital)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs text-zinc-300">
                    {formatCurrency(entry.stop_loss_price)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs text-zinc-400">
                    {entry.regime ?? "—"}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs text-indigo-300">
                    {formatConviction(entry.conviction)}
                  </td>
                  <td className="max-w-md px-6 py-3">
                    <p
                      title={entry.plain_language_reasoning ?? ""}
                      className="line-clamp-3 text-xs leading-relaxed text-zinc-400"
                    >
                      {entry.plain_language_reasoning ?? "—"}
                    </p>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 px-6 py-3 text-[11px] text-zinc-500">
        <span>
          {entries.length} {entries.length === 1 ? "entry" : "entries"} shown
        </span>
        <span>
          {lastUpdated
            ? `Last sync ${lastUpdated.toLocaleTimeString("en-US")}`
            : "GET /api/v1/journals"}
        </span>
      </div>
    </section>
  );
}
