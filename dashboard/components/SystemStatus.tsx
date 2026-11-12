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
    const onSystemUpdated = () => {
      void load();
    };
    window.addEventListener("aegis:system-updated", onSystemUpdated);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("aegis:system-updated", onSystemUpdated);
    };
  }, []);

  let label = "Checking desk status";
  let detail = "Reading system state";
  let dot = "bg-zinc-500";
  let tone = "text-zinc-300";

  if (killEngaged) {
    label = "Trading halted";
    detail = "Emergency stop is engaged";
    dot = "bg-red-500";
    tone = "text-red-300";
  } else if (error && !status) {
    label = "Desk offline";
    detail = error;
    dot = "bg-red-500";
    tone = "text-red-300";
  } else if (status && !status.worker_alive) {
    label = "Scanner offline";
    detail = "No heartbeat detected";
    dot = "bg-red-500";
    tone = "text-red-300";
  } else if (status?.paused) {
    label = "Scanner paused";
    detail = "Scheduled scans are on hold";
    dot = "bg-amber-400";
    tone = "text-amber-300";
  } else if (status?.dry_run) {
    label = "Review mode";
    detail = "No paper orders are sent";
    dot = "bg-blue-400";
    tone = "text-zinc-300";
  } else if (status) {
    label = "Scanner active";
    detail =
      status.market_open === false
        ? "Scanner live · market closed"
        : "Scanner live · paper account";
    dot = "bg-emerald-500";
    tone = "text-zinc-300";
  }

  return (
    <div
      role="status"
      aria-live="polite"
      title={detail}
      className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#13151a] px-3 py-2"
    >
      <span
        className={`h-2 w-2 rounded-full ${dot}`}
      />
      <div className="leading-tight">
        <span className={`text-sm ${tone}`}>{label}</span>
        <span className="hidden text-[10px] text-zinc-400 sm:block">
          {detail}
        </span>
      </div>
    </div>
  );
}
