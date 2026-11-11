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
    <section className="relative overflow-hidden rounded-2xl border border-red-900/60 bg-gradient-to-br from-red-950/50 via-zinc-900/70 to-zinc-900/70 p-6 shadow-xl">
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-red-600/20 blur-3xl" />

      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-red-400">
          Emergency Control
        </span>
      </div>

      <h2 className="mt-3 text-xl font-semibold text-zinc-100">Kill-Switch</h2>
      <p className="mt-1 text-sm leading-relaxed text-zinc-400">
        Trips the circuit breaker and freezes every downstream trade decision.
      </p>

      <button
        type="button"
        onClick={fire}
        disabled={state === "loading" || engaged}
        className="mt-6 w-full rounded-xl bg-red-600 px-4 py-4 text-sm font-bold uppercase tracking-[0.18em] text-white shadow-lg shadow-red-950/60 transition hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {state === "loading"
          ? "Engaging…"
          : engaged
            ? "Lockout Engaged"
            : "Trigger Kill-Switch"}
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

      <p className="mt-4 text-[11px] text-zinc-500">
        POST /api/v1/kill-switch/trigger
      </p>
    </section>
  );
}
