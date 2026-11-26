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

const cache = new Map<string, { value: unknown; expires: number; weight: number }>();
const pending = new Map<string, Promise<unknown>>();
const ttl = 60_000;
const maxWeight = 32_000_000;
let cacheWeight = 0;

async function getJson<T>(path: string): Promise<T> {
  const existing = cache.get(path);
  if (existing && existing.expires > Date.now()) {
    cache.delete(path); cache.set(path, existing);
    return existing.value as T;
  }
  const loading = pending.get(path);
  if (loading) return loading as Promise<T>;
  const request = (async () => {
    // Keep browser ETags available and avoid downloading the same public file on each navigation.
    const response = await fetch(siteDataUrl(path), { cache: "no-cache" });
    if (!response.ok) throw new Error(`无法读取 ${path} (${response.status})`);
    const text = await response.text();
    const value = JSON.parse(text) as T;
    const weight = text.length * 2;
    const previous = cache.get(path);
    if (previous) { cacheWeight -= previous.weight; cache.delete(path); }
    if (weight <= maxWeight) {
      while (cache.size && (cacheWeight + weight > maxWeight || cache.size >= 24)) {
        const oldest = cache.keys().next().value!;
        cacheWeight -= cache.get(oldest)!.weight; cache.delete(oldest);
      }
      cache.set(path, { value, weight, expires: Date.now() + ttl }); cacheWeight += weight;
    }
    return value;
  })().finally(() => pending.delete(path));
  pending.set(path, request);
  return request;
}

export const loadManifest = () => getJson<SiteManifest>("manifest.json");
export const loadDay = (date: string) => getJson<DayBundle>(`hotlists/${date}.json`);
export const loadTopics = () => getJson<TopicIndexItem[]>("topics/index.json");
export const loadRecentTopics = () => getJson<{ total: number; topics: TopicIndexItem[] }>("topics/recent.json");
export const loadTopicSummary = (id: string) => getJson<TopicSummary>(`topics/${encodeURIComponent(id)}/summary.json`);
export const loadTopicSnapshots = (id: string, date: string) => getJson<TopicSnapshot[]>(`topics/${encodeURIComponent(id)}/snapshots/${date}.json`);
export const loadTopicTrends = (id: string, date: string) => getJson<TrendRecord[]>(`topics/${encodeURIComponent(id)}/trends/${date}.json`);
export const loadTopicTrendHistory = (id: string) => getJson<TrendHistory>(`topics/${encodeURIComponent(id)}/trends/history.json`);
export const loadTopicPosts = (id: string, date: string) => getJson<PostDay>(`topics/${encodeURIComponent(id)}/posts/${date}.json`);
export const loadAiContent = (id: string, version: string) => getJson<AiContent>(`topics/${encodeURIComponent(id)}/ai/${encodeURIComponent(version)}.json`);
