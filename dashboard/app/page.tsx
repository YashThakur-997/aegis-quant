import JournalTable from "@/components/JournalTable";
import KillSwitchPanel from "@/components/KillSwitchPanel";
import TradeEvaluatorForm from "@/components/TradeEvaluatorForm";

export default function Home() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-500/40 bg-indigo-500/10 shadow-glow">
              <span className="font-mono text-lg font-bold text-indigo-300">
                Æ
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
                AEGIS<span className="text-indigo-400">-QUANT</span>
              </h1>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                Autonomous Trading Desk
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-300">
            Autonomous Mode
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <TradeEvaluatorForm />
        </div>
        <div className="lg:col-span-4">
          <KillSwitchPanel />
        </div>
      </div>

      <div className="mt-6">
        <JournalTable />
      </div>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-600">
        <span>AEGIS-QUANT · deterministic guardrails · sandbox execution</span>
        <span className="font-mono">API http://localhost:8000</span>
      </footer>
    </main>
  );
}
