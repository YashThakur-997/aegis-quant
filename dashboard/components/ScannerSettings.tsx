"use client";

import {
  ChevronDown,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  fetchScanConfig,
  refreshScanUniverse,
  resetScanConfig,
  updateScanConfig,
  type ScanConfig,
  type ScanConfigUpdate,
  type UniverseMode,
} from "@/lib/api";

type FormState = {
  mode: UniverseMode;
  universeText: string;
  size: string;
  minPrice: string;
  batch: string;
  interval: string;
  dryRun: boolean;
  skipHeld: boolean;
  marketHours: boolean;
};

const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-2 font-mono text-xs text-zinc-100 outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30";

const labelClass = "mb-1 block text-xs font-medium text-zinc-400";

function parseSymbols(text: string): string[] {
  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const symbol = part.trim().toUpperCase();
    if (!symbol || symbol.length > 10 || seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
  }
  return symbols;
}

function toForm(config: ScanConfig): FormState {
  return {
    mode: config.universe_mode,
    universeText: config.universe.join(", "),
    size: String(config.universe_size),
    minPrice: String(config.universe_min_price),
    batch: String(config.batch_size),
    interval: String(config.interval_minutes),
    dryRun: config.dry_run,
    skipHeld: config.skip_held,
    marketHours: config.market_hours_only,
  };
}

function numberField(raw: string, low: number, high: number): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < low || value > high) return null;
  return value;
}

export default function ScannerSettings({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ScanConfig | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "reset" | "refresh" | null>(null);
  const [error, setError] = useState("");

  const applyConfig = useCallback((data: ScanConfig) => {
    setConfig(data);
    setForm(toForm(data));
    setError("");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      applyConfig(await fetchScanConfig());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load scanner settings."
      );
    } finally {
      setLoading(false);
    }
  }, [applyConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  function patch(update: Partial<FormState>) {
    setForm((current) => (current ? { ...current, ...update } : current));
  }

  async function save() {
    if (!form) return;
    setError("");

    const batch = numberField(form.batch, 1, 100);
    const interval = numberField(form.interval, 1, 1440);
    if (batch === null) {
      setError("Batch size must be between 1 and 100.");
      return;
    }
    if (interval === null) {
      setError("Interval must be between 1 and 1440 minutes.");
      return;
    }

    const payload: ScanConfigUpdate = {
      universe_mode: form.mode,
      batch_size: Math.round(batch),
      interval_minutes: Math.round(interval),
      dry_run: form.dryRun,
      skip_held: form.skipHeld,
      market_hours_only: form.marketHours,
    };

    if (form.mode === "static") {
      const symbols = parseSymbols(form.universeText);
      if (symbols.length === 0) {
        setError("Enter at least one ticker for the static universe.");
        return;
      }
      if (symbols.length > 100) {
        setError("The static universe cannot exceed 100 symbols.");
        return;
      }
      payload.universe = symbols;
    } else {
      const size = numberField(form.size, 1, 100);
      const minPrice = numberField(form.minPrice, 0, 10000);
      if (size === null) {
        setError("Universe size must be between 1 and 100.");
        return;
      }
      if (minPrice === null) {
        setError("Minimum price must be between 0 and 10000.");
        return;
      }
      payload.universe_size = Math.round(size);
      payload.universe_min_price = minPrice;
    }

    setBusy("save");
    try {
      applyConfig(await updateScanConfig(payload));
      toast.success("Scanner settings saved", {
        description:
          "New universe and batch settings apply on the next sweep.",
      });
      onSaved?.();
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unable to save scanner settings.";
      setError(message);
      toast.error("Save failed", { description: message });
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!window.confirm("Clear dashboard overrides and use environment defaults?")) {
      return;
    }
    setBusy("reset");
    setError("");
    try {
      applyConfig(await resetScanConfig());
      toast.info("Overrides cleared", {
        description: "Scanner is back on its environment defaults.",
      });
      onSaved?.();
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unable to reset scanner settings.";
      setError(message);
      toast.error("Reset failed", { description: message });
    } finally {
      setBusy(null);
    }
  }

  async function refreshUniverse() {
    setBusy("refresh");
    setError("");
    try {
      const refreshed = await refreshScanUniverse();
      applyConfig(await fetchScanConfig());
      toast.success("Universe refreshed", {
        description: `${refreshed.count} symbols · ${refreshed.source}`,
      });
      onSaved?.();
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unable to refresh the universe.";
      setError(message);
      toast.error("Refresh failed", { description: message });
    } finally {
      setBusy(null);
    }
  }

  const symbols = form ? parseSymbols(form.universeText) : [];
  const resolved = config?.resolved_universe ?? [];

  return (
    <div className="mt-5 border-t border-zinc-800 pt-4">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal size={14} className="text-amber-500" />
          Scanner settings
          {config && config.overrides_active.length > 0 ? (
            <span className="rounded-full border border-amber-700/60 bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-mono text-amber-300">
              {config.overrides_active.length} override
              {config.overrides_active.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </span>
        <ChevronDown
          size={14}
          className={`text-zinc-500 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open ? (
        <div className="mt-3 space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-3 sm:p-4">
          {loading && !form ? (
            <p className="text-xs text-zinc-500">Loading settings…</p>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-red-800/70 bg-red-950/50 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          ) : null}

          {form ? (
            <>
              <div>
                <span className={labelClass}>Universe mode</span>
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
                  {(
                    [
                      ["static", "Static list"],
                      ["most_active", "Most active"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => patch({ mode })}
                      className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                        form.mode === mode
                          ? "bg-zinc-700 text-zinc-100"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {form.mode === "static" ? (
                <div>
                  <label htmlFor="scanner-universe" className={labelClass}>
                    Tickers
                  </label>
                  <textarea
                    id="scanner-universe"
                    rows={3}
                    value={form.universeText}
                    onChange={(event) =>
                      patch({ universeText: event.target.value })
                    }
                    placeholder="AAPL, MSFT, NVDA"
                    className={`${inputClass} resize-y uppercase`}
                  />
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {symbols.length} symbol{symbols.length === 1 ? "" : "s"} ·
                    comma or newline separated
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="scanner-size" className={labelClass}>
                      Top N symbols
                    </label>
                    <input
                      id="scanner-size"
                      type="number"
                      min="1"
                      max="100"
                      value={form.size}
                      onChange={(event) => patch({ size: event.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="scanner-min-price" className={labelClass}>
                      Min price (USD)
                    </label>
                    <input
                      id="scanner-min-price"
                      type="number"
                      min="0"
                      max="10000"
                      step="0.01"
                      value={form.minPrice}
                      onChange={(event) =>
                        patch({ minPrice: event.target.value })
                      }
                      className={inputClass}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="scanner-batch" className={labelClass}>
                    Batch size
                  </label>
                  <input
                    id="scanner-batch"
                    type="number"
                    min="1"
                    max="100"
                    value={form.batch}
                    onChange={(event) => patch({ batch: event.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="scanner-interval" className={labelClass}>
                    Interval (min)
                  </label>
                  <input
                    id="scanner-interval"
                    type="number"
                    min="1"
                    max="1440"
                    value={form.interval}
                    onChange={(event) => patch({ interval: event.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="space-y-2 text-xs text-zinc-400">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.dryRun}
                    onChange={(event) => patch({ dryRun: event.target.checked })}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-amber-500"
                  />
                  Dry run — decide without submitting orders
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.skipHeld}
                    onChange={(event) =>
                      patch({ skipHeld: event.target.checked })
                    }
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-amber-500"
                  />
                  Skip tickers with an open position
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.marketHours}
                    onChange={(event) =>
                      patch({ marketHours: event.target.checked })
                    }
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-amber-500"
                  />
                  Only sweep while the market is open
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save size={13} />
                  {busy === "save" ? "Saving…" : "Save settings"}
                </button>
                {form.mode === "most_active" ? (
                  <button
                    type="button"
                    onClick={() => void refreshUniverse()}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-amber-700 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCw size={13} />
                    {busy === "refresh" ? "Refreshing…" : "Refresh universe"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void reset()}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RotateCcw size={13} />
                  {busy === "reset" ? "Resetting…" : "Reset to env"}
                </button>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                <p className="text-[11px] text-zinc-500">
                  Resolved universe ·{" "}
                  <span className="font-mono text-zinc-300">
                    {resolved.length} symbols
                  </span>{" "}
                  · {config?.universe_source ?? "—"}
                </p>
                <p className="mt-1 font-mono text-[11px] leading-relaxed text-zinc-400">
                  {resolved.slice(0, 14).join(", ")}
                  {resolved.length > 14
                    ? ` +${resolved.length - 14} more`
                    : ""}
                </p>
                <p className="mt-2 text-[11px] text-zinc-600">
                  Universe and batch changes apply on the next sweep. Interval
                  changes reach the worker within 60 seconds.
                </p>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
