import Link from "next/link";

export default function NotFound() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 outline-none"
    >
      <div className="glass-panel mx-auto w-full max-w-md px-6 py-10 text-center sm:px-8 sm:py-12">
        <p className="font-mono text-sm font-medium uppercase tracking-widest text-amber-500">
          Error
        </p>
        <h1 className="mt-3 text-7xl font-bold tabular-nums text-zinc-100">
          404
        </h1>
        <p className="mt-4 text-zinc-400">
          This route does not exist on the trading desk.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-5 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:border-amber-500/50 hover:text-amber-500"
        >
          ← Back to dashboard
        </Link>
      </div>
    </main>
  );
}
