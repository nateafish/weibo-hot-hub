"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadTopicTrends } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import type { TopicSummary, TrendRecord } from "@/lib/types";
import { EmptyState, ErrorState } from "@/components/app-state";

const metrics = [
  ["read", "阅读", "var(--color-read)"],
  ["mention", "讨论", "var(--color-mention)"],
  ["interaction", "互动", "var(--color-interaction)"],
  ["original", "原创", "var(--color-original)"],
] as const;
const chartConfig = {
  read: { label: "阅读", color: "var(--chart-read)" },
  mention: { label: "讨论", color: "var(--chart-mention)" },
  interaction: { label: "互动", color: "var(--chart-interaction)" },
  original: { label: "原创", color: "var(--chart-original)" },
} satisfies ChartConfig;

export function TrendPanel({ summary }: { summary: TopicSummary }) {
  const [date, setDate] = useState(summary.trend_dates.at(-1) || "");
  const [records, setRecords] = useState<TrendRecord[]>([]);
  const [capture, setCapture] = useState(0);
  const [period, setPeriod] = useState<"1h" | "24h">("1h");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!date) return;
    setError("");
    loadTopicTrends(summary.topic_id, date).then((value) => { setRecords(value); setCapture(Math.max(0, value.length - 1)); }).catch((reason: Error) => setError(reason.message));
  }, [date, summary.topic_id]);
  const record = records[capture];
  const chartData = useMemo(() => {
    const series = record?.[period] || {};
    const byAt = new Map<string, Record<string, string | number>>();
    for (const [key] of metrics) for (const point of series[key] || []) {
      const row = byAt.get(point.at) || { at: point.at, label: point.label };
      row[key] = point.value; byAt.set(point.at, row);
    }
    return Array.from(byAt.values());
  }, [record, period]);
  if (!summary.trend_dates.length) return <EmptyState title="暂无趋势留档" description="该话题还没有可绘制的趋势快照。" />;
  return <Card className="p-5 shadow-sm md:p-6">
    <div className="toolbar"><Select value={date} onValueChange={setDate}><SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger><SelectContent>{summary.trend_dates.slice().reverse().map((item) => <SelectItem value={item} key={item}>{item}</SelectItem>)}</SelectContent></Select><Select value={String(capture)} onValueChange={(value) => setCapture(Number(value))}><SelectTrigger className="w-[190px]" aria-label="采集时间"><SelectValue /></SelectTrigger><SelectContent>{records.map((item, index) => <SelectItem value={String(index)} key={`${item.captured_at}-${index}`}>{formatDateTime(item.captured_at)}</SelectItem>)}</SelectContent></Select><Tabs value={period} onValueChange={(value) => setPeriod(value as "1h" | "24h")}><TabsList><TabsTrigger value="1h">1 小时</TabsTrigger><TabsTrigger value="24h">24 小时</TabsTrigger></TabsList></Tabs></div>
    {error ? <ErrorState message={error} /> : !chartData.length ? <EmptyState title="这一采集时点没有趋势数据" description="可切换其他采集时间或统计周期。" /> : <ChartContainer config={chartConfig} className="h-[360px] w-full aspect-auto"><LineChart data={chartData} margin={{ top: 16, right: 18, bottom: 8, left: 4 }}><CartesianGrid vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} /><YAxis tickLine={false} axisLine={false} tickFormatter={(value) => Number(value).toLocaleString("zh-CN", { notation: "compact" })} /><ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => `时间 ${label}`} />} /><ChartLegend content={<ChartLegendContent />} />{metrics.map(([key, label, color]) => <Line key={key} name={key} dataKey={key} type="monotone" stroke={color} strokeWidth={2} dot={false} connectNulls aria-label={label} />)}</LineChart></ChartContainer>}
  </Card>;
}
