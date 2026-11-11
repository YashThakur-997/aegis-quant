import type { JournalEntry } from "@/lib/api";

const COLUMNS: { key: keyof JournalEntry; label: string }[] = [
  { key: "trade_id", label: "trade_id" },
  { key: "timestamp", label: "timestamp" },
  { key: "ticker", label: "ticker" },
  { key: "action", label: "action" },
  { key: "status", label: "status" },
  { key: "shares", label: "shares" },
  { key: "allocated_capital", label: "allocated_capital" },
  { key: "stop_loss_price", label: "stop_loss_price" },
  { key: "regime", label: "regime" },
  { key: "conviction", label: "conviction" },
  { key: "plain_language_reasoning", label: "plain_language_reasoning" },
  { key: "bull_catalysts", label: "bull_catalysts" },
  { key: "bear_risks", label: "bear_risks" },
];

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join(" | ") : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function journalsToCsv(entries: JournalEntry[]): string {
  const header = COLUMNS.map((column) => column.label).join(",");
  const rows = entries.map((entry) =>
    COLUMNS.map((column) => escapeCell(entry[column.key])).join(",")
  );
  return "\uFEFF" + [header, ...rows].join("\r\n");
}

export function journalCsvFilename(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate()
  )}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `aegis-journal-${stamp}.csv`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
