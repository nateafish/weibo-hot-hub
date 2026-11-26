"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { decryptReview, originalBoard, reviewPoints, REVIEW_DATA_URL, type ReviewData, type ReviewAnswer, type ReviewPoint } from "@/lib/private-review";

const publisher: Record<string, string> = { news_media: "新闻媒体机构", government_judiciary: "党政司法机关", other_organization: "企业及其他组织", individual: "个人", unknown: "资料不足" };
const labels: Record<string, string> = { not_supported: "原帖未完整支持", contradicted: "原帖存在相反表述", uncertain: "文本关系需要复核", supported: "原帖支持", equivalent: "同义", expanded: "补充", revised: "修正", contradicts: "冲突" };
const when = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "日期未记录";
const field = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";

function Outside({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return null;
  try { const u = new URL(href); if (u.protocol !== "https:" || !["github.com", "weibo.com", "www.weibo.com", "m.weibo.cn"].includes(u.hostname)) return null; } catch { return null; }
  return <a className="text-primary underline underline-offset-4" href={href} target="_blank" rel="noreferrer">{children}</a>;
}

function AnswerContext({ answer, point }: { answer: ReviewAnswer; point: ReviewPoint }) {
  const chars = Array.from(answer.body), range = point.claim_detail;
  const exact = range && chars.slice(range.start, range.end).join("") === point.claim;
  return <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">查看答案上下文</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-4 font-sans leading-7">{exact ? <>{chars.slice(0, range.start).join("")}<mark className="bg-amber-200 px-1 text-black">{point.claim}</mark>{chars.slice(range.end).join("")}</> : answer.body}</pre></details>;
}

function PointCard({ answer, point, data }: { answer: ReviewAnswer; point: ReviewPoint; data: ReviewData }) {
  const result = point.result!;
  const line = answer.citations.find((citation) => point.claim_detail?.citation_ids?.includes(citation.id))?.original_line;
  const answerUrl = answer.origin.url + (line ? `#L${line}` : "");
  return <Card className="gap-4 shadow-sm" data-testid="review-point"><CardHeader className="gap-3"><div className="flex flex-wrap items-start justify-between gap-3"><CardTitle className="text-lg leading-7"><Link href={`/topic/?id=${encodeURIComponent(answer.topic_id)}`}>{answer.title}</Link></CardTitle><Badge variant="outline">{labels[result.label] || result.label}</Badge></div><p className="text-sm text-muted-foreground">{when(answer.captured_at)} · {answer.category || "类别未记录"} · 自动核查</p></CardHeader><CardContent>
    <div className="grid gap-5 lg:grid-cols-2"><section className="min-w-0"><h3 className="mb-2 text-sm font-semibold">智搜原句</h3><blockquote className="rounded-md border-l-4 border-amber-400 bg-amber-50 p-4 text-base leading-8 text-slate-900 dark:bg-amber-950/30 dark:text-amber-50">{point.claim}</blockquote><AnswerContext answer={answer} point={point} /></section>
      <section className="min-w-0"><h3 className="mb-2 text-sm font-semibold">所挂原帖</h3>{point.sources.map((source) => { const quotes = result.evidence.filter((e) => e.mid === source.mid); return <div key={source.mid} className="mb-4 rounded-md border p-4"><div className="mb-2 flex flex-wrap gap-2 text-sm font-medium"><span>{source.username || source.mid}</span>{source.account?.badge && <Badge variant="secondary">{source.account.badge}</Badge>}<Outside href={`https://m.weibo.cn/detail/${source.mid}`}>打开原帖</Outside></div>{quotes.map((e, i) => <blockquote key={i} className="my-2 whitespace-pre-wrap border-l-2 pl-3 leading-7">{e.quote}</blockquote>)}<details className="mt-3 text-sm"><summary className="cursor-pointer">展开核查使用的存档全文</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans leading-7">{source.body}</pre></details><p className="mt-3 text-xs text-muted-foreground">文字观察时间：{when(source.observed_at)}</p></div>; })}</section></div>
    <div className="mt-4 rounded-md bg-muted/50 p-4"><h3 className="text-sm font-semibold">这一处为什么需要看</h3><p className="mt-2 leading-7">{result.explanation}</p><div className="mt-2 flex flex-wrap gap-2">{result.modality === "stronger_in_answer" && <Badge variant="secondary">答案的断言或程度更强</Badge>}{result.attribution === "changed" && <Badge variant="secondary">发言归属有变化</Badge>}</div></div>
    <div className="mt-4 flex flex-wrap gap-5 text-sm"><Outside href={answerUrl}>查看固定答案及挂链位置</Outside><Outside href={originalBoard(data, answer)}>查看对应原榜</Outside><Link className="text-primary underline underline-offset-4" href={`/topic/?id=${encodeURIComponent(answer.topic_id)}`}>回到话题档案</Link></div>
  </CardContent></Card>;
}

type View = "points" | "events" | "accounts" | "versions";
export function PrivateReview() {
  const params = useSearchParams();
  const [data, setData] = useState<ReviewData | null>(null), [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [view, setView] = useState<View>("points"), [query, setQuery] = useState(""), [category, setCategory] = useState("");
  const [topic, setTopic] = useState(params.get("topic") || ""), [limit, setLimit] = useState(20), [sort, setSort] = useState("duration-desc");
  const points = useMemo(() => data ? reviewPoints(data, topic, query, category) : [], [data, topic, query, category]);
  async function unlock(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch(REVIEW_DATA_URL, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error(response.status === 404 ? "核查数据还未发布，请稍后重试。" : "暂时无法读取核查数据，请稍后重试。");
      setData(await decryptReview(await response.json(), passphrase)); setPassphrase("");
    } catch (reason) { setError(reason instanceof TypeError ? "暂时无法连接核查数据，请稍后重试。" : reason instanceof Error ? reason.message : "暂时无法解锁。"); }
    finally { setBusy(false); }
  }
  if (!data) return <div className="page"><PageHeader title="核查" subtitle="解锁后查看具体陈述与原帖的差异、事件归档和版本对读。" /><Card className="mx-auto mt-8 max-w-lg"><CardHeader><CardTitle className="flex items-center gap-2"><LockKeyhole size={20} />解锁核查内容</CardTitle></CardHeader><CardContent><form onSubmit={unlock} className="space-y-4"><label className="block space-y-2 text-sm"><span>核查口令</span><Input type="password" autoComplete="current-password" name="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} required /></label><p className="text-sm leading-6 text-muted-foreground">输入你设置的口令。解锁后的内容只保留在当前页面。</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" disabled={busy}>{busy ? "正在解锁…" : "打开核查点"}</Button></form></CardContent></Card></div>;

  const categories = [...new Set(data.answers.map((answer) => answer.category || "类别未记录"))].sort();
  const allPoints = reviewPoints(data);
  const textMatches = (text: string) => text.toLowerCase().includes(query.toLowerCase());
  const events = Object.values(data.events).map((event) => {
    const ids = Object.keys(data.memberships).filter((id) => data.memberships[id].event_id === event.id);
    const times = ids.flatMap((id) => [data.topics[id]?.first_seen_at, data.topics[id]?.last_seen_at]).filter((value): value is string => !!value).map(Date.parse).filter(Number.isFinite);
    const span = times.length ? (Math.max(...times) - Math.min(...times)) / 3600000 : 0;
    return { event, ids, span, end: times.length ? Math.max(...times) : 0 };
  }).filter(({ event, ids }) => (!topic || ids.includes(topic)) && textMatches(event.title + ids.map((id) => data.topics[id]?.title || "").join(" ")) && (!category || ids.some((id) => (data.topics[id]?.category || "类别未记录") === category)))
    .sort((a, b) => sort === "duration-desc" ? b.span - a.span : sort === "duration-asc" ? a.span - b.span : b.end - a.end);
  const accounts = Object.values(data.accounts).filter((account) => textMatches(`${account.username} ${account.uid} ${field(account.fields.verified_reason)} ${field(account.fields.description)}`));
  const versions = data.versions.filter((pair) => (!topic || pair.topic_id === topic) && textMatches(pair.after.title) && (pair.state === "done" || !pair.body_changed && pair.native_changed));
  const total = view === "points" ? points.length : view === "events" ? events.length : view === "accounts" ? accounts.length : versions.length;
  return <div className="page"><PageHeader title="核查点" subtitle="先看智搜原句，再对照它实际挂链的原帖。这里保留模型判断和对应原文，供你逐条复核。" aside={<Button variant="outline" onClick={() => { setData(null); setError(""); }}>锁定内容</Button>} />
    <p className="mb-4 text-sm text-muted-foreground">更新于 {when(data.summary.updated_at)}（北京时间） · {allPoints.length} 处已完成的差异核查 · {data.summary.answer_observations} 份答案已入库</p>
    <div role="tablist" aria-label="核查内容" className="mb-4 flex flex-wrap gap-2">{([["points", "核查点"], ["events", "事件归档"], ["accounts", "账号属性"], ["versions", "版本对读"]] as const).map(([value, title]) => <Button key={value} role="tab" aria-selected={view === value} variant={view === value ? "default" : "outline"} onClick={() => { setView(value); setLimit(20); }}>{title}</Button>)}</div>
    <div className="mb-5 flex flex-wrap items-center gap-3"><Input className="max-w-sm" aria-label="搜索核查内容" placeholder="搜索话题、句子或账号" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(20); }} />{(view === "points" || view === "events") && <select className="rounded-md border bg-background px-3 py-2 text-sm" aria-label="微博类别" value={category} onChange={(e) => { setCategory(e.target.value); setLimit(20); }}><option value="">全部微博类别</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>}{view === "events" && <select className="rounded-md border bg-background px-3 py-2 text-sm" aria-label="事件排序" value={sort} onChange={(e) => setSort(e.target.value)}><option value="duration-desc">上榜跨度从长到短</option><option value="duration-asc">上榜跨度从短到长</option><option value="recent">最近上榜</option></select>}{topic && <Button variant="outline" onClick={() => setTopic("")}>查看全部话题</Button>}<span className="text-sm text-muted-foreground">共 {total} 条</span></div>
    <div className="space-y-5">{view === "points" && points.slice(0, limit).map(({ answer, point }) => <PointCard key={`${answer.id}-${point.task}`} answer={answer} point={point} data={data} />)}
      {view === "events" && events.slice(0, limit).map(({ event, ids, span }) => <Card key={event.id}><CardHeader><CardTitle>{event.title}</CardTitle><p className="text-sm text-muted-foreground">自动归档 · 首末上榜跨度 {span.toFixed(1)} 小时</p></CardHeader><CardContent className="space-y-3">{ids.map((id) => <p key={id}><Link className="text-primary underline underline-offset-4" href={`/topic/?id=${encodeURIComponent(id)}`}>{data.topics[id]?.title || id}</Link><Badge variant="secondary" className="ml-3">{data.topics[id]?.category || "类别未记录"}</Badge></p>)}</CardContent></Card>)}
      {view === "accounts" && <details className="rounded-md border p-4 text-sm"><summary className="cursor-pointer">账号类别怎么区分</summary><p className="mt-3 leading-7">新闻媒体机构包括媒体及其正式栏目账号；党政司法机关包括机关及其部门账号；企业、高校、医院和社会组织归为其他组织；记者、专家等以本人身份发布的归为个人。身份依据认证说明和简介，徽标颜色单独保存。资料没有明示身份的保留为资料不足。</p></details>}
      {view === "accounts" && accounts.slice(0, limit).map((account) => { const kind = data.account_types[account.uid]; return <Card key={account.uid}><CardHeader><CardTitle>{account.username || account.uid}</CardTitle></CardHeader><CardContent><p className="flex flex-wrap gap-3"><Badge variant="outline">平台徽标：{field(account.fields.badge) || "未取得"}</Badge><Badge variant="secondary">账号身份：{kind ? publisher[kind.publisher_type] : "尚待识别"}</Badge></p><p className="mt-3 leading-7">{field(account.fields.verified_reason) || field(account.fields.description) || "认证说明未取得"}</p>{kind && <p className="mt-2 text-sm">判断依据：{kind.explanation}</p>}<p className="mt-3 text-xs text-muted-foreground">UID {account.uid} · 观察于 {when(account.observed_at)}</p><p className="mt-3 text-sm"><Outside href={`https://weibo.com/u/${account.uid}`}>打开账号原页</Outside></p><details className="mt-3 text-sm"><summary className="cursor-pointer">原始认证字段</summary><pre className="mt-2 whitespace-pre-wrap break-words">{JSON.stringify(account.fields, null, 2)}</pre></details></CardContent></Card>; })}
      {view === "versions" && versions.slice(0, limit).map((pair, index) => <Card key={index}><CardHeader><CardTitle>{pair.after.title}</CardTitle><p className="text-sm text-muted-foreground">{when(pair.before.captured_at)} → {when(pair.after.captured_at)}</p></CardHeader><CardContent><div className="mb-3 flex gap-5 text-sm"><Outside href={pair.before.origin.url}>前版答案</Outside><Outside href={pair.after.origin.url}>后版答案</Outside></div><p className="mb-3 text-sm">匹配 {pair.matches.length} 对陈述；前版未匹配 {pair.unmatched_before.length} 条，后版未匹配 {pair.unmatched_after.length} 条。</p><details className="mb-4 text-sm"><summary className="cursor-pointer">查看正文挂链增删</summary><p className="mt-2">新增：{pair.inline_sources_after.filter((mid) => !pair.inline_sources_before.includes(mid)).join("、") || "无"}</p><p>移除：{pair.inline_sources_before.filter((mid) => !pair.inline_sources_after.includes(mid)).join("、") || "无"}</p></details>{pair.matches.map((match, i) => <details key={i} className="mb-3 rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">{labels[match.relation] || match.relation} · {match.before_text.slice(0, 45)}</summary><div className="mt-3 grid gap-4 text-sm leading-7 md:grid-cols-2"><p><strong>前版</strong><br />{match.before_text}</p><p><strong>后版</strong><br />{match.after_text}</p></div><p className="mt-3 text-sm text-muted-foreground">{match.explanation}</p></details>)}</CardContent></Card>)}
      {!total && <div className="rounded-lg border p-8 leading-7 text-muted-foreground">{view === "points" ? "当前筛选范围内，还没有已完成的差异核查。" : "当前筛选范围内暂无记录。"}{topic && "可以点击“查看全部话题”查看已经完成的核查点。"}</div>}
    </div>{total > limit && <Button className="mt-5" variant="outline" onClick={() => setLimit(limit + 20)}>再显示 20 条</Button>}
    <details className="mt-8 rounded-md border p-4 text-sm text-muted-foreground"><summary className="cursor-pointer">入库与原帖补采进度</summary><p className="mt-3 leading-7">已入库 {data.summary.answer_observations} 份答案；{data.summary.remaining_answer_files} 份排队入库；{data.summary.missing_bodies} 条原帖待补。缺原帖的陈述等待材料，不计为已经发现的内容差异。</p></details>
  </div>;
}
