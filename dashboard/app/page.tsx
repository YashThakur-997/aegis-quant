import JournalAnalytics from "@/components/JournalAnalytics";
import JournalTable from "@/components/JournalTable";
import KillSwitchPanel from "@/components/KillSwitchPanel";
import ScannerStatus from "@/components/ScannerStatus";
import SystemStatus from "@/components/SystemStatus";
import TradeEvaluatorForm from "@/components/TradeEvaluatorForm";
import { API_BASE } from "@/lib/api";

export default function Home() {
  return (
    <main className="relative mx-auto max-w-screen-2xl px-4 py-6 sm:px-8 sm:py-8 lg:px-10">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute right-0 top-1/3 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900">
              <span className="font-mono text-lg font-medium text-amber-500">
                Æ
              </span>
            </div>
            <div>
              <h1 className="text-xl font-medium text-zinc-100 sm:text-2xl">
                AEGIS-QUANT
              </h1>
              <p className="mt-1 text-sm text-zinc-400">
                Autonomous trading desk
              </p>
            </div>
          </div>
        </div>

        <SystemStatus />
      </header>

      <JournalAnalytics />

      <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-6 sm:gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <TradeEvaluatorForm />
        </div>
        <div className="lg:col-span-4">
          <div className="flex flex-col gap-4 sm:gap-6">
            <ScannerStatus />
            <KillSwitchPanel />
          </div>
        </div>
      </div>

      <div className="mt-4 sm:mt-6">
        <JournalTable />
      </div>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-4 text-xs text-zinc-500">
        <span>AEGIS-QUANT · deterministic guardrails · sandbox execution</span>
        <span className="break-all font-mono">API {API_BASE}</span>
      </footer>
    </main>
  );
}
