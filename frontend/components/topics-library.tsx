"use client";

import { Bot, FileText, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { TopicSheet, type TopicSelection } from "@/components/topic-sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadTopics } from "@/lib/data";
import { EmptyState, ErrorState } from "@/components/app-state";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { TopicIndexItem } from "@/lib/types";

export function TopicsLibrary() {
  const [topics, setTopics] = useState<TopicIndexItem[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<TopicSelection | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { loadTopics().then(setTopics).catch((reason: Error) => setError(reason.message)); }, []);
  const categories = useMemo(() => Array.from(new Set(topics.map((item) => item.category).filter(Boolean) as string[])).sort(), [topics]);
  const filtered = useMemo(() => { const needle = query.trim().toLowerCase(); return topics.filter((item) => (!needle || [item.title, item.host, item.category].some((value) => value?.toLowerCase().includes(needle))) && (!category || item.category === category)).sort((a, b) => (b.peak_heat || 0) - (a.peak_heat || 0)); }, [topics, query, category]);
  return <div className="page"><PageHeader title="话题档案" subtitle="跨越不同小时检索已建立的热搜话题档案，查看峰值、主持人和留档完整度。" aside={<div className="status-pill">{topics.length} 个话题</div>} />
    <div className="toolbar"><div className="relative min-w-56 flex-1"><Search className="absolute left-3 top-2.5 text-muted-foreground" size={15} /><Input className="pl-9" placeholder="搜索标题、主持人或分类" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Select value={category || "all"} onValueChange={(value) => setCategory(value === "all" ? "" : value)}><SelectTrigger className="w-[150px]" aria-label="话题分类"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部分类</SelectItem>{categories.map((item) => <SelectItem value={item} key={item}>{item}</SelectItem>)}</SelectContent></Select></div>
    {error ? <ErrorState message={error} /> : !topics.length ? <div className="loading-block h-80" /> : !filtered.length ? <EmptyState title="没有符合条件的话题档案" description="试试更换搜索词或分类。" /> : <div className="topic-grid">{filtered.map((item) => <Card className="cursor-pointer gap-4 py-5 shadow-sm transition-colors hover:bg-muted/50" key={item.topic_id} onClick={() => setSelected(item)}><CardHeader className="px-5 py-0"><div className="flex items-start justify-between gap-3"><CardTitle className="text-base leading-6">{item.title}</CardTitle><span className="heat-number text-sm">{formatNumber(item.peak_heat)}</span></div></CardHeader><CardContent className="px-5 py-0"><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant="secondary">{item.category || "未分类"}</Badge>{item.host && <Badge variant="outline">{item.host}</Badge>}{item.has_posts && <span title="有正文"><FileText size={13} /></span>}{item.has_ai && <span title="有智搜"><Bot size={13} /></span>}</div><div className="mt-4 grid grid-cols-3 gap-2 text-xs text-muted-foreground"><span>最佳 #{item.best_rank || "—"}</span><span>{item.hours_seen} 小时</span><span className="truncate">{formatDateTime(item.last_seen_at)}</span></div></CardContent></Card>)}</div>}
    <TopicSheet selected={selected} onClose={() => setSelected(null)} />
  </div>;
}
