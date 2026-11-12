"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState } from "@/components/app-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  type ArchiveEvent, type EventCategories, type EventMonth, archiveHourLabel, loadEventCategories,
  loadEventMonths, loadMonthEvents, originalHotlist, originalPosts,
} from "@/lib/event-archive";
import { formatNumber } from "@/lib/format";

const pageSize = 30;
const uncategorized = "微博未分类";

function eventHref(month: string, category: string, id?: string) {
  const params = new URLSearchParams({ month });
  if (category) params.set("category", category);
  if (id) params.set("id", id);
  return `/events/?${params}`;
}

function Timeline({ event, categories }: { event: ArchiveEvent; categories: EventCategories }) {
  const hours = [...new Set(event.members.flatMap(({ appearances }) => appearances.map(({ hour }) => hour)))].sort();
  return (
    <div className="overflow-auto rounded-md border" tabIndex={0} aria-label="事件话题上榜时间线">
      <table className="min-w-full w-max text-sm">
        <thead>
          <tr className="bg-muted/55">
            <th scope="col" className="sticky left-0 min-w-40 max-w-48 border-r bg-muted px-3 py-2 text-left">话题</th>
            {hours.map((hour) => <th scope="col" className="min-w-16 border-l px-2 py-2 text-center text-xs font-medium" key={hour}>{archiveHourLabel(hour, true)}</th>)}
          </tr>
        </thead>
        <tbody>
          {event.members.map((member, index) => {
            const appearances = new Map(member.appearances.map((row) => [row.hour, row]));
            return (
              <tr className="border-t" key={`${member.topic_id || member.title}-${index}`}>
                <th scope="row" className="sticky left-0 max-w-48 border-r bg-card px-3 py-2 text-left font-medium">
                  {member.topic_id ? <Link className="underline underline-offset-2" href={`/topic/?id=${encodeURIComponent(member.topic_id)}`}>{member.title}</Link> : member.title}
                  {member.reviewed && <Badge variant="secondary" className="ml-1.5">已确认</Badge>}
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {(member.topic_id && categories.by_topic[member.topic_id]) || uncategorized}
                  </span>
                  {member.topic_id && member.post_hour && <Link className="mt-1 block text-xs text-primary" href={originalPosts(member.topic_id, member.post_hour)}>存档正文</Link>}
                </th>
                {hours.map((hour) => {
                  const row = appearances.get(hour);
                  return (
                    <td className="border-l p-1 text-center" key={hour}>
                      {row ? (
                        <a className="block rounded bg-primary/10 px-1.5 py-1 font-semibold text-primary hover:bg-primary/20"
                          href={originalHotlist(event.revision, hour)} target="_blank" rel="noreferrer"
                          title={row.heat == null ? undefined : `热度 ${formatNumber(row.heat)}`}
                          aria-label={`${archiveHourLabel(hour)} 第 ${row.rank} 名，打开原榜`}>{row.rank}</a>
                      ) : <span className="text-muted-foreground">·</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function EventArchive() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [months, setMonths] = useState<EventMonth[]>([]);
  const [categories, setCategories] = useState<EventCategories | null>(null);
  const [loaded, setLoaded] = useState<{ month: string; events: ArchiveEvent[] } | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const requestedMonth = searchParams.get("month");
  const selectedMonth = months.find(({ month }) => month === requestedMonth) || months[0];
  const month = selectedMonth?.month;
  const options = useMemo(() => [...new Set(Object.values(categories?.by_topic || {}))]
    .sort((a, b) => a.localeCompare(b, "zh-CN")), [categories]);
  const requestedCategory = searchParams.get("category") || "";
  const category = requestedCategory === "all" || requestedCategory === uncategorized || options.includes(requestedCategory)
    ? requestedCategory : "";

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([loadEventMonths(controller.signal), loadEventCategories(controller.signal)]).then(([months, categories]) => {
      setMonths(months);
      setCategories(categories);
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!month) return;
    const controller = new AbortController();
    loadMonthEvents(month, controller.signal).then((events) => setLoaded({ month, events })).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, [month]);

  const categorized = useMemo(() => {
    if (!categories || loaded?.month !== month) return [];
    const hidden = new Set(categories.hidden);
    return (loaded?.events || []).map((event) => {
      const labels = [...new Set(event.members.map(({ topic_id }) => (topic_id && categories.by_topic[topic_id]) || uncategorized))];
      return { ...event, labels, hasEntertainment: labels.some((label) => hidden.has(label)) };
    });
  }, [categories, loaded, month]);

  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return categorized.filter((event) => {
      const matchesCategory = category === "all" || (category ? event.labels.includes(category) : !event.hasEntertainment);
      return matchesCategory && (!needle || [event.title, ...event.members.map(({ title }) => title)]
        .some((title) => title.toLocaleLowerCase().includes(needle)));
    });
  }, [categorized, category, query]);

  const requestedId = searchParams.get("id");
  const selected = results.find(({ id }) => id === requestedId)
    || (!query.trim() && categorized.find(({ id }) => id === requestedId))
    || results[0];
  const hiddenCount = categorized.filter(({ hasEntertainment }) => hasEntertainment).length;
  const pages = Math.max(1, Math.ceil(results.length / pageSize));
  const activePage = Math.min(page, pages);

  function changeMonth(value: string) {
    setPage(1);
    setError("");
    router.replace(eventHref(value, category), { scroll: false });
  }

  return (
    <div className="page">
      <PageHeader title="事件档案" subtitle="查找同一事件的多个热搜话题，点榜位查看当时的原始榜单。" />
      {error && <ErrorState message={error} />}
      {!error && !selectedMonth && <div className="loading-block h-48" />}
      {selectedMonth && categories && (
        <>
          <div className="toolbar">
            <label className="grid gap-1 text-sm">
              归档月份
              <select className="h-9 rounded-md border bg-background px-2" value={month} onChange={(event) => changeMonth(event.target.value)}>
                {months.map(({ month: option, scope }) => <option key={option} value={option}>{option}{scope === "pilot" ? " · 试点" : ""}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              微博分类
              <select className="h-9 rounded-md border bg-background px-2" value={category}
                onChange={(event) => { setPage(1); router.replace(eventHref(selectedMonth.month, event.target.value), { scroll: false }); }}>
                <option value="">默认 · 隐藏娱乐明星</option>
                <option value="all">全部分类</option>
                {options.map((label) => <option key={label}>{label}</option>)}
                <option>{uncategorized}</option>
              </select>
            </label>
            <label className="min-w-56 flex-1 grid gap-1 text-sm">
              搜索事件
              <Input placeholder="输入事件名或热搜词" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
            </label>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            {archiveHourLabel(selectedMonth.first)} 至 {archiveHourLabel(selectedMonth.last)}（北京时间）
            · {formatNumber(selectedMonth.hours)} 份小时榜
            · {formatNumber(selectedMonth.topics)} 个话题时段
            · {formatNumber(selectedMonth.event_count)} 个事件
            · {formatNumber(selectedMonth.grouped)} 条话题时段已归组
          </p>
          {loaded?.month !== month && !error ? <div className="loading-block h-80" /> : !selected ? (
            <EmptyState title="没有符合条件的事件" description="可以切换微博分类、月份或搜索词。" />
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
              <Card className="min-w-0 gap-0 py-0">
                <div className="border-b px-4 py-3 text-sm text-muted-foreground">
                  {formatNumber(results.length)} 个匹配事件
                  {!category && hiddenCount > 0 && <span> · 已隐藏 {formatNumber(hiddenCount)} 个娱乐明星相关事件</span>}
                </div>
                <div className="max-h-[65vh] divide-y overflow-auto">
                  {results.slice((activePage - 1) * pageSize, activePage * pageSize).map((event) => (
                    <Link className={`block px-4 py-3 text-sm hover:bg-muted ${selected.id === event.id ? "bg-muted font-medium" : ""}`}
                      key={event.id} href={eventHref(selectedMonth.month, category, event.id)} scroll={false}
                      aria-current={selected.id === event.id ? "true" : undefined}>
                      <span className="block">{event.title}</span>
                      <span className="text-xs text-muted-foreground">{event.labels.join("、")} · {event.members.length} 个话题 · {archiveHourLabel(event.first, true)}</span>
                    </Link>
                  ))}
                </div>
                {pages > 1 && <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs">
                  <Button type="button" variant="outline" size="sm" disabled={activePage === 1} onClick={() => setPage(activePage - 1)}>上一页</Button>
                  <span>{activePage} / {pages}</span>
                  <Button type="button" variant="outline" size="sm" disabled={activePage === pages} onClick={() => setPage(activePage + 1)}>下一页</Button>
                </div>}
              </Card>
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle className="leading-normal">{selected.title}</CardTitle>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{selected.members.every(({ reviewed }) => reviewed) ? "已人工确认" : "自动归档"}</Badge>
                    {selected.labels.map((label) => <Badge key={label} variant="secondary">{label}</Badge>)}
                    <span>{archiveHourLabel(selected.first)} 至 {archiveHourLabel(selected.last)}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <h2 className="mb-2 text-sm font-semibold">上榜时间线</h2>
                  <Timeline event={selected} categories={categories} />
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
