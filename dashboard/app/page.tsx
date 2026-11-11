import JournalTable from "@/components/JournalTable";
import KillSwitchPanel from "@/components/KillSwitchPanel";
import ScannerStatus from "@/components/ScannerStatus";
import TradeEvaluatorForm from "@/components/TradeEvaluatorForm";

export default function Home() {
  return (
    <main className="mx-auto max-w-screen-2xl px-5 py-8 sm:px-8 lg:px-10">
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

        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-sm text-zinc-300">
            Autonomous mode
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <TradeEvaluatorForm />
        </div>
        <div className="lg:col-span-4">
          <div className="flex flex-col gap-6">
            <ScannerStatus />
            <KillSwitchPanel />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <JournalTable />
      </div>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-4 text-xs text-zinc-500">
        <span>AEGIS-QUANT · deterministic guardrails · sandbox execution</span>
        <span className="font-mono">API http://localhost:8000</span>
      </footer>
    </main>
  );
}
