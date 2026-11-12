"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { fetchKillSwitchStatus, triggerKillSwitch } from "@/lib/api";

type State = "idle" | "loading" | "success" | "error";

export default function KillSwitchPanel() {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(true);

  const syncStatus = useCallback(async () => {
    try {
      const status = await fetchKillSwitchStatus();
      if (status.engaged) {
        setState("success");
        setMessage("CRITICAL_LOCKOUT_ENGAGED");
      }
    } catch {
      // Leave panel interactive if initial read fails; SystemStatus reports reachability.
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void syncStatus();
    const onSystemUpdated = () => {
      void syncStatus();
    };
    window.addEventListener("aegis:system-updated", onSystemUpdated);
    return () => {
      window.removeEventListener("aegis:system-updated", onSystemUpdated);
    };
  }, [syncStatus]);

  async function fire() {
    if (state === "loading" || state === "success") return;

    const confirmed = window.confirm(
      "Engage the emergency kill-switch? This immediately halts all autonomous trading."
    );
    if (!confirmed) return;

    setState("loading");
    setMessage("");

    try {
      const result = await triggerKillSwitch("Manual override from dashboard");
      setState("success");
      const cancelled = result.cancellation_result;
      setMessage(
        cancelled
          ? `${result.status} · cancelled ${cancelled.cancelled}/${cancelled.attempted} open paper orders`
          : result.status
      );
      window.dispatchEvent(new Event("aegis:system-updated"));
      toast.error("KILL-SWITCH ENGAGED", {
        description: cancelled
          ? `Trading halted; ${cancelled.cancelled}/${cancelled.attempted} open paper orders cancelled.`
          : "All autonomous trading has been halted.",
        duration: 8000,
      });
    } catch (error) {
      setState("error");
      const detail =
        error instanceof Error ? error.message : "Failed to engage kill-switch.";
      setMessage(detail);
      toast.error("Kill-switch failed", { description: detail });
    }
  }

  const engaged = state === "success";

  return (
    <section className="glass-panel border-l-2 border-l-red-700 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <span className="text-xs font-medium text-red-400">
          Emergency control
        </span>
      </div>

      <h2 className="mt-3 text-xl font-medium text-zinc-100">Kill switch</h2>
      <p className="mt-1 text-sm leading-relaxed text-zinc-400">
        Trips the circuit breaker, freezes new decisions, and attempts to cancel open paper orders.
      </p>

      <button
        type="button"
        onClick={fire}
        disabled={checking || state === "loading" || engaged}
        aria-label="Engage emergency kill switch"
        className="mt-6 w-full rounded-lg border border-red-800 bg-zinc-950 px-4 py-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {checking
          ? "Checking status…"
          : state === "loading"
            ? "Engaging…"
            : engaged
              ? "Lockout engaged"
              : "Trigger kill switch"}
      </button>

      {message ? (
        <p
          role="alert"
          className={`mt-4 break-words rounded-lg border px-3 py-2 font-mono text-xs font-medium ${
            state === "error"
              ? "border-red-800/70 bg-red-950/60 text-red-300"
              : "border-red-700/60 bg-red-900/30 text-red-200"
          }`}
        >
          {message}
        </p>
      ) : null}

      <p className="mt-4 text-xs text-zinc-400">
        POST /api/v1/kill-switch/trigger
      </p>
    </section>
  );
}
