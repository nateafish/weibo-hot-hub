import type { DailyEntry, HotlistEntry, MetricValue } from "./types";

export function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" ? new Intl.NumberFormat("zh-CN").format(value) : "—";
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "未知";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

export function formatMetric(value?: MetricValue): string {
  if (!value || value.val === undefined || value.val === null) return "—";
  return `${value.val}${value.unit || ""}`;
}

export function sortByHeat<T extends HotlistEntry>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.heat === null && b.heat === null) return a.original_rank - b.original_rank;
    if (a.heat === null) return 1;
    if (b.heat === null) return -1;
    return b.heat - a.heat || a.original_rank - b.original_rank;
  });
}

export function filterHotlist<T extends HotlistEntry | DailyEntry>(
  entries: T[], query: string, label: string, minimumHeat: number,
): T[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    const heat = "peak_heat" in entry ? entry.peak_heat : entry.heat;
    return (!needle || entry.title.toLowerCase().includes(needle))
      && (!label || entry.label === label)
      && (!minimumHeat || (heat ?? 0) >= minimumHeat);
  });
}
