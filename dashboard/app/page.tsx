import { BarChart3, BookOpen, LayoutDashboard, Radar, ShieldAlert } from "lucide-react";

import CopyrightYear from "@/components/CopyrightYear";
import JournalAnalytics from "@/components/JournalAnalytics";
import JournalTable from "@/components/JournalTable";
import KillSwitchPanel from "@/components/KillSwitchPanel";
import ScannerStatus from "@/components/ScannerStatus";
import SystemStatus from "@/components/SystemStatus";
import TradeEvaluatorForm from "@/components/TradeEvaluatorForm";
import { API_BASE } from "@/lib/api";

const navigation = [
  { href: "#overview", label: "Overview", icon: LayoutDashboard },
  { href: "#evaluate", label: "Evaluate", icon: BarChart3 },
  { href: "#scanner", label: "Scanner", icon: Radar },
  { href: "#journal", label: "Journal", icon: BookOpen },
  { href: "#risk", label: "Risk controls", icon: ShieldAlert },
];

function Brand() {
  return (
    <a href="#overview" className="flex items-center gap-3 rounded-lg">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-400/30 bg-blue-400/10 font-mono text-base font-medium text-blue-300">Æ</span>
      <span>
        <strong className="block text-sm font-medium tracking-[0.08em] text-zinc-100">AEGIS QUANT</strong>
        <span className="block text-xs text-zinc-500">Trading desk</span>
      </span>
    </a>
  );
}

function Navigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav aria-label="Workspace" className={mobile ? "flex min-w-max gap-1" : "space-y-1"}>
      {navigation.map(({ href, label, icon: Icon }) => (
        <a key={href} href={href} className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100 focus-visible:outline-none ${mobile ? "whitespace-nowrap" : "w-full"}`}>
          <Icon size={17} strokeWidth={1.6} className="text-zinc-500 transition-colors group-hover:text-blue-300" />
          {label}
        </a>
      ))}
    </nav>
  );
}

export default function Home() {
  return (
    <div className="mx-auto min-h-screen max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
      <header className="flex items-center justify-between gap-4 border-b border-white/[0.08] pb-4 lg:hidden">
        <Brand />
        <SystemStatus />
      </header>
      <div className="-mx-4 overflow-x-auto border-b border-white/[0.08] px-4 py-2 sm:-mx-6 sm:px-6 lg:hidden"><Navigation mobile /></div>

      <div className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-white/[0.08] lg:py-7 lg:pr-6">
          <Brand />
          <div className="mt-12"><p className="mb-2 px-3 text-xs text-zinc-600">Workspace</p><Navigation /></div>
          <p className="mt-auto border-t border-white/[0.08] px-3 pt-5 text-xs leading-relaxed text-zinc-500">Paper execution and deterministic guardrails</p>
        </aside>

        <main id="main-content" tabIndex={-1} className="min-w-0 py-7 outline-none lg:py-8">
          <section className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.08] pb-6">
            <div>
              <p className="text-sm text-zinc-500">Trading workspace</p>
              <h1 className="mt-1 text-2xl font-medium tracking-tight text-zinc-100 sm:text-3xl">Today&apos;s decisions</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">Review activity, evaluate a symbol, and keep your automated scanner under control.</p>
            </div>
            <SystemStatus />
          </section>

          <section id="overview" aria-labelledby="overview-title" className="scroll-mt-6">
            <div className="mb-4 flex items-center justify-between gap-3"><div><p className="desk-label">Overview</p><h2 id="overview-title" className="mt-1 text-lg font-medium text-zinc-100">Decision activity</h2></div><span className="hidden font-mono text-xs text-zinc-500 sm:block">LIVE JOURNAL</span></div>
            <JournalAnalytics />
          </section>

          <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
            <section id="evaluate" aria-labelledby="evaluate-title" className="scroll-mt-6"><div className="mb-4"><p className="desk-label">Trade review</p><h2 id="evaluate-title" className="mt-1 text-lg font-medium text-zinc-100">Evaluate an opportunity</h2></div><TradeEvaluatorForm /></section>
            <div className="space-y-6">
              <section id="scanner" aria-labelledby="scanner-title" className="scroll-mt-6"><div className="mb-4"><p className="desk-label">Market watch</p><h2 id="scanner-title" className="mt-1 text-lg font-medium text-zinc-100">Scanner</h2></div><ScannerStatus /></section>
              <section id="risk" aria-labelledby="risk-title" className="scroll-mt-6"><div className="mb-4"><p className="desk-label">Safety</p><h2 id="risk-title" className="mt-1 text-lg font-medium text-zinc-100">Risk controls</h2></div><KillSwitchPanel /></section>
            </div>
          </div>

          <section id="journal" aria-labelledby="journal-title" className="mt-8 scroll-mt-6"><div className="mb-4"><p className="desk-label">Audit trail</p><h2 id="journal-title" className="mt-1 text-lg font-medium text-zinc-100">Decision journal</h2></div><JournalTable /></section>
          <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] pt-4 text-xs text-zinc-500"><span>© <CopyrightYear /> AEGIS QUANT · paper trading only</span><span className="break-all font-mono">API {API_BASE}</span></footer>
        </main>
      </div>
    </div>
  );
}
