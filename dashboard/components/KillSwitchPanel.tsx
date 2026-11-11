"use client";

import { useState } from "react";

import { triggerKillSwitch } from "@/lib/api";

type State = "idle" | "loading" | "success" | "error";

export default function KillSwitchPanel() {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  async function fire() {
    const confirmed = window.confirm(
      "Engage the emergency kill-switch? This immediately halts all autonomous trading."
    );
    if (!confirmed) return;

    setState("loading");
    setMessage("");

    try {
      const result = await triggerKillSwitch("Manual override from dashboard");
      setState("success");
      setMessage(result.status);
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "Failed to engage kill-switch."
      );
    }
  }

  const engaged = state === "success";

  return (
    <section className="rounded-2xl border border-zinc-800 border-l-2 border-l-red-700 bg-zinc-900 p-6">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <span className="text-xs font-medium text-red-400">
          Emergency control
        </span>
      </div>

      <h2 className="mt-3 text-xl font-medium text-zinc-100">Kill switch</h2>
      <p className="mt-1 text-sm leading-relaxed text-zinc-400">
        Trips the circuit breaker and freezes every downstream trade decision.
      </p>

      <button
        type="button"
        onClick={fire}
        disabled={state === "loading" || engaged}
        className="mt-6 w-full rounded-lg border border-red-800 bg-zinc-950 px-4 py-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {state === "loading"
          ? "Engaging…"
          : engaged
            ? "Lockout engaged"
            : "Trigger kill switch"}
      </button>

      {message ? (
        <p
          className={`mt-4 rounded-lg border px-3 py-2 text-xs font-medium ${
            state === "error"
              ? "border-red-800/70 bg-red-950/60 text-red-300"
              : "border-red-700/60 bg-red-900/30 text-red-200"
          }`}
        >
          {message}
        </p>
      ) : null}

      <p className="mt-4 text-xs text-zinc-500">
        POST /api/v1/kill-switch/trigger
      </p>
    </section>
  );
}
