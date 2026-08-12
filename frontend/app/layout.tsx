import type { Metadata } from "next";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Weibo Hot Hub", template: "%s · Weibo Hot Hub" },
  description: "微博热搜小时级数据档案：热度趋势、榜单正文与微博智搜增量存档。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" suppressHydrationWarning><body><SidebarProvider style={{ "--sidebar-width": "calc(var(--spacing) * 72)", "--header-height": "calc(var(--spacing) * 12)" } as React.CSSProperties}><AppSidebar variant="inset" /><SidebarInset><SiteHeader /><div className="flex flex-1 flex-col"><div className="@container/main flex flex-1 flex-col gap-2">{children}</div></div></SidebarInset></SidebarProvider></body></html>;
}
