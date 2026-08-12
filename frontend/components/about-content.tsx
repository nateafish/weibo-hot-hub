"use client";

import { ExternalLink, Github } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { loadManifest } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import type { SiteManifest } from "@/lib/types";

export function AboutContent() {
  const [manifest, setManifest] = useState<SiteManifest | null>(null);
  useEffect(() => { loadManifest().then(setManifest).catch(() => undefined); }, []);
  const valid = manifest?.cookie.status === "valid";
  return <div className="page"><PageHeader title="关于项目" subtitle="一个由 GitHub Actions 自动维护的微博热搜小时级、去重数据档案。" />
    <div className="about-grid"><Card className="about-card shadow-sm"><h2>保存了什么</h2><p>每小时保存微博热搜榜，并为可解析的话题关联数据总览、1 小时与 24 小时趋势、热搜记录、贡献者排行、搜索正文以及有变化的微博智搜结果。</p><h2 className="!mt-6">使用边界</h2><ul><li>公开页面仅用于研究与存档，不代表微博官方观点。</li><li>正文、用户名及链接来自公开页面，权利归原作者与微博所有。</li><li>部分话题可能没有热度、正文、趋势或智搜内容，页面会保留明确空状态。</li></ul></Card>
      <aside className="space-y-4"><Card className="about-card shadow-sm"><h2>运行状态</h2><div className="status-pill"><span className={`status-dot ${valid ? "valid" : ""}`} />微博 Cookie {valid ? "有效" : "已失效"}</div><p className="mt-3">最近检测：{formatDateTime(manifest?.cookie.checked_at)}<br />当前归档：{manifest?.available_dates.length || 0} 天，{manifest?.topic_count || 0} 个话题。</p></Card><Card className="about-card shadow-sm"><h2>项目入口</h2><div className="flex flex-wrap gap-2"><Button asChild><a href="https://github.com/nateafish/weibo-hot-hub" target="_blank" rel="noreferrer"><Github size={15} />GitHub</a></Button><Button asChild variant="outline"><a href="https://s.weibo.com/top/summary" target="_blank" rel="noreferrer">微博热搜<ExternalLink size={14} /></a></Button></div></Card></aside>
    </div>
  </div>;
}
