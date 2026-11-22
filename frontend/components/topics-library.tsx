"use client";

import { Bot, FileText, ListFilter, Search } from "lucide-react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Popover } from "radix-ui";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorState } from "@/components/app-state";
import { PageHeader } from "@/components/page-header";
import { TopicSheet, type TopicSelection } from "@/components/topic-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadTopics } from "@/lib/data";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { TopicIndexItem } from "@/lib/types";

const unclassified = "未分类";
const emptyFilters = { startDate: "", endDate: "", minHours: "", maxHours: "", category: "" };
type TopicFilters = typeof emptyFilters;

function TopicFilterPopover({ filters, categories, activeCount, onApply }: {
  filters: TopicFilters;
  categories: string[];
  activeCount: number;
  onApply: (filters: TopicFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const categoryLabel = useId();
  const invalidDates = Boolean(draft.startDate && draft.endDate && draft.startDate > draft.endDate);
  const invalidHours = draft.minHours !== "" && draft.maxHours !== "" && Number(draft.minHours) > Number(draft.maxHours);

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) setDraft(filters);
    setOpen(nextOpen);
  }

  function apply(nextFilters: TopicFilters) {
    onApply(nextFilters);
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild>
        <Button type="button" variant={activeCount ? "secondary" : "outline"} className="shrink-0"
          aria-label={activeCount ? `筛选，已应用 ${activeCount} 项条件` : "筛选"}>
          <ListFilter />筛选
          {activeCount > 0 && <Badge variant="outline" aria-hidden="true" className="h-5 min-w-5 px-1 tabular-nums">{activeCount}</Badge>}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content aria-label="筛选话题" align="end" sideOffset={8} collisionPadding={12}
          className="z-50 max-h-[var(--radix-popover-content-available-height)] w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg">
          <form className="space-y-4" onSubmit={(event) => {
            event.preventDefault();
            if (!invalidDates && !invalidHours) apply(draft);
          }}>
            <fieldset className="min-w-0">
              <legend className="text-sm font-medium">最近上榜日期</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
                  开始日期
                  <Input type="date" value={draft.startDate} aria-invalid={invalidDates || undefined}
                    onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} />
                </label>
                <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
                  结束日期
                  <Input type="date" value={draft.endDate} aria-invalid={invalidDates || undefined}
                    onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} />
                </label>
              </div>
              {invalidDates && <p role="alert" className="mt-2 text-xs text-destructive">开始日期不能晚于结束日期。</p>}
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="text-sm font-medium">累计上榜小时数</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
                  最少小时数
                  <Input type="number" min={0} step={1} inputMode="numeric" placeholder="不限" value={draft.minHours}
                    aria-invalid={invalidHours || undefined} onChange={(event) => setDraft({ ...draft, minHours: event.target.value })} />
                </label>
                <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
                  最多小时数
                  <Input type="number" min={0} step={1} inputMode="numeric" placeholder="不限" value={draft.maxHours}
                    aria-invalid={invalidHours || undefined} onChange={(event) => setDraft({ ...draft, maxHours: event.target.value })} />
                </label>
              </div>
              {invalidHours && <p role="alert" className="mt-2 text-xs text-destructive">最少小时数不能大于最多小时数。</p>}
            </fieldset>
            <div className="space-y-2">
              <p id={categoryLabel} className="text-sm font-medium">话题分类</p>
              <Select value={draft.category || "all"} onValueChange={(value) => setDraft({ ...draft, category: value === "all" ? "" : value })}>
                <SelectTrigger className="w-full" aria-labelledby={categoryLabel}><SelectValue /></SelectTrigger>
                <SelectContent position="popper" align="start" className="w-[var(--radix-select-trigger-width)]">
                  <SelectItem value="all">全部分类</SelectItem>
                  {categories.map((category) => <SelectItem value={category} key={category}>{category}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <Button type="button" variant="ghost" onClick={() => apply(emptyFilters)}>清除筛选</Button>
              <Button type="submit" disabled={invalidDates || invalidHours}>应用筛选</Button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

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
                    <Badge variant="secondary">{item.category || unclassified}</Badge>
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
  const [filters, setFilters] = useState<TopicFilters>(emptyFilters);
  const [sort, setSort] = useState<"time" | "heat-desc" | "heat-asc">("time");
  const [selected, setSelected] = useState<TopicSelection | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { loadTopics().then(setTopics).catch((reason: Error) => setError(reason.message)); }, []);
  const indexed = useMemo(() => topics.map((topic) => {
    const category = topic.category || unclassified;
    return {
      topic,
      category,
      searchFields: [topic.title, topic.host, category].map((field) => field?.toLowerCase()),
      lastSeen: Date.parse(topic.last_seen_at || ""),
    };
  }), [topics]);
  const categories = useMemo(() => [...new Set(indexed.map(({ category }) => category))].sort(), [indexed]);
  const sorted = useMemo(() => [...indexed].sort((a, b) => {
    if (sort === "time") return (b.lastSeen || 0) - (a.lastSeen || 0);
    const aHeat = typeof a.topic.peak_heat === "number" ? a.topic.peak_heat : null;
    const bHeat = typeof b.topic.peak_heat === "number" ? b.topic.peak_heat : null;
    if (aHeat === null) return bHeat === null ? 0 : 1;
    if (bHeat === null) return -1;
    return sort === "heat-desc" ? bHeat - aHeat : aHeat - bHeat;
  }), [indexed, sort]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // The archive displays dates in Beijing time.
    const startAt = filters.startDate ? Date.parse(`${filters.startDate}T00:00:00+08:00`) : null;
    const endAt = filters.endDate ? Date.parse(`${filters.endDate}T23:59:59.999+08:00`) : null;
    const minHours = filters.minHours === "" ? null : Number(filters.minHours);
    const maxHours = filters.maxHours === "" ? null : Number(filters.maxHours);
    return sorted
      .filter(({ topic, category, lastSeen, searchFields }) => (!filters.category || category === filters.category)
        && (startAt === null || lastSeen >= startAt)
        && (endAt === null || lastSeen <= endAt)
        && (minHours === null || topic.hours_seen >= minHours)
        && (maxHours === null || topic.hours_seen <= maxHours)
        && (!needle || searchFields.some((field) => field?.includes(needle))))
      .map(({ topic }) => topic);
  }, [sorted, query, filters]);
  const activeCount = Number(Boolean(filters.startDate || filters.endDate))
    + Number(Boolean(filters.minHours || filters.maxHours)) + Number(Boolean(filters.category));
  const topicCount = activeCount || query.trim()
    ? `${formatNumber(filtered.length)} / ${formatNumber(topics.length)} 个话题`
    : `${formatNumber(topics.length)} 个话题`;
  return <div className="page">
    <PageHeader title="话题档案" subtitle="跨越不同小时检索已建立的热搜话题档案，查看峰值、主持人和留档完整度。"
      aside={<div role="status" className="status-pill">{topicCount}</div>} />
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:items-center">
      <div className="relative col-span-2 min-w-0 sm:flex-1">
        <Search className="absolute left-3 top-2.5 text-muted-foreground" size={15} />
        <Input className="pl-9" placeholder="搜索标题、主持人或分类" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <Select value={sort} onValueChange={(value) => setSort(value as typeof sort)}>
        <SelectTrigger className="w-full sm:w-40" aria-label="话题排序"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="time">时间顺序</SelectItem>
          <SelectItem value="heat-desc">热度从高到低</SelectItem>
          <SelectItem value="heat-asc">热度从低到高</SelectItem>
        </SelectContent>
      </Select>
      <TopicFilterPopover filters={filters} categories={categories} activeCount={activeCount} onApply={setFilters} />
    </div>
    {error ? <ErrorState message={error} /> : !topics.length ? <div className="loading-block h-80" /> :
      !filtered.length ? <EmptyState title="没有符合条件的话题档案" description="试试调整筛选条件或搜索词。" /> :
        <TopicGrid topics={filtered} onSelect={setSelected} />}
    <TopicSheet selected={selected} onClose={() => setSelected(null)} />
  </div>;
}
