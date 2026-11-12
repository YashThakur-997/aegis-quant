"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import ScannerSettings from "@/components/ScannerSettings";
import {
  fetchScanStatus,
  formatTimestamp,
  pauseScanner,
  resumeScanner,
  type ScanStatus,
} from "@/lib/api";

function ResultPill({ status }: { status: string }) {
  const palette =
    status === "EXECUTED"
      ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-300"
      : status === "DRY_RUN"
        ? "border-zinc-700 bg-zinc-800 text-zinc-300"
        : status === "HOLD"
          ? "border-amber-700/60 bg-amber-900/30 text-amber-300"
          : status === "ERROR"
            ? "border-red-800/70 bg-red-950/60 text-red-300"
            : "border-zinc-700/60 bg-zinc-800/40 text-zinc-400";

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${palette}`}
    >
      {status
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())}
    </span>
  );
}

export default function ScannerStatus() {
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await fetchScanStatus();
      setStatus(data);
      setError("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load scanner status."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const interval = window.setInterval(() => {
      void load(false);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [load]);

  async function toggle() {
    if (!status || toggling) return;
    const willPause = !status.paused;
    setToggling(true);
    setError("");
    try {
      if (willPause) {
        await pauseScanner();
        toast.info("Scanner paused", {
          description: "Scheduled sweeps are on hold.",
        });
      } else {
        await resumeScanner();
        toast.success("Scanner resumed", {
          description: "Scheduled sweeps are active.",
        });
      }
      await load(false);
      window.dispatchEvent(new Event("aegis:system-updated"));
    } catch (requestError) {
      const detail =
        requestError instanceof Error
          ? requestError.message
          : "Unable to change scanner state.";
      setError(detail);
      toast.error("Scanner update failed", { description: detail });
    } finally {
      setToggling(false);
    }
  }

  const paused = status?.paused ?? false;
  const online = status?.worker_alive ?? false;
  const dotColor = paused
    ? "bg-amber-400"
    : online
      ? "bg-emerald-400"
      : "bg-red-500";

  const marketLabel = !status
    ? "—"
    : !status.market_hours_only
      ? "24/7"
      : status.market_open === null
        ? "Unknown"
        : status.market_open
          ? "Open"
          : "Closed";

  const lastScan = status?.last_scan ?? null;

  return (
    <section className="glass-panel p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${dotColor}`} />
            <span className="text-xs font-semibold text-amber-500">
              Scheduled scanner
            </span>
          </div>
          <h2 className="mt-2 text-xl font-medium text-zinc-100">
            {paused ? "Paused" : online ? "Watching the tape" : "Worker offline"}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={!status || toggling}
          aria-label={paused ? "Resume scanner" : "Pause scanner"}
          className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            paused
              ? "border-emerald-700 bg-emerald-900/40 text-emerald-200 hover:border-emerald-500"
              : "border-zinc-700 bg-zinc-950/60 text-zinc-300 hover:border-amber-500 hover:text-amber-300"
          }`}
        >
          {toggling ? "…" : paused ? "Resume" : "Pause"}
        </button>
      </div>

      {loading && !status ? (
        <p className="mt-4 text-xs text-zinc-400">Loading scanner state…</p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 break-words rounded-lg border border-red-800/70 bg-red-950/50 px-3 py-2 text-xs text-red-300"
        >
          {error}
        </p>
      ) : null}

      {status ? (
        <>
          <dl className="mt-5 grid grid-cols-1 gap-3 text-xs min-[360px]:grid-cols-2">
            <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
              <dt className="text-xs text-zinc-400">Interval</dt>
              <dd className="mt-1 font-mono text-zinc-200">
                {status.interval_minutes} min
              </dd>
            </div>
            <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
              <dt className="text-xs text-zinc-400">Mode</dt>
              <dd className="mt-1 font-mono text-zinc-200">
                {status.dry_run ? "Dry run" : "Live paper"}
              </dd>
            </div>
            <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
              <dt className="text-xs text-zinc-400">Market</dt>
              <dd className="mt-1 font-mono text-zinc-200">{marketLabel}</dd>
            </div>
            <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
              <dt className="text-xs text-zinc-400">Next sweep</dt>
              <dd className="mt-1 break-words font-mono text-zinc-200">
                {paused ? "—" : formatTimestamp(status.next_run_at)}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            {status.watchlist.map((symbol) => (
              <span
                key={symbol}
                className="rounded border border-zinc-700/70 bg-zinc-950/60 px-2 py-0.5 font-mono text-xs text-zinc-300"
              >
                {symbol}
              </span>
            ))}
          </div>

          <p className="mt-2 font-mono text-xs text-zinc-400">
            Batch {status.batch_index}/{status.batch_count} ·{" "}
            {status.universe_size}-symbol universe · rotates each sweep
          </p>

          <div className="mt-5 border-t border-zinc-800 pt-4">
            <p className="text-xs text-zinc-400">
              Last sweep · {lastScan ? formatTimestamp(lastScan.started_at) : "—"}
            </p>

            {!lastScan ? (
              <p className="mt-2 text-xs text-zinc-400">
                No scans recorded yet.
              </p>
            ) : lastScan.skipped ? (
              <p className="mt-2 text-xs text-amber-300">
                Skipped: {lastScan.skipped}
              </p>
            ) : lastScan.results.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-400">
                Scan finished with no results.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {lastScan.results.map((result, index) => (
                  <li
                    key={`${result.ticker}-${result.status}-${index}`}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="min-w-0 truncate font-mono text-xs font-semibold text-zinc-200">
                      {result.ticker}
                      {result.action ? (
                        <span className="ml-2 text-xs font-normal text-zinc-400">
                          {result.action}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0">
                      <ResultPill status={result.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {!online ? (
              <p className="mt-3 text-xs text-red-400">
                No worker heartbeat detected. Start the `worker` service.
              </p>
            ) : null}

            {status.skip_held ? (
              <p className="mt-3 text-xs text-zinc-400">
                Skips tickers with an open position (exit automation off).
              </p>
            ) : null}
          </div>

          <ScannerSettings
            onSaved={() => {
              void load(false);
              window.dispatchEvent(new Event("aegis:system-updated"));
            }}
          />
        </>
      ) : null}
    </section>
  );
}
