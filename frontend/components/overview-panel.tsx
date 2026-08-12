import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MetricCard } from "@/components/app-state";
import { formatMetric } from "@/lib/format";
import type { TopicSummary } from "@/lib/types";

const metricNames: Record<string, string> = { read: "阅读", mention: "讨论", interaction: "互动", original: "原创" };

function asString(value: unknown): string { return value === null || value === undefined ? "—" : String(value); }

export function OverviewPanel({ summary }: { summary: TopicSummary }) {
  const snapshot = summary.latest_snapshot;
  const host = summary.meta.host || {};
  const contributors = snapshot?.contributors || [];
  const rankHistory = snapshot?.rank_history || [];
  return <div className="grid gap-4"><Card className="panel shadow-sm"><div className="flex flex-wrap gap-2"><Badge variant="secondary">{summary.meta.category || "未分类"}</Badge>{Boolean(host.screen_name) && <Badge variant="outline">主持人：{asString(host.screen_name)}</Badge>}{summary.meta.sub_category && <Badge variant="outline">{summary.meta.sub_category}</Badge>}</div>{summary.meta.summary ? <p className="topic-summary mt-4">{summary.meta.summary}</p> : <p className="topic-summary mt-4">该话题暂无导语。</p>}{summary.meta.search_url && <a className="mt-3 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4" href={summary.meta.search_url} target="_blank" rel="noreferrer">微博搜索页<ExternalLink size={12} /></a>}</Card>
    <Card className="panel shadow-sm"><h2 className="font-semibold">数据总览</h2>{["all", "24h", "30d"].map((window) => <div className="overview-window" key={window}><h3>{window === "all" ? "全部" : window === "24h" ? "近 24 小时" : "近 30 天"}</h3><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Object.entries(metricNames).map(([key, label]) => <MetricCard key={key} label={label} value={formatMetric(snapshot?.overview?.[window]?.[key])} />)}</div></div>)}</Card>
    <div className="grid gap-4 lg:grid-cols-2"><Card className="panel shadow-sm"><h2 className="font-semibold">热搜记录</h2>{rankHistory.length ? <div className="mt-3 space-y-2">{rankHistory.map((item, index) => <div className="rounded-md border p-3 text-sm" key={index}><div className="font-medium">最高第 {asString(item.top_pos ?? item.rank ?? "—")} 位</div><div className="mt-1 text-xs text-muted-foreground">在榜 {asString(item.duration ?? item.duration_minute ?? "—")} 分钟</div></div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">暂无热搜排名记录。</p>}</Card>
      <Card className="panel shadow-sm"><h2 className="font-semibold">话题贡献者</h2>{contributors.length ? <ol className="mt-3 divide-y rounded-md border">{contributors.map((item, index) => <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm" key={asString(item.uid || index)}><span><b className="mr-2 tabular-nums text-muted-foreground">{asString(item.rank || index + 1)}</b>{item.profile_url ? <a className="font-medium hover:underline" href={asString(item.profile_url)} target="_blank" rel="noreferrer">{asString(item.username || item.uid)}</a> : asString(item.username || item.uid)}</span><span className="text-xs text-muted-foreground">贡献度 {asString(item.contribution)}</span></li>)}</ol> : <p className="mt-3 text-sm text-muted-foreground">暂无贡献者排行。</p>}</Card></div>
  </div>;
}
