"use client";

import { Check, Circle, Loader2 } from "lucide-react";

export const PIPELINE_STEPS = [
  "Ingesting Market OHLCV Data…",
  "Classifying HMM Market Regime…",
  "LangGraph Bull vs. Bear Debate…",
  "Calculating Cash-at-Risk Budget…",
  "Routing Alpaca Sandbox Order…",
] as const;

export default function PipelineProgress({
  activeStep,
}: {
  activeStep: number;
}) {
  const total = PIPELINE_STEPS.length;
  const progress = Math.round(((activeStep + 1) / total) * 100);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-blue-300">
          AI Brain · Pipeline
        </p>
        <span className="font-mono text-[11px] tabular-nums text-zinc-400">
          {progress}%
        </span>
      </div>

      <div
        role="progressbar"
        aria-label="Evaluation pipeline progress"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-3 h-1 overflow-hidden rounded-full bg-zinc-800"
      >
        <div
          className="h-full rounded-full bg-blue-400 transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <ol className="mt-4 space-y-2.5">
        {PIPELINE_STEPS.map((label, index) => {
          const done = index < activeStep;
          const active = index === activeStep;
          return (
            <li key={label} className="flex items-center gap-3">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                  done
                    ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-300"
                    : active
                      ? "border-blue-500/60 bg-blue-500/10 text-blue-300"
                      : "border-zinc-800 bg-zinc-900/40 text-zinc-400"
                }`}
              >
                {done ? (
                  <Check size={12} strokeWidth={3} />
                ) : active ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Circle size={7} />
                )}
              </span>
              <span
                className={`text-xs ${
                  done
                    ? "text-zinc-300"
                    : active
                      ? "font-medium text-zinc-100"
                      : "text-zinc-400"
                }`}
              >
                <span className="mr-2 font-mono text-[10px] text-zinc-400">
                  0{index + 1}
                </span>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
