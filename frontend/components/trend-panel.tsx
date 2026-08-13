"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { EmptyState, ErrorState } from "@/components/app-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

function LongTrendCard({
  title,
  description,
  history,
  hours,
}: {
  title: string;
  description: string;
  history: TrendHistory;
  hours?: number;
}) {
  const series = windowedMetrics(history, hours);
  const available = metrics.map(([key]) => series[key]);
  const hasData = available.some((points) => points.length > 0);

  return (
    <Card className="min-w-0 gap-4 py-4 shadow-none">
      <CardHeader className="gap-1 px-4">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{hasData ? `${description} · ${coverageLabel(available)}` : description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 px-4">
        {!hasData ? (
          <EmptyState title="暂无长期趋势" description="继续按小时归档后会自动形成曲线。" />
        ) : metrics.map(([key, label, color]) => {
          const points = series[key];
          const latest = points.at(-1)?.value;
          const peak = points.length ? Math.max(...points.map((point) => point.value)) : undefined;
          const data = points.map((point) => ({ at: point.at, [key]: point.value }));
          return (
            <div className="grid min-w-0 grid-cols-[4.5rem_1fr] items-center gap-2" key={key}>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-1 truncate text-sm font-semibold tabular-nums">
                  {latest === undefined ? "—" : compactNumber.format(latest)}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  峰值 {peak === undefined ? "—" : compactNumber.format(peak)}
                </div>
              </div>
              {data.length > 1 ? (
                <ChartContainer config={chartConfig} className="h-[68px] w-full min-w-0 aspect-auto">
                  <LineChart data={data} margin={{ top: 6, right: 2, bottom: 6, left: 2 }}>
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          hideIndicator
                          labelFormatter={(_, payload) => formatDateTime(String(payload?.[0]?.payload?.at || ""))}
                        />
                      }
                    />
                    <Line
                      dataKey={key}
                      name={key}
                      type="monotone"
                      stroke={color}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ChartContainer>
              ) : <div className="text-xs text-muted-foreground">等待更多采集时点</div>}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function TrendPanel({ summary }: { summary: TopicSummary }) {
  const [date, setDate] = useState(summary.trend_dates.at(-1) || "");
  const [records, setRecords] = useState<TrendRecord[]>([]);
  const [history, setHistory] = useState<TrendHistory | null>(null);
  const [capture, setCapture] = useState(0);
  const [period, setPeriod] = useState<"1h" | "24h">("1h");
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
        ) : history ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <LongTrendCard title="72 小时" description="最近三天" history={history} hours={72} />
            <LongTrendCard title="1 周" description="最近七天" history={history} hours={168} />
            <LongTrendCard title="话题总传播趋势" description={`全部 ${history.snapshot_count} 个留存快照`} history={history} />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3" aria-label="长期趋势加载中">
            {[0, 1, 2].map((item) => <Card className="h-[400px] animate-pulse bg-muted/40 shadow-none" key={item} />)}
          </div>
        )}
      </div>
    </Card>
  );
}
