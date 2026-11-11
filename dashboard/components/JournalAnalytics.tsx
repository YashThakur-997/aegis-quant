"use client";

import { Activity, ArrowLeftRight, Flame } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { fetchJournals, formatNumber, type JournalEntry } from "@/lib/api";

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  accent: string;
}) {
  return (
    <div className="glass-panel p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          {label}
        </p>
        <Icon size={15} className={accent} strokeWidth={1.75} />
      </div>
      <p
        className={`mt-3 font-mono text-2xl font-semibold tabular-nums ${accent}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-zinc-500">{detail}</p>
    </div>
  );
}

export default function JournalAnalytics() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await fetchJournals(200);
      setEntries(Array.isArray(data) ? data : []);
      setError("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load journal analytics."
      );
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [load]);

  const executed = entries.filter((entry) => entry.status === "EXECUTED").length;
  const longs = entries.filter((entry) => entry.action === "BUY").length;
  const shorts = entries.filter((entry) => entry.action === "SELL").length;
  const ratio =
    entries.length === 0
      ? "—"
      : shorts === 0
        ? `${longs} : 0`
        : `${(longs / shorts).toFixed(2)} : 1`;

  const tickerCounts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.ticker) continue;
    tickerCounts.set(entry.ticker, (tickerCounts.get(entry.ticker) ?? 0) + 1);
  }
  const mostTraded = [...tickerCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )[0];

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={Activity}
          label="Total Trades Executed"
          value={entries.length === 0 ? "—" : formatNumber(executed)}
          detail={`${formatNumber(entries.length)} total decisions on record`}
          accent="text-emerald-300"
        />
        <StatCard
          icon={ArrowLeftRight}
          label="Long vs. Short Ratio"
          value={ratio}
          detail={`${formatNumber(longs)} long · ${formatNumber(shorts)} short`}
          accent="text-sky-300"
        />
        <StatCard
          icon={Flame}
          label="Most Traded Ticker"
          value={mostTraded ? mostTraded[0] : "—"}
          detail={
            mostTraded
              ? `${formatNumber(mostTraded[1])} decisions in the journal`
              : "No journal activity yet"
          }
          accent="text-amber-300"
        />
      </div>
      {error ? (
        <p className="mt-2 text-[11px] text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
