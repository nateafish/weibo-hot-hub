"use client";

import { Bot, FileText, Search } from "lucide-react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

function TopicGrid({ topics, onSelect }: { topics: TopicIndexItem[]; onSelect: (topic: TopicIndexItem) => void }) {
  const grid = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ columns: 1, width: 0, top: 0 });

  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    function readLayout() {
      const frame = grid.current;
      if (!frame) return;
      const bounds = frame.getBoundingClientRect();
      const columns = Number(getComputedStyle(frame).getPropertyValue("--topic-columns")) || 1;
      const width = Math.round(bounds.width);
      const top = Math.round(bounds.top + window.scrollY);
      setLayout((previous) => previous.columns === columns && previous.width === width && previous.top === top
        ? previous : { columns, width, top });
    }
    readLayout();
    const observer = new ResizeObserver(readLayout);
    observer.observe(element.parentElement ?? element);
    window.addEventListener("resize", readLayout);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", readLayout);
    };
  }, []);

  const getRowKey = useCallback((index: number) => topics[index * layout.columns].topic_id, [topics, layout.columns]);
  const rows = useWindowVirtualizer<HTMLDivElement>({
    count: Math.ceil(topics.length / layout.columns),
    getItemKey: getRowKey,
    estimateSize: () => 150,
    gap: 16,
    overscan: 4,
    scrollMargin: layout.top,
  });

  useLayoutEffect(() => rows.measure(), [rows, layout.width, layout.columns]);

  return (
    <div ref={grid} className="relative [--topic-columns:1] md:[--topic-columns:2] xl:[--topic-columns:3]"
      style={{ height: rows.getTotalSize() }}>
      {rows.getVirtualItems().map((row) => {
        const start = row.index * layout.columns;
        return (
          <div className="topic-grid absolute inset-x-0 top-0" key={row.key} data-index={row.index}
            ref={rows.measureElement} style={{ transform: `translateY(${row.start - layout.top}px)` }}>
            {topics.slice(start, start + layout.columns).map((item) => (
              <Card className="cursor-pointer gap-4 py-5 shadow-sm transition-colors hover:bg-muted/50"
                key={item.topic_id} onClick={() => onSelect(item)}>
                <CardHeader className="px-5 py-0">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base leading-6">{item.title}</CardTitle>
                    <span className="heat-number text-sm">{formatNumber(item.peak_heat)}</span>
                  </div>
                </CardHeader>
                <CardContent className="px-5 py-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{item.category || "未分类"}</Badge>
                    {item.host && <Badge variant="outline">{item.host}</Badge>}
                    {item.has_posts && <span title="有正文"><FileText size={13} /></span>}
                    {item.has_ai && <span title="有智搜"><Bot size={13} /></span>}
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <span>最佳 #{item.best_rank || "—"}</span>
                    <span>{item.hours_seen} 小时</span>
                    <span className="truncate">{formatDateTime(item.last_seen_at)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function TopicsLibrary() {
  const [topics, setTopics] = useState<TopicIndexItem[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<"time" | "heat-desc" | "heat-asc">("time");
  const [selected, setSelected] = useState<TopicSelection | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { loadTopics().then(setTopics).catch((reason: Error) => setError(reason.message)); }, []);
  const categories = useMemo(() => Array.from(new Set(topics.map((item) => item.category).filter(Boolean) as string[])).sort(), [topics]);
  const indexed = useMemo(() => topics.map((topic) => ({
    topic,
    searchFields: [topic.title, topic.host, topic.category].map((field) => field?.toLowerCase()),
    lastSeen: Date.parse(topic.last_seen_at || "") || 0,
  })), [topics]);
  const sorted = useMemo(() => [...indexed].sort((a, b) => {
    if (sort === "time") return b.lastSeen - a.lastSeen;
    const aHeat = typeof a.topic.peak_heat === "number" ? a.topic.peak_heat : null;
    const bHeat = typeof b.topic.peak_heat === "number" ? b.topic.peak_heat : null;
    if (aHeat === null) return bHeat === null ? 0 : 1;
    if (bHeat === null) return -1;
    return sort === "heat-desc" ? bHeat - aHeat : aHeat - bHeat;
  }), [indexed, sort]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sorted
      .filter(({ topic, searchFields }) => (!category || topic.category === category)
        && (!needle || searchFields.some((field) => field?.includes(needle))))
      .map(({ topic }) => topic);
  }, [sorted, query, category]);
  return <div className="page"><PageHeader title="话题档案" subtitle="跨越不同小时检索已建立的热搜话题档案，查看峰值、主持人和留档完整度。" aside={<div className="status-pill">{topics.length} 个话题</div>} />
    <div className="toolbar"><div className="relative min-w-56 flex-1"><Search className="absolute left-3 top-2.5 text-muted-foreground" size={15} /><Input className="pl-9" placeholder="搜索标题、主持人或分类" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Select value={category || "all"} onValueChange={(value) => setCategory(value === "all" ? "" : value)}><SelectTrigger className="w-[150px]" aria-label="话题分类"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部分类</SelectItem>{categories.map((item) => <SelectItem value={item} key={item}>{item}</SelectItem>)}</SelectContent></Select><Select value={sort} onValueChange={(value) => setSort(value as typeof sort)}><SelectTrigger className="w-[160px]" aria-label="话题排序"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="time">时间顺序</SelectItem><SelectItem value="heat-desc">热度从高到低</SelectItem><SelectItem value="heat-asc">热度从低到高</SelectItem></SelectContent></Select></div>
    {error ? <ErrorState message={error} /> : !topics.length ? <div className="loading-block h-80" /> :
      !filtered.length ? <EmptyState title="没有符合条件的话题档案" description="试试更换搜索词或分类。" /> :
        <TopicGrid topics={filtered} onSelect={setSelected} />}
    <TopicSheet selected={selected} onClose={() => setSelected(null)} />
  </div>;
}
