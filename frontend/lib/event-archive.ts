import { BASE_PATH } from "./data";

export interface EventMonth {
  month: string;
  first: string;
  last: string;
  hours: number;
  topics: number;
  grouped: number;
  event_count: number;
  scope: "pilot" | "month";
}

export interface EventAppearance {
  hour: string;
  rank: number;
  heat: number | null;
}

export interface EventMember {
  topic_id: string | null;
  title: string;
  reviewed: boolean;
  post_hour?: string | null;
  appearances: EventAppearance[];
}

export interface ArchiveEvent {
  id: string;
  title: string;
  revision: string;
  first: string;
  last: string;
  members: EventMember[];
}

export interface EventCategories {
  hidden: string[];
  by_topic: Record<string, string>;
}

async function readArchive<T>(file: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE_PATH}/event-data/${file}`, { signal, cache: "no-cache" });
  if (!response.ok) throw new Error("暂时无法读取事件档案，请刷新后再试。");
  return response.json() as Promise<T>;
}

export async function loadEventMonths(signal: AbortSignal) {
  return (await readArchive<{ months: EventMonth[] }>("index.json", signal)).months;
}

export function loadEventCategories(signal: AbortSignal) {
  return readArchive<EventCategories>("categories.json", signal);
}

export async function loadMonthEvents(month: string, signal: AbortSignal) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("无效的档案月份。");
  return (await readArchive<{ events: ArchiveEvent[] }>(`${month}.json`, signal)).events;
}

export function archiveHourLabel(hour: string, short = false) {
  return `${hour.slice(short ? 5 : 0, 10)} ${hour.slice(11, 13)}:00`;
}

export function archiveDurationHours({ first, last }: Pick<ArchiveEvent, "first" | "last">) {
  const start = Date.parse(`${first}:00:00+08:00`);
  const end = Date.parse(`${last}:00:00+08:00`);
  return (end - start) / 3_600_000;
}

export function archiveDurationLabel(hours: number) {
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  if (days === 0) return `${rest} 小时`;
  return rest === 0 ? `${days} 天` : `${days} 天 ${rest} 小时`;
}

export function originalHotlist(revision: string, hour: string) {
  const path = hour.slice(0, 10).replaceAll("-", "/");
  return `https://github.com/nateafish/weibo-hot-hub/blob/${revision}/data/hotlists/${path}/${hour.slice(11, 13)}.json`;
}

export function originalPosts(topicId: string, hour: string) {
  const params = new URLSearchParams({ id: topicId, tab: "posts", date: hour.slice(0, 10), hour: hour.slice(11) });
  return `/topic/?${params}`;
}
