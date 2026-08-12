"use client";

import { usePathname } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

const names: Record<string, string> = { "/": "今日热榜", "/archive/": "历史归档", "/topics/": "话题档案", "/topic/": "话题详情", "/about/": "关于项目" };

export function SiteHeader() {
  const pathname = usePathname();
  const title = names[pathname] || "Weibo Hot Hub";
  return <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
    <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6"><SidebarTrigger className="-ml-1" /><Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" /><span className="text-sm font-medium">{title}</span></div>
  </header>;
}
