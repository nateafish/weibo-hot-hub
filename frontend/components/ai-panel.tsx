"use client";

import { ArrowLeftRight, ExternalLink, FileText, GitCompareArrows, Link2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AiCitationComparison } from "@/components/ai-citation-comparison";
import { EmptyState, ErrorState } from "@/components/app-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadAiContent } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import type { AiContent, AiReferenceTrace, AiVersion, TopicSummary } from "@/lib/types";

function useAiContent(topicId: string, version: string) {
  const [result, setResult] = useState<{ version: string; content?: AiContent; error?: string }>();

  useEffect(() => {
    if (!version) return;
    let active = true;
    loadAiContent(topicId, version).then(
      (content) => { if (active) setResult({ version, content }); },
      (reason: Error) => { if (active) setResult({ version, error: reason.message }); },
    );
    return () => { active = false; };
  }, [topicId, version]);

  return result?.version === version ? result : undefined;
}

function VersionSelect({ label, versions, value, onChange }: {
  label: string;
  versions: AiVersion[];
  value: string;
  onChange: (value: string) => void;
}) {
  const labelId = useId();
  return (
    <div className="min-w-0">
      <span id={labelId} className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-labelledby={labelId} className="w-full bg-background sm:min-w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {versions.map((version) => (
            <SelectItem value={version.id} key={version.id}>{formatDateTime(version.captured_at)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SingleAnswer({ topicId, versions, version, onChange }: {
  topicId: string;
  versions: AiVersion[];
  version: string;
  onChange: (value: string) => void;
}) {
  const result = useAiContent(topicId, version);
  const selected = versions.find((item) => item.id === version);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <VersionSelect label="采集版本" versions={versions} value={version} onChange={onChange} />
        {selected?.source_url && (
          <a className="mb-2.5 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4" href={selected.source_url} target="_blank" rel="noreferrer">
            智搜原页<ExternalLink size={12} />
          </a>
        )}
      </div>
      {result?.error ? <ErrorState message={result.error} /> : !result?.content ? (
        <div className="loading-block h-80" role="status" aria-label="正在加载答案" />
      ) : (
        <>
          {result.content.thinking_markdown && (
            <details className="rounded-lg border bg-muted/30 px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium">深度思考</summary>
              <div className="prose mt-2 [overflow-wrap:anywhere]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.content.thinking_markdown}</ReactMarkdown>
              </div>
            </details>
          )}
          <article className="prose [overflow-wrap:anywhere]">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>
              {result.content.markdown}
            </ReactMarkdown>
          </article>
        </>
      )}
    </div>
  );
}

function VersionComparison({ topicId, before, after }: { topicId: string; before: string; after: string }) {
  const baseline = useAiContent(topicId, before);
  const comparison = useAiContent(topicId, after);
  const error = baseline?.error || comparison?.error;
  if (error) return <ErrorState message={error} />;
  if (!baseline?.content || !comparison?.content) {
    return <div className="loading-block h-64" role="status" aria-label="正在加载对比版本" />;
  }
  return (
    <>
      <ReferenceBreakdownComparison before={baseline.content.reference_trace} after={comparison.content.reference_trace} />
      <AiCitationComparison before={baseline.content.markdown} after={comparison.content.markdown} />
    </>
  );
}

const formatPercentage = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const formatDelta = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2, signDisplay: "exceptZero" });

function ReferenceBreakdownComparison({ before, after }: { before?: AiReferenceTrace; after?: AiReferenceTrace }) {
  const baseline = new Map(before?.breakdown.map(({ label, percent }) => [label, percent]));
  const comparison = new Map(after?.breakdown.map(({ label, percent }) => [label, percent]));
  const categories = [...new Set([...baseline.keys(), ...comparison.keys()])];
  if (!before && !after) return <p className="text-xs text-muted-foreground">这两版归档未保存认证占比。</p>;

  return (
    <section aria-label="信源账号占比变化" className="overflow-hidden rounded-lg border">
      <h3 className="border-b bg-muted/40 px-3 py-2.5 text-sm font-semibold">信源账号占比变化</h3>
      <table className="w-full text-sm tabular-nums">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="p-2 pl-3 text-left font-medium">账号类型</th>
            <th scope="col" className="p-2 text-right font-medium">基准版</th>
            <th scope="col" className="p-2 text-right font-medium">对照版</th>
            <th scope="col" className="p-2 pr-3 text-right font-medium">变化</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t">
            <th scope="row" className="p-2 pl-3 text-left font-medium">引用博文</th>
            <td className="p-2 text-right">{before ? `${before.reported_count} 篇` : "—"}</td>
            <td className="p-2 text-right">{after ? `${after.reported_count} 篇` : "—"}</td>
            <td className="p-2 pr-3 text-right">{before && after ? `${formatDelta.format(after.reported_count - before.reported_count)} 篇` : "—"}</td>
          </tr>
          {categories.map((label) => {
            const from = baseline.get(label);
            const to = comparison.get(label);
            const change = from === undefined || to === undefined ? undefined : to - from;
            return (
              <tr key={label} className="border-t">
                <th scope="row" className="p-2 pl-3 text-left font-medium">{label}</th>
                <td className="p-2 text-right">{from === undefined ? "—" : `${formatPercentage.format(from)}%`}</td>
                <td className="p-2 text-right">{to === undefined ? "—" : `${formatPercentage.format(to)}%`}</td>
                <td className="p-2 pr-3 text-right">{change === undefined ? "—" : `${formatDelta.format(change)} 个百分点`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(!before || !after) && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{before ? "对照版" : "基准版"}的归档未保存认证占比。</p>}
    </section>
  );
}

function ReferenceTrace({ trace }: { trace: AiReferenceTrace }) {
  const [category, setCategory] = useState<string>();
  const selected = trace.breakdown.find((entry) => entry.label === category);
  const posts = selected ? trace.posts.filter((post) => post.category === selected.label) : trace.posts;
  const unnamed = trace.posts.filter((post) => !post.username).length;

  return (
    <section aria-label="信源追溯" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h3 className="text-base font-semibold">参考 {trace.reported_count} 篇博文</h3>
          <p className="mt-1 text-xs text-muted-foreground">采集于 {formatDateTime(trace.captured_at)} · 已保存 {trace.posts.length} 条{unnamed > 0 && ` · ${unnamed} 条暂缺用户名`}</p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <a className="inline-flex items-center gap-1 underline underline-offset-4" href={trace.source_url} target="_blank" rel="noreferrer">智搜原页 <ExternalLink size={12} /></a>
          <a className="inline-flex items-center gap-1 underline underline-offset-4" href={selected?.url ?? trace.reference_url} target="_blank" rel="noreferrer">微博检索原页 <ExternalLink size={12} /></a>
        </div>
      </div>
      <div role="group" aria-label="筛选信源账号类型" className="flex flex-wrap gap-2">
        <Button size="sm" variant={!selected ? "default" : "outline"} aria-pressed={!selected} onClick={() => setCategory(undefined)}>全部</Button>
        {trace.breakdown.map((entry) => (
          <Button key={entry.label} size="sm" variant={selected === entry ? "default" : "outline"} aria-pressed={selected === entry}
            onClick={() => setCategory(entry.label)}>{entry.label} {entry.percent}%</Button>
        ))}
      </div>
      {posts.length ? (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {posts.map((post) => (
            <li key={post.mid} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <a href={post.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-4">
                  {post.username || `微博 ${post.mid}`}<ExternalLink size={12} />
                </a>
                {post.category && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{post.category}</span>}
                {post.created_at_text && <span className="text-xs text-muted-foreground">{post.created_at_text}</span>}
              </div>
              {post.excerpt && <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{post.excerpt}</p>}
            </li>
          ))}
        </ul>
      ) : <EmptyState title="这一分类暂无已归档的博文" />}
    </section>
  );
}

function VersionReferenceTrace({ topicId, versions, version, onChange }: {
  topicId: string;
  versions: AiVersion[];
  version: string;
  onChange: (version: string) => void;
}) {
  const result = useAiContent(topicId, version);
  return (
    <div className="space-y-4">
      <div className="w-fit"><VersionSelect label="采集版本" versions={versions} value={version} onChange={onChange} /></div>
      {result?.error ? <ErrorState message={result.error} /> : !result?.content ? (
        <div className="loading-block h-40" role="status" aria-label="正在加载信源追溯" />
      ) : result.content.reference_trace ? (
        <ReferenceTrace key={version} trace={result.content.reference_trace} />
      ) : <EmptyState title="该版本未保存信源追溯" />}
    </div>
  );
}

function AiVersionPanel({ summary }: { summary: TopicSummary }) {
  const versions = summary.ai_versions;
  const [version, setVersion] = useState(versions[0].id);
  const [before, setBefore] = useState(versions[1]?.id ?? versions[0].id);
  const [after, setAfter] = useState(versions[0].id);
  const hasVersionTraces = versions.some((item) => item.has_reference_trace);

  function swapVersions() {
    setBefore(after);
    setAfter(before);
  }

  return (
    <Card className="min-w-0 p-4 shadow-sm sm:p-6">
      <Tabs defaultValue="answer" className="gap-4">
        <TabsList aria-label="智搜答案视图" className="max-w-full">
          <TabsTrigger value="answer"><FileText className="size-3.5" />单版答案</TabsTrigger>
          <TabsTrigger value="compare" disabled={versions.length < 2}>
            <GitCompareArrows className="size-3.5" />信源对比
          </TabsTrigger>
          {(hasVersionTraces || summary.ai_reference_trace) && <TabsTrigger value="references"><Link2 className="size-3.5" />信源追溯</TabsTrigger>}
        </TabsList>
        <TabsContent value="answer">
          <SingleAnswer topicId={summary.topic_id} versions={versions} version={version} onChange={setVersion} />
        </TabsContent>
        <TabsContent value="compare" className="min-w-0 space-y-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 rounded-lg border bg-muted/30 p-3 sm:flex sm:flex-wrap sm:p-4">
            <VersionSelect label="基准版本" versions={versions} value={before} onChange={setBefore} />
            <Button type="button" size="icon" variant="outline" onClick={swapVersions} disabled={before === after}
              className="col-start-2 row-span-2 row-start-1 self-center sm:self-end" aria-label="交换基准和对照版本" title="交换版本">
              <ArrowLeftRight />
            </Button>
            <VersionSelect label="对照版本" versions={versions} value={after} onChange={setAfter} />
          </div>
          {before === after ? <EmptyState title="请选择两个不同的采集版本" /> : (
            <VersionComparison topicId={summary.topic_id} before={before} after={after} />
          )}
        </TabsContent>
        {(hasVersionTraces || summary.ai_reference_trace) && (
          <TabsContent value="references">
            {hasVersionTraces && <VersionReferenceTrace topicId={summary.topic_id} versions={versions} version={version} onChange={setVersion} />}
            {summary.ai_reference_trace && (
              <details className={hasVersionTraces ? "mt-5 border-t pt-4" : undefined} open={!hasVersionTraces}>
                <summary className="mb-3 cursor-pointer text-sm font-medium">话题信源追溯</summary>
                <ReferenceTrace trace={summary.ai_reference_trace} />
              </details>
            )}
          </TabsContent>
        )}
      </Tabs>
    </Card>
  );
}

export function AiPanel({ summary }: { summary: TopicSummary }) {
  if (!summary.ai_versions.length && summary.ai_reference_trace) {
    return <Card className="min-w-0 p-4 shadow-sm sm:p-6"><ReferenceTrace key={summary.topic_id} trace={summary.ai_reference_trace} /></Card>;
  }
  if (!summary.ai_versions.length) return <EmptyState title="暂无可展示的微博智搜内容" description="拒答内容不会保存，也不会出现在这里。" />;
  return <AiVersionPanel key={summary.topic_id} summary={summary} />;
}
