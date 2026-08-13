"use client";

import { CalendarDays } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { HotlistTable } from "@/components/hotlist-table";
import { PageHeader } from "@/components/page-header";
import { TopicSheet, type TopicSelection } from "@/components/topic-sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadDay, loadManifest } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import type { DayBundle, SiteManifest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/app-state";

export function ArchiveBrowser() {
  const [manifest, setManifest] = useState<SiteManifest | null>(null);
  const [day, setDay] = useState<DayBundle | null>(null);
  const [date, setDate] = useState("");
  const [hour, setHour] = useState("");
  const [selected, setSelected] = useState<TopicSelection | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { loadManifest().then((value) => { setManifest(value); setDate(value.latest_date); setHour(value.latest_hour); return loadDay(value.latest_date); }).then(setDay).catch((reason: Error) => setError(reason.message)); }, []);
  const changeDate = (next: string) => { setDate(next); setError(""); loadDay(next).then((value) => { setDay(value); setHour(value.hours.at(-1)?.hour || ""); }).catch((reason: Error) => setError(reason.message)); };
  const snapshot = useMemo(() => day?.hours.find((item) => item.hour === hour) || day?.hours.at(-1), [day, hour]);
  return <div className="page"><PageHeader title="历史归档" subtitle="按日期和小时回看原始微博热搜榜，保留当时排名、热度与话题标记。" aside={<div className="status-pill"><CalendarDays size={14} />{manifest?.available_dates.length || 0} 个归档日期</div>} />
    <div className="toolbar"><Select value={date} onValueChange={changeDate}><SelectTrigger className="w-[160px]" aria-label="归档日期"><SelectValue placeholder="选择日期" /></SelectTrigger><SelectContent>{manifest?.available_dates.slice().reverse().map((item) => <SelectItem value={item} key={item}>{item}</SelectItem>)}</SelectContent></Select><span className="text-xs text-muted-foreground">快照时间：{formatDateTime(snapshot?.captured_at)}</span></div>
    {day && <div className="mb-4 flex flex-wrap gap-2">{day.hours.map((item) => <Button size="sm" variant={item.hour === snapshot?.hour ? "default" : "outline"} onClick={() => setHour(item.hour)} key={item.hour}>{item.hour}:00</Button>)}</div>}
    {error ? <ErrorState message={error} /> : !snapshot ? <div className="loading-block h-96" /> : <HotlistTable entries={[...snapshot.topics].sort((a, b) => a.original_rank - b.original_rank)} preserveRank onSelect={setSelected} />}
    <TopicSheet selected={selected} onClose={() => setSelected(null)} />
  </div>;
}
