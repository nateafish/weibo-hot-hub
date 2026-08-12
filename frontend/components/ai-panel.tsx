"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadAiContent } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import type { AiContent, TopicSummary } from "@/lib/types";
import { EmptyState, ErrorState } from "@/components/app-state";

export function AiPanel({ summary }: { summary: TopicSummary }) {
  const [version, setVersion] = useState(summary.ai_versions[0]?.id || "");
  const [content, setContent] = useState<AiContent | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!version) return;
    setContent(null); setError("");
    loadAiContent(summary.topic_id, version).then(setContent).catch((reason: Error) => setError(reason.message));
  }, [summary.topic_id, version]);
  const selected = summary.ai_versions.find((item) => item.id === version);
  if (!summary.ai_versions.length) return <EmptyState title="暂无可展示的微博智搜内容" description="拒答内容不会保存，也不会出现在这里。" />;
  return <Card className="p-5 shadow-sm md:p-6"><div className="toolbar"><Select value={version} onValueChange={setVersion}><SelectTrigger className="max-w-full sm:w-[220px]"><SelectValue /></SelectTrigger><SelectContent>{summary.ai_versions.map((item) => <SelectItem value={item.id} key={item.id}>{formatDateTime(item.captured_at)}</SelectItem>)}</SelectContent></Select>{selected?.source_url && <a className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4" href={selected.source_url} target="_blank" rel="noreferrer">智搜原页<ExternalLink size={12} /></a>}</div>{error ? <ErrorState message={error} /> : !content ? <div className="loading-block h-80" /> : <article className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{content.markdown}</ReactMarkdown></article>}</Card>;
}
