"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { EmptyState, ErrorState } from "@/components/app-state";
import { Card } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadTopicTrendHistory, loadTopicTrends } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import type { TopicSummary, TrendHistory, TrendPoint, TrendRecord } from "@/lib/types";

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

const compactNumber = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function coverageLabel(points: TrendPoint[][]): string {
  const times = points.flat().map((point) => Date.parse(point.at)).filter(Number.isFinite);
  if (times.length < 2) return `${times.length} 个有效时点`;
  const hours = Math.max(1, Math.ceil((Math.max(...times) - Math.min(...times)) / 3_600_000));
  return hours < 48 ? `已覆盖 ${hours} 小时` : `已覆盖 ${(hours / 24).toFixed(hours < 240 ? 1 : 0)} 天`;
}

function windowedMetrics(history: TrendHistory, hours?: number): Record<string, TrendPoint[]> {
  const last = Date.parse(history.last_at || "");
  const cutoff = hours && Number.isFinite(last) ? last - hours * 3_600_000 : Number.NEGATIVE_INFINITY;
  return Object.fromEntries(
    metrics.map(([key]) => [
      key,
      (history.metrics[key] || []).filter((point) => Date.parse(point.at) >= cutoff),
    ]),
  );
}

function historyAxisLabel(at: string): string {
  const value = new Date(at);
  if (Number.isNaN(value.getTime())) return at;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).format(value);
}

export function TrendPanel({ summary }: { summary: TopicSummary }) {
  const [date, setDate] = useState(summary.trend_dates.at(-1) || "");
  const [records, setRecords] = useState<TrendRecord[]>([]);
  const [history, setHistory] = useState<TrendHistory | null>(null);
  const [capture, setCapture] = useState(0);
  // The 1h series is no longer collected (dropped to save requests), so the
  // 24h curve is the default view.
  const [period, setPeriod] = useState<"1h" | "24h">("24h");
  const [historyPeriod, setHistoryPeriod] = useState<"72h" | "168h" | "all">("72h");
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    if (!date) return;
    setError("");
    loadTopicTrends(summary.topic_id, date)
      .then((value) => {
        setRecords(value);
        setCapture(Math.max(0, value.length - 1));
      })
      .catch((reason: Error) => setError(reason.message));
  }, [date, summary.topic_id]);

  useEffect(() => {
    setHistoryError("");
    loadTopicTrendHistory(summary.topic_id)
      .then(setHistory)
      .catch((reason: Error) => setHistoryError(reason.message));
  }, [summary.topic_id]);

  const record = records[capture];
  const chartData = useMemo(() => {
    const series = record?.[period] || {};
    const byAt = new Map<string, Record<string, string | number>>();
    for (const [key] of metrics) {
      for (const point of series[key] || []) {
        const row = byAt.get(point.at) || { at: point.at, label: point.label };
        row[key] = point.value;
        byAt.set(point.at, row);
      }
    }
    return Array.from(byAt.values());
  }, [record, period]);
  const historyView = useMemo(() => {
    if (!history) return null;
    const hours = historyPeriod === "72h" ? 72 : historyPeriod === "168h" ? 168 : undefined;
    const series = windowedMetrics(history, hours);
    const byAt = new Map<string, Record<string, string | number>>();
    for (const [key] of metrics) {
      for (const point of series[key]) {
        const row = byAt.get(point.at) || { at: point.at, label: historyAxisLabel(point.at) };
        row[key] = point.value;
        byAt.set(point.at, row);
      }
    }
    const description = historyPeriod === "72h"
      ? "最近三天"
      : historyPeriod === "168h"
        ? "最近七天"
        : `全部 ${history.snapshot_count} 个留存快照`;
    return {
      data: Array.from(byAt.values()),
      description,
      coverage: coverageLabel(metrics.map(([key]) => series[key])),
    };
  }, [history, historyPeriod]);

  if (!summary.trend_dates.length) {
    return <EmptyState title="暂无趋势留档" description="该话题还没有可绘制的趋势快照。" />;
  }

  return (
    <Card className="p-5 shadow-sm md:p-6">
      <div className="toolbar">
        <Select value={date} onValueChange={setDate}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>{summary.trend_dates.slice().reverse().map((item) => <SelectItem value={item} key={item}>{item}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={String(capture)} onValueChange={(value) => setCapture(Number(value))}>
          <SelectTrigger className="w-[190px]" aria-label="采集时间"><SelectValue /></SelectTrigger>
          <SelectContent>{records.map((item, index) => <SelectItem value={String(index)} key={`${item.captured_at}-${index}`}>{formatDateTime(item.captured_at)}</SelectItem>)}</SelectContent>
        </Select>
        <Tabs value={period} onValueChange={(value) => setPeriod(value as "1h" | "24h")}>
          <TabsList><TabsTrigger value="1h">1 小时</TabsTrigger><TabsTrigger value="24h">24 小时</TabsTrigger></TabsList>
        </Tabs>
      </div>
      {error ? (
        <ErrorState message={error} />
      ) : !chartData.length ? (
        <EmptyState title="这一采集时点没有趋势数据" description="可切换其他采集时间或统计周期。" />
      ) : (
        <ChartContainer config={chartConfig} className="h-[360px] w-full aspect-auto">
          <LineChart data={chartData} margin={{ top: 16, right: 18, bottom: 8, left: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => compactNumber.format(Number(value))} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => `时间 ${label}`} />} />
            <ChartLegend content={<ChartLegendContent />} />
            {metrics.map(([key, label, color]) => <Line key={key} name={key} dataKey={key} type="monotone" stroke={color} strokeWidth={2} dot={false} connectNulls aria-label={label} />)}
          </LineChart>
        </ChartContainer>
      )}

      <div className="mt-2 border-t pt-6">
        <div className="mb-4">
          <h3 className="text-base font-semibold">长期传播趋势</h3>
          <p className="mt-1 text-sm text-muted-foreground">由每小时保存的 24 小时曲线连续拼接；重复时点采用后续快照的完整值。</p>
        </div>
        {historyError ? (
          <ErrorState message={historyError} />
        ) : history && historyView ? (
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <Tabs value={historyPeriod} onValueChange={(value) => setHistoryPeriod(value as typeof historyPeriod)}>
                <TabsList className="h-9">
                  <TabsTrigger className="h-7 px-5" value="72h">72 小时</TabsTrigger>
                  <TabsTrigger className="h-7 px-5" value="168h">1 周</TabsTrigger>
                  <TabsTrigger className="h-7 px-5" value="all">总传播</TabsTrigger>
                </TabsList>
              </Tabs>
              <p className="text-xs text-muted-foreground">{historyView.description} · {historyView.coverage}</p>
            </div>
            {!historyView.data.length ? (
              <EmptyState title="暂无长期趋势" description="继续按小时归档后会自动形成曲线。" />
            ) : (
              <ChartContainer config={chartConfig} className="h-[280px] w-full aspect-auto">
                <LineChart data={historyView.data} margin={{ top: 12, right: 18, bottom: 8, left: 4 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={36} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => compactNumber.format(Number(value))} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => formatDateTime(String(payload?.[0]?.payload?.at || ""))} />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  {metrics.map(([key, label, color]) => <Line key={key} name={key} dataKey={key} type="monotone" stroke={color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} aria-label={label} />)}
                </LineChart>
              </ChartContainer>
            )}
          </div>
        ) : (
          <div className="h-[320px] animate-pulse rounded-xl bg-muted/40" aria-label="长期趋势加载中" />
        )}
      </div>
    </Card>
  );
}
