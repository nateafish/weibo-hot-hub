export interface CookiePart { status?: string; reason?: string }
export interface CookieState {
  status?: string;
  checked_at?: string;
  pc?: CookiePart;
  mobile?: CookiePart;
}

export interface SiteManifest {
  generated_at: string;
  latest_date: string;
  latest_hour: string;
  available_dates: string[];
  topic_count: number;
  cookie: CookieState;
}

export interface HotlistEntry {
  topic_id?: string | null;
  title: string;
  query: string;
  url: string;
  heat: number | null;
  label?: string | null;
  original_rank: number;
}

export interface DailyEntry extends HotlistEntry {
  peak_heat: number | null;
  latest_heat: number | null;
  best_rank: number;
  hours_seen: number;
}

export interface HourSnapshot {
  hour: string;
  captured_at: string;
  source_url?: string;
  topics: HotlistEntry[];
}

export interface DayBundle {
  date: string;
  hours: HourSnapshot[];
  daily: DailyEntry[];
}

export interface TopicIndexItem {
  topic_id: string;
  title: string;
  category?: string | null;
  host?: string | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  peak_heat?: number | null;
  best_rank?: number | null;
  hours_seen: number;
  has_posts: boolean;
  has_ai: boolean;
}

export interface MetricValue { val?: number | string; unit?: string }
export interface TopicSnapshot {
  captured_at?: string;
  hour?: string;
  heat?: number;
  title?: string;
  overview?: Record<string, Record<string, MetricValue>>;
  rank_history?: Array<Record<string, unknown>>;
  contributors?: Array<Record<string, unknown>>;
  current_boards?: Record<string, unknown>;
  exact_counts?: Record<string, number>;
  window_counts?: Record<string, number>;
}

export interface TopicMeta {
  topic_id: string;
  title: string;
  summary?: string;
  category?: string;
  sub_category?: string;
  host?: Record<string, unknown>;
  search_url?: string;
  first_seen_at?: string;
  last_seen_at?: string;
}

export interface AiVersion {
  id: string;
  captured_at: string;
  query?: string;
  source_url?: string;
  content_sha256?: string;
}

export interface TopicSummary {
  topic_id: string;
  meta: TopicMeta;
  latest_snapshot?: TopicSnapshot | null;
  snapshot_dates: string[];
  trend_dates: string[];
  post_dates: string[];
  ai_versions: AiVersion[];
  stats: Record<string, number | string | null>;
}

export interface TrendPoint { at: string; label: string; value: number }
export interface TrendRecord {
  captured_at?: string;
  capture_hour?: string;
  "1h"?: Record<string, TrendPoint[]>;
  "24h"?: Record<string, TrendPoint[]>;
}

export interface TrendHistory {
  snapshot_count: number;
  first_at?: string | null;
  last_at?: string | null;
  metrics: Record<string, TrendPoint[]>;
}

export interface PostObject {
  mid: string;
  uid?: string;
  username?: string;
  created_at_text?: string;
  body: string;
  url?: string;
}

export interface PostDay {
  hours: Record<string, { captured_at?: string; pages: string[][]; unique_posts: number }>;
  objects: Record<string, PostObject>;
}

export interface AiContent {
  metadata: Record<string, string>;
  markdown: string;
}
