"use client";

import { Clock3, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { HotlistTable } from "@/components/hotlist-table";
import { PageHeader } from "@/components/page-header";
import { TopicSheet, type TopicSelection } from "@/components/topic-sheet";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadDay, loadManifest } from "@/lib/data";
import { filterHotlist, formatDateTime, sortByHeat } from "@/lib/format";
import type { DailyEntry, DayBundle, HotlistEntry, SiteManifest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/app-state";

export function HomeDashboard() {
  const [manifest, setManifest] = useState<SiteManifest | null>(null);
  const [day, setDay] = useState<DayBundle | null>(null);
  const [hour, setHour] = useState("");
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("");
  const [minimumHeat, setMinimumHeat] = useState(0);
  const [selected, setSelected] = useState<TopicSelection | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { loadManifest().then((value) => { setManifest(value); setHour(value.latest_hour); return loadDay(value.latest_date); }).then(setDay).catch((reason: Error) => setError(reason.message)); }, []);
  const current = day?.hours.find((item) => item.hour === hour) || day?.hours.at(-1);
  const latestEntries = useMemo(() => filterHotlist(sortByHeat(current?.topics || []), query, label, minimumHeat), [current, query, label, minimumHeat]);
  const dailyEntries = useMemo(() => filterHotlist(day?.daily || [], query, label, minimumHeat), [day, query, label, minimumHeat]);
  const cookieValid = manifest?.cookie.status === "valid";
  const status = manifest ? <div className="status-pill"><span className={`status-dot ${cookieValid ? "valid" : ""}`} />Cookie {cookieValid ? "有效" : "已失效"} · {formatDateTime(manifest.cookie.checked_at)}</div> : undefined;

  return <div className="page"><PageHeader title="今日微博热搜" subtitle="按小时保存榜单，并将热度趋势、正文与智搜版本关联到可检索的话题档案。" aside={status} />
    {error ? <ErrorState message={error} /> : !day ? <div className="loading-block h-96" /> : <>
      <Tabs defaultValue="latest">
        <div className="flex flex-wrap items-center justify-between gap-3"><TabsList><TabsTrigger value="latest">最新一小时</TabsTrigger><TabsTrigger value="daily">当天综合</TabsTrigger></TabsList><div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 size={14} />{formatDateTime(current?.captured_at)}</div></div>
        <div className="toolbar mt-4"><div className="relative min-w-56 flex-1"><Search className="absolute left-3 top-2.5 text-muted-foreground" size={15} /><Input className="pl-9" placeholder="搜索热搜话题" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Select value={label || "all"} onValueChange={(value) => setLabel(value === "all" ? "" : value)}><SelectTrigger className="w-[130px]" aria-label="标记筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部标记</SelectItem><SelectItem value="热">热</SelectItem><SelectItem value="新">新</SelectItem></SelectContent></Select><Select value={String(minimumHeat)} onValueChange={(value) => setMinimumHeat(Number(value))}><SelectTrigger className="w-[140px]" aria-label="最低热度"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">全部热度</SelectItem><SelectItem value="100000">10 万以上</SelectItem><SelectItem value="500000">50 万以上</SelectItem><SelectItem value="1000000">100 万以上</SelectItem></SelectContent></Select></div>
        <TabsContent value="latest"><div className="mb-4 flex flex-wrap gap-2">{day.hours.map((item) => <Button size="sm" variant={item.hour === current?.hour ? "default" : "outline"} onClick={() => setHour(item.hour)} key={item.hour}>{item.hour}:00</Button>)}</div><HotlistTable entries={latestEntries} onSelect={setSelected} /></TabsContent>
        <TabsContent value="daily"><p className="mb-3 text-xs text-muted-foreground">按当天出现过的最高热度排序；同时保留最佳名次和出现小时数。</p><HotlistTable entries={dailyEntries as DailyEntry[]} daily onSelect={setSelected} /></TabsContent>
      </Tabs>
    </>}
    <TopicSheet selected={selected} onClose={() => setSelected(null)} />
  </div>;
}
