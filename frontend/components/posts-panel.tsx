"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/app-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadTopicPosts } from "@/lib/data";
import type { PostDay, TopicSummary } from "@/lib/types";

export function PostsPanel({ summary }: { summary: TopicSummary }) {
  const [date, setDate] = useState(summary.post_dates.at(-1) || "");
  const [day, setDay] = useState<PostDay | null>(null);
  const [hour, setHour] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!date) return;
    setError("");
    loadTopicPosts(summary.topic_id, date).then((value) => { setDay(value); setHour(Object.keys(value.hours).sort().at(-1) || ""); }).catch((reason: Error) => setError(reason.message));
  }, [date, summary.topic_id]);
  const posts = useMemo(() => {
    const pages = day?.hours[hour]?.pages || [];
    return pages.flat().map((mid, index) => ({ post: day?.objects[mid], page: pages.findIndex((page) => page.includes(mid)) + 1, index })).filter((item) => item.post);
  }, [day, hour]);
  if (!summary.post_dates.length) return <EmptyState title="暂无正文留档" description="该话题尚未保存可展示的微博正文。" />;
  return <div className="space-y-4"><div className="toolbar"><Select value={date} onValueChange={setDate}><SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger><SelectContent>{summary.post_dates.slice().reverse().map((item) => <SelectItem value={item} key={item}>{item}</SelectItem>)}</SelectContent></Select></div>{day && <div className="flex flex-wrap gap-2">{Object.keys(day.hours).sort().map((item) => <Button size="sm" variant={item === hour ? "default" : "outline"} onClick={() => setHour(item)} key={item}>{item}:00 · {day.hours[item].unique_posts} 条</Button>)}</div>}
    {error ? <ErrorState message={error} /> : !day ? <div className="loading-block h-64" /> : !posts.length ? <EmptyState title="这一小时没有正文" description="可切换其他小时查看。" /> : <div className="post-list">{posts.map(({ post, page, index }) => post && <Card className="post-card shadow-sm" key={`${post.mid}-${index}`}><div className="post-author"><span><b className="text-foreground">{post.username || "微博用户"}</b> · 第 {page} 页</span><span>{post.created_at_text || "时间未知"}</span></div><p className="post-body">{post.body}</p>{post.url && <a className="mt-3 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4" href={post.url} target="_blank" rel="noreferrer">查看原微博<ExternalLink size={12} /></a>}</Card>)}</div>}
  </div>;
}
