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

async function readArchive<T>(file: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE_PATH}/event-data/${file}`, { signal, cache: "no-cache" });
  if (!response.ok) throw new Error("暂时无法读取事件档案，请刷新后再试。");
  return response.json() as Promise<T>;
}

export async function loadEventMonths(signal: AbortSignal) {
  return (await readArchive<{ months: EventMonth[] }>("index.json", signal)).months;
}

export async function loadMonthEvents(month: string, signal: AbortSignal) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("无效的档案月份。");
  return (await readArchive<{ events: ArchiveEvent[] }>(`${month}.json`, signal)).events;
}

export function archiveHourLabel(hour: string, short = false) {
  return `${hour.slice(short ? 5 : 0, 10)} ${hour.slice(11, 13)}:00`;
}

export function originalHotlist(revision: string, hour: string) {
  const path = hour.slice(0, 10).replaceAll("-", "/");
  return `https://github.com/nateafish/weibo-hot-hub/blob/${revision}/data/hotlists/${path}/${hour.slice(11, 13)}.json`;
}
