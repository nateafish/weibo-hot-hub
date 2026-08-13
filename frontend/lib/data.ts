import type {
  AiContent,
  DayBundle,
  PostDay,
  SiteManifest,
  TopicIndexItem,
  TopicSummary,
  TopicSnapshot,
  TrendRecord,
  TrendHistory,
} from "./types";

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function siteDataUrl(path: string): string {
  return `${BASE_PATH}/site-data/${path.replace(/^\//, "")}`;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(siteDataUrl(path), { cache: "no-store" });
  if (!response.ok) throw new Error(`无法读取 ${path} (${response.status})`);
  return (await response.json()) as T;
}

export const loadManifest = () => getJson<SiteManifest>("manifest.json");
export const loadDay = (date: string) => getJson<DayBundle>(`hotlists/${date}.json`);
export const loadTopics = () => getJson<TopicIndexItem[]>("topics/index.json");
export const loadTopicSummary = (id: string) => getJson<TopicSummary>(`topics/${encodeURIComponent(id)}/summary.json`);
export const loadTopicSnapshots = (id: string, date: string) => getJson<TopicSnapshot[]>(`topics/${encodeURIComponent(id)}/snapshots/${date}.json`);
export const loadTopicTrends = (id: string, date: string) => getJson<TrendRecord[]>(`topics/${encodeURIComponent(id)}/trends/${date}.json`);
export const loadTopicTrendHistory = (id: string) => getJson<TrendHistory>(`topics/${encodeURIComponent(id)}/trends/history.json`);
export const loadTopicPosts = (id: string, date: string) => getJson<PostDay>(`topics/${encodeURIComponent(id)}/posts/${date}.json`);
export const loadAiContent = (id: string, version: string) => getJson<AiContent>(`topics/${encodeURIComponent(id)}/ai/${encodeURIComponent(version)}.json`);
