"use client";

import { ArrowRight, ArrowRightLeft, ChevronDown, ExternalLink, Link2, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { citationKey, compareCitationSources, extractCitationSources } from "@/lib/ai-citations";
import type { CitationChange, CitationSource, CitationStatus } from "@/lib/ai-citations";
import { cn } from "@/lib/utils";

const statuses = {
  added: { label: "新增", icon: Plus, color: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-300" },
  removed: { label: "移除", icon: Minus, color: "text-red-700 bg-red-50 dark:bg-red-950/50 dark:text-red-300" },
  moved: { label: "位置变化", icon: ArrowRightLeft, color: "text-amber-800 bg-amber-50 dark:bg-amber-950/50 dark:text-amber-300" },
  references: { label: "引用增减", icon: Link2, color: "text-sky-800 bg-sky-50 dark:bg-sky-950/50 dark:text-sky-300" },
  retained: { label: "保留", icon: Link2, color: "text-muted-foreground bg-muted" },
} satisfies Record<CitationStatus, { label: string; icon: typeof Plus; color: string }>;

const statusOrder = ["added", "removed", "moved", "references", "retained"] as const;

type Side = "before" | "after";
type Selection = { key: string };

const sideLabels = { before: "基准版本", after: "对照版本" };

function placementLabel(placement: CitationSource["placements"][number]) {
  return `${placement.section} · ${placement.kind === "heading" ? "标题" : `第 ${placement.paragraph} 段`}`;
}

function locationLabels(change: CitationChange, side: Side) {
  const source = change[side];
  if (!source) return "未出现";
  const other = change[side === "before" ? "after" : "before"];
  const changed = side === "before" ? change.beforeChanged : change.afterChanged;
  const labels = changed.map(placementLabel);
  if (source.inSourceList && !other?.inSourceList) labels.push("文末信源");
  if (!labels.length) labels.push(...source.placements.map(placementLabel));
  return Array.from(new Set(labels)).join("、") || "文末信源";
}

function AnswerColumn({ markdown, side, changes, selection, onSelect }: {
  markdown: string;
  side: Side;
  changes: Map<string, CitationChange>;
  selection?: Selection;
  onSelect: (key: string) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = contentRef.current;
    if (!container || !selection) return;
    const matches = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-citation-key]"))
      .filter((button) => button.dataset.citationKey === selection.key);
    const target = matches.find((button) => button.dataset.citationStatus) ?? matches[0];
    if (target) container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top - 44;
  }, [markdown, selection]);

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border" aria-label={`${sideLabels[side]}正文`}>
      <h4 className="border-b bg-muted/50 px-4 py-2.5 text-sm font-semibold">{sideLabels[side]}正文</h4>
      <div ref={contentRef} tabIndex={0} aria-label={`滚动阅读${sideLabels[side]}正文`}
        className="h-[28rem] overflow-auto overscroll-contain px-4 py-2 lg:h-[min(65vh,42rem)]">
        <article className="prose [overflow-wrap:anywhere]">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
            a: ({ href, node, children }) => {
              const key = href ? citationKey(href) : undefined;
              const change = key ? changes.get(key) : undefined;
              if (!key || !change) return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
              const source = change[side];
              const other = change[side === "before" ? "after" : "before"];
              const offset = node?.position?.start.offset;
              const changed = side === "before" ? change.beforeChanged : change.afterChanged;
              const changedPlacement = offset !== undefined && changed.some((placement) => placement.offset === offset);
              const changedFooter = source?.inSourceList && !other?.inSourceList &&
                offset !== undefined && !source.placements.some((placement) => placement.offset === offset);
              const status = !other || changedPlacement ? change.statuses[0] : changedFooter ? "references" : undefined;
              const selected = selection?.key === key;
              const name = source?.name ?? other?.name;
              const bare = typeof children === "string" && /^https?:\/\//i.test(children);
              return (
                <button type="button" data-citation-key={key} data-citation-status={status}
                  aria-pressed={selected} onClick={() => onSelect(key)}
                  className={cn("inline rounded px-1 text-left font-medium underline decoration-dotted underline-offset-4 [overflow-wrap:anywhere]",
                    status && statuses[status].color, selected && "outline outline-2 outline-offset-1 outline-current")}>
                  {status && <span className="sr-only">{statuses[status].label} </span>}
                  {bare && name ? name : children}
                </button>
              );
            },
          }}>{markdown}</ReactMarkdown>
        </article>
      </div>
    </section>
  );
}

function CitationRoute({ change }: { change: CitationChange }) {
  const status = statuses[change.statuses[0]];
  const name = change.after?.name ?? change.before?.name;
  return (
    <div aria-label="所选信源的对应位置" className="rounded-lg border bg-muted/25 px-3 py-3 text-sm sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", status.color)}>{status.label}</span>
        <a href={change.source.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 font-semibold underline underline-offset-4 [overflow-wrap:anywhere]">
          {name ?? change.source.url.replace(/^https?:\/\//, "")}<ExternalLink className="size-3 shrink-0" />
        </a>
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-xs sm:gap-4">
        <div className="min-w-0 rounded-md border bg-background p-2 [overflow-wrap:anywhere]"><div className="mb-1 font-medium text-muted-foreground">基准版</div>{locationLabels(change, "before")}</div>
        <ArrowRight className="size-4 text-muted-foreground" aria-label="变为" />
        <div className="min-w-0 rounded-md border bg-background p-2 [overflow-wrap:anywhere]"><div className="mb-1 font-medium text-muted-foreground">对照版</div>{locationLabels(change, "after")}</div>
      </div>
    </div>
  );
}

function sourceSummary(source?: CitationSource) {
  if (!source) return "未出现";
  const locations = [];
  if (source.placements.length) locations.push(`正文 ${source.placements.length} 处`);
  if (source.inSourceList) locations.push("文末信源");
  return locations.join(" · ");
}

function CitationContext({ label, source }: { label: string; source?: CitationSource }) {
  return (
    <section className="min-w-0 space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground">{label}</h4>
      {!source && <p className="text-sm text-muted-foreground">未出现</p>}
      {source?.inSourceList && <p className="text-xs font-medium">列入文末信源</p>}
      {source?.placements.map((placement, index) => (
        <div key={`${placement.position}:${index}`} className="border-l-2 pl-3">
          <p className="text-xs font-medium [overflow-wrap:anywhere]">
            {placementLabel(placement)}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
            {placement.kind === "media" ? "独立素材链接" : placement.context}
          </p>
        </div>
      ))}
    </section>
  );
}

function CitationRow({ change, onLocate }: { change: CitationChange; onLocate: (key: string) => void }) {
  const { source, before, after } = change;
  const displayUrl = source.url.replace(/^https?:\/\//, "");
  const sourceName = after?.name ?? before?.name;

  return (
    <details className="group border-b last:border-b-0">
      <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-3 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 md:grid-cols-[5.5rem_minmax(0,1fr)_minmax(14rem,auto)_auto] [&::-webkit-details-marker]:hidden">
        <span className="flex flex-col items-start gap-1">
          {change.statuses.map((status) => {
            const { icon: Icon, label, color } = statuses[status];
            return (
              <span key={status} className={cn("inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium", color)}>
                <Icon className="size-3.5" aria-hidden="true" />{label}
              </span>
            );
          })}
        </span>
        <span className="min-w-0">
          {sourceName && <span className="block truncate text-sm font-medium">{sourceName}</span>}
          <span className="block truncate font-mono text-xs text-muted-foreground" title={displayUrl}>{displayUrl}</span>
        </span>
        <span className="col-start-2 row-start-2 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground md:col-start-3 md:row-start-1">
          {sourceSummary(before)} <ArrowRight className="size-3 shrink-0" aria-label="变为" /> {sourceSummary(after)}
        </span>
        <ChevronDown className="col-start-3 row-start-1 size-4 text-muted-foreground group-open:rotate-180 md:col-start-4" aria-hidden="true" />
      </summary>
      <div className="border-t bg-muted/30 px-3 py-4 sm:px-4">
        <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-xs font-medium underline underline-offset-4">
          打开来源链接<ExternalLink className="size-3 shrink-0" />
        </a>
        <Button type="button" size="sm" variant="outline" className="ml-3" onClick={() => onLocate(change.key)}>在两版正文定位</Button>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 sm:gap-6">
          <CitationContext label="基准版本" source={before} />
          <CitationContext label="对照版本" source={after} />
        </div>
      </div>
    </details>
  );
}

export function AiCitationComparison({ before, after }: { before: string; after: string }) {
  const [filter, setFilter] = useState<CitationStatus | "changes">("changes");
  const [selection, setSelection] = useState<Selection>();
  const comparisonRef = useRef<HTMLDivElement>(null);
  const baseline = useMemo(() => extractCitationSources(before), [before]);
  const comparison = useMemo(() => extractCitationSources(after), [after]);
  const changes = useMemo(() => compareCitationSources(baseline, comparison), [baseline, comparison]);
  const byKey = useMemo(() => new Map(changes.map((change) => [change.key, change])), [changes]);
  const groups = { added: [], removed: [], moved: [], references: [], retained: [] } as Record<CitationStatus, CitationChange[]>;
  for (const change of changes) {
    for (const status of change.statuses) groups[status].push(change);
  }
  const changedRows = statusOrder.slice(0, -1).flatMap((status) => groups[status].filter((change) => change.statuses[0] === status));
  const rows = filter === "changes" ? changedRows : groups[filter];
  const selected = selection && byKey.get(selection.key);

  function locate(key: string) {
    setSelection({ key });
    comparisonRef.current?.scrollIntoView({ block: "start" });
  }

  return (
    <section aria-label="信源变化" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-semibold">信源变化</h3>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          {baseline.size} <ArrowRight className="size-3" aria-label="变为" /> {comparison.size} 个来源
        </p>
      </div>
      <div role="group" aria-label="筛选信源变化" className="flex flex-wrap gap-1.5">
        <Button type="button" size="sm" variant={filter === "changes" ? "default" : "outline"} aria-pressed={filter === "changes"} onClick={() => setFilter("changes")}>
          全部变化 <span className="tabular-nums opacity-70">{changedRows.length}</span>
        </Button>
        {statusOrder.map((status) => {
          const { icon: Icon, label, color } = statuses[status];
          const active = filter === status;
          return (
            <Button key={status} type="button" size="sm" variant={active ? "default" : "outline"} aria-pressed={active} onClick={() => setFilter(status)}>
              <Icon className={cn("size-3.5 rounded-sm", !active && color)} aria-hidden="true" />
              {label} <span className="tabular-nums opacity-70">{groups[status].length}</span>
            </Button>
          );
        })}
      </div>
      <div ref={comparisonRef} className="scroll-mt-16 space-y-3">
        {selected ? <CitationRoute change={selected} /> : (
          <p className="text-xs leading-5 text-muted-foreground">点正文里的引用，查看它在两版中的位置。</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <AnswerColumn markdown={before} side="before" changes={byKey} selection={selection} onSelect={(key) => setSelection({ key })} />
          <AnswerColumn markdown={after} side="after" changes={byKey} selection={selection} onSelect={(key) => setSelection({ key })} />
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border" aria-live="polite">
        {rows.length ? rows.map((change) => <CitationRow key={change.key} change={change} onLocate={locate} />) : (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {filter === "changes" ? "两版归档的信源及引用位置一致。" : `没有${statuses[filter].label}的信源。`}
          </p>
        )}
      </div>
    </section>
  );
}
