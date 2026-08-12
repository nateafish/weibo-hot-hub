"use client";

import Link from "next/link";
import { ArrowLeft, Bot, ChartNoAxesCombined, ExternalLink, FileText, LayoutDashboard } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AiPanel } from "@/components/ai-panel";
import { OverviewPanel } from "@/components/overview-panel";
import { PostsPanel } from "@/components/posts-panel";
import { TrendPanel } from "@/components/trend-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadTopicSummary } from "@/lib/data";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { TopicSummary } from "@/lib/types";
import { ErrorState } from "@/components/app-state";

export function TopicDetailView() {
  const search = useSearchParams();
  const id = search.get("id") || "";
  const [summary, setSummary] = useState<TopicSummary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!id) { setError("链接中缺少话题 ID。"); return; }
    setError(""); loadTopicSummary(id).then(setSummary).catch((reason: Error) => setError(reason.message));
  }, [id]);
  if (error) return <div className="page"><Button asChild variant="ghost"><Link href="/topics/"><ArrowLeft size={15} />返回话题档案</Link></Button><ErrorState message={error} /></div>;
  if (!summary) return <div className="page"><div className="loading-block h-44" /><div className="loading-block mt-4 h-96" /></div>;
  const snapshot = summary.latest_snapshot;
  return <div className="page"><Button asChild variant="ghost" className="mb-3 -ml-3"><Link href="/topics/"><ArrowLeft size={15} />返回话题档案</Link></Button>
    <Card className="detail-hero shadow-sm"><div className="detail-hero-top"><div><h1>{summary.meta.title}</h1><p className="page-subtitle">{summary.meta.summary || "该话题暂无导语，以下内容来自已保存的公开数据。"}</p><div className="detail-meta"><Badge variant="secondary">{summary.meta.category || "未分类"}</Badge><Badge variant="outline">最高热度 {formatNumber(summary.stats.peak_heat as number | null)}</Badge><Badge variant="outline">最佳名次 #{summary.stats.best_rank || "—"}</Badge><Badge variant="outline">出现 {summary.stats.hours_seen || 0} 小时</Badge></div></div>{summary.meta.search_url && <Button asChild variant="outline"><a href={summary.meta.search_url} target="_blank" rel="noreferrer">微博原页<ExternalLink size={14} /></a></Button>}</div><div className="mt-5 text-xs text-muted-foreground">首次收录：{formatDateTime(summary.meta.first_seen_at)} · 最近采集：{formatDateTime(snapshot?.captured_at || summary.meta.last_seen_at)}</div></Card>
    <Tabs defaultValue="overview"><TabsList className="flex h-auto w-full max-w-2xl flex-wrap justify-start"><TabsTrigger value="overview"><LayoutDashboard size={14} className="mr-1.5" />概览</TabsTrigger><TabsTrigger value="trends"><ChartNoAxesCombined size={14} className="mr-1.5" />趋势</TabsTrigger><TabsTrigger value="posts"><FileText size={14} className="mr-1.5" />正文</TabsTrigger><TabsTrigger value="ai"><Bot size={14} className="mr-1.5" />智搜</TabsTrigger></TabsList><TabsContent value="overview"><OverviewPanel summary={summary} /></TabsContent><TabsContent value="trends"><TrendPanel summary={summary} /></TabsContent><TabsContent value="posts"><PostsPanel summary={summary} /></TabsContent><TabsContent value="ai"><AiPanel summary={summary} /></TabsContent></Tabs>
  </div>;
}
