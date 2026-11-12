"use client";

import { Activity, ArrowLeftRight, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { fetchJournals, formatNumber, type JournalEntry } from "@/lib/api";

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "text-zinc-100",
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className="glass-panel p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-400">{label}</p>
        <Icon size={16} className="text-zinc-500" strokeWidth={1.6} />
      </div>
      <p className={`mt-4 font-mono text-2xl font-medium tabular-nums ${tone}`}>{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{detail}</p>
    </div>
  );
}

export default function JournalAnalytics() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 15000);
    const onUpdated = () => {
      void load();
    };
    window.addEventListener("aegis:journal-updated", onUpdated);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("aegis:journal-updated", onUpdated);
    };
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
  const dayCounts = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (6 - index));
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    return {
      label: day.toLocaleDateString(undefined, { weekday: "short" }),
      count: entries.filter((entry) => {
        if (!entry.timestamp) return false;
        const timestamp = new Date(entry.timestamp);
        return timestamp >= day && timestamp < nextDay;
      }).length,
    };
  });
  const maxCount = Math.max(...dayCounts.map((day) => day.count), 1);

  if (loading && entries.length === 0 && !error) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass-panel p-5 opacity-60">
            <div className="flex items-center justify-between">
              <div className="h-3 w-24 rounded bg-zinc-800" />
              <div className="h-4 w-4 rounded bg-zinc-800" />
            </div>
            <div className="mt-3 h-7 w-16 rounded bg-zinc-800" />
            <div className="mt-1 h-3 w-32 rounded bg-zinc-800" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={Activity}
          label="Executed trades"
          value={entries.length === 0 ? "—" : formatNumber(executed)}
          detail={`${formatNumber(entries.length)} decisions on record`}
          tone="text-emerald-300"
        />
        <StatCard
          icon={ArrowLeftRight}
          label="Long / short balance"
          value={ratio}
          detail={`${formatNumber(longs)} long · ${formatNumber(shorts)} short`}
        />
        <StatCard
          icon={TrendingUp}
          label="Most reviewed symbol"
          value={mostTraded ? mostTraded[0] : "—"}
          detail={
            mostTraded
              ? `${formatNumber(mostTraded[1])} decisions in the journal`
              : "No journal activity yet"
          }
        />
      </div>
      <section className="glass-panel mt-4 p-5 sm:p-6" aria-label="Decision activity over seven days">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-100">Seven-day decision activity</p>
            <p className="mt-1 text-xs text-zinc-500">Completed reviews recorded in your journal</p>
          </div>
          <span className="font-mono text-xs tabular-nums text-blue-300">{entries.length} total</span>
        </div>
        <div className="mt-6 grid h-32 grid-cols-7 items-end gap-2 border-b border-white/[0.08] pb-1 sm:gap-4">
          {dayCounts.map((day) => (
            <div key={day.label} className="flex h-full min-w-0 flex-col justify-end gap-2">
              <span className="text-center font-mono text-xs tabular-nums text-zinc-500">{day.count || ""}</span>
              <div className="min-h-[3px] rounded-sm bg-blue-400/80 transition-[height] duration-200" style={{ height: `${Math.max((day.count / maxCount) * 100, day.count ? 8 : 3)}%` }} />
              <span className="text-center text-xs text-zinc-500">{day.label}</span>
            </div>
          ))}
        </div>
      </section>
      {error ? (
        <p role="alert" className="mt-2 text-[11px] text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
