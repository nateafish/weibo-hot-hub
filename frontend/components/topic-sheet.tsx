"use client";

import Link from "next/link";
import { ArrowRight, Bot, ExternalLink, FileText, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Line, LineChart } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, ErrorState, MetricCard } from "@/components/app-state";
import { loadTopicPosts, loadTopicSummary, loadTopicTrends } from "@/lib/data";
import { formatDateTime, formatMetric } from "@/lib/format";
import type { PostObject, TopicSummary, TrendRecord } from "@/lib/types";

export interface TopicSelection { topic_id?: string | null; title: string; url?: string }

const sparkConfig = { read: { label: "阅读", color: "var(--chart-read)" } } satisfies ChartConfig;

export function TopicSheet({ selected, onClose }: { selected: TopicSelection | null; onClose: () => void }) {
  const [summary, setSummary] = useState<TopicSummary | null>(null);
  const [trend, setTrend] = useState<TrendRecord | null>(null);
  const [posts, setPosts] = useState<PostObject[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setSummary(null); setTrend(null); setPosts([]); setError("");
    if (!selected?.topic_id) return;
    loadTopicSummary(selected.topic_id).then(async (value) => {
      if (!active) return;
      setSummary(value);
      if (value.trend_dates.length) {
        const records = await loadTopicTrends(selected.topic_id!, value.trend_dates.at(-1)!);
        if (active) setTrend(records.at(-1) || null);
      }
      if (value.post_dates.length) {
        const day = await loadTopicPosts(selected.topic_id!, value.post_dates.at(-1)!);
        const hour = Object.keys(day.hours).sort().at(-1);
        const mids = hour ? day.hours[hour].pages.flat() : [];
        if (active) setPosts(mids.slice(0, 3).map((mid) => day.objects[mid]).filter(Boolean));
      }
    }).catch((reason: Error) => active && setError(reason.message));
    return () => { active = false; };
  }, [selected]);

  const sparkData = useMemo(() => {
    // 1h series is no longer collected; fall back to the 24h curve.
    const series = trend?.["1h"]?.read || trend?.["24h"]?.read || [];
    return series.map((point) => ({ label: point.label, value: point.value }));
  }, [trend]);
  const snapshot = summary?.latest_snapshot;
  const all = snapshot?.overview?.all;
  const host = summary?.meta.host?.screen_name ? String(summary.meta.host.screen_name) : "未记录";

  return <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && onClose()}><SheetContent className="overflow-y-auto sm:max-w-xl">
    <SheetHeader><SheetTitle>{selected?.title || "话题预览"}</SheetTitle><SheetDescription>{summary?.meta.summary || "查看该话题已保存的热度、趋势、正文与智搜档案。"}</SheetDescription></SheetHeader>
    <div className="space-y-5 px-4 pb-6">
    {error ? <ErrorState message={error} /> : !summary ? <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-36" /></div> : <>
      <div className="flex flex-wrap gap-2"><Badge>{summary.meta.category || "未分类"}</Badge><Badge>主持人：{host}</Badge><Badge>最近采集：{formatDateTime(snapshot?.captured_at)}</Badge></div>
      <div className="grid grid-cols-2 gap-3">
        {Object.entries({ read: "阅读", mention: "讨论", interaction: "互动", original: "原创" }).map(([key, label]) => <MetricCard key={key} label={`累计${label}`} value={formatMetric(all?.[key])} />)}
      </div>
      <h3 className="section-title flex items-center gap-2"><TrendingUp size={15} />最近 1 小时阅读趋势</h3>
      <Card className="p-3 shadow-none">{sparkData.length ? <ChartContainer config={sparkConfig} className="h-32 w-full aspect-auto"><LineChart data={sparkData}><ChartTooltip content={<ChartTooltipContent hideLabel />} /><Line name="read" dataKey="value" type="monotone" stroke="var(--color-read)" strokeWidth={2} dot={false} /></LineChart></ChartContainer> : <EmptyState title="暂无趋势数据" />}</Card>
      <h3 className="section-title flex items-center gap-2"><FileText size={15} />最新正文</h3>
      {posts.length ? <div className="space-y-2">{posts.map((post) => <a className="block rounded-xl border border-border p-3 hover:bg-muted" key={post.mid} href={post.url} target="_blank" rel="noreferrer"><div className="text-xs font-semibold">{post.username || "微博用户"}</div><p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{post.body}</p></a>)}</div> : <p className="text-sm text-muted-foreground">暂无正文留档。</p>}
      <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Bot size={15} />{summary.ai_versions.length ? `已保存 ${summary.ai_versions.length} 个智搜版本` : "暂无可展示的智搜版本"}</div>
      <div className="mt-6 flex flex-wrap gap-2"><Button asChild><Link href={`/topic/?id=${encodeURIComponent(summary.topic_id)}`}>查看完整档案<ArrowRight size={15} /></Link></Button>{summary.meta.search_url && <Button asChild variant="outline"><a href={summary.meta.search_url} target="_blank" rel="noreferrer">微博搜索<ExternalLink size={14} /></a></Button>}</div>
    </>}
    </div>
  </SheetContent></Sheet>;
}
