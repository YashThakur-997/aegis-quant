"use client";

import { useEffect, useState } from "react";

import {
  fetchKillSwitchStatus,
  fetchScanStatus,
  type ScanStatus,
} from "@/lib/api";

export default function SystemStatus() {
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [killEngaged, setKillEngaged] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [scan, kill] = await Promise.all([
          fetchScanStatus(),
          fetchKillSwitchStatus().catch(() => null),
        ]);
        if (!active) return;
        setStatus(scan);
        if (kill) setKillEngaged(kill.engaged);
        setError("");
      } catch (requestError) {
        if (!active) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "API unreachable."
        );
      }
    }

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 10000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  let label = "Connecting…";
  let detail = "Reading backend state";
  let dot = "bg-zinc-500";
  let tone = "text-zinc-300";

  if (killEngaged) {
    label = "Kill-switch engaged";
    detail = "All trading halted";
    dot = "bg-red-500";
    tone = "text-red-300";
  } else if (error && !status) {
    label = "API unreachable";
    detail = error;
    dot = "bg-red-500";
    tone = "text-red-300";
  } else if (status && !status.worker_alive) {
    label = "Worker offline";
    detail = "No heartbeat detected";
    dot = "bg-red-500";
    tone = "text-red-300";
  } else if (status?.paused) {
    label = "Scanner paused";
    detail = "Scheduled scans are on hold";
    dot = "bg-amber-400";
    tone = "text-amber-300";
  } else if (status?.dry_run) {
    label = "Dry run";
    detail = "No paper orders are sent";
    dot = "bg-amber-400";
    tone = "text-amber-300";
  } else if (status) {
    label = "Autonomous mode";
    detail =
      status.market_open === false
        ? "Scanner live · market closed"
        : "Scanner live · paper account";
    dot = "bg-emerald-500";
    tone = "text-zinc-300";
  }

  const pulsing = label === "Autonomous mode" && !status?.paused;

  return (
    <div
      title={detail}
      className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 backdrop-blur-md"
    >
      <span
        className={`h-2 w-2 rounded-full ${dot} ${pulsing ? "animate-pulse" : ""}`}
      />
      <div className="leading-tight">
        <span className={`text-sm ${tone}`}>{label}</span>
        <span className="hidden text-[10px] text-zinc-500 sm:block">
          {detail}
        </span>
      </div>
    </div>
  );
}
