"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Archive, Flame, Github, Info, Library, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const links = [
  { href: "/", label: "今日热榜", icon: Flame },
  { href: "/archive/", label: "历史归档", icon: Archive },
  { href: "/topics/", label: "话题档案", icon: Library },
  { href: "/about/", label: "关于项目", icon: Info },
];

function ThemeButton() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  useEffect(() => setTheme((localStorage.getItem("weibo-hot-theme") as typeof theme) || "system"), []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      localStorage.setItem("weibo-hot-theme", theme);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const Icon = theme === "system" ? Monitor : theme === "light" ? Sun : Moon;
  const label = theme === "system" ? "跟随系统" : theme === "light" ? "浅色" : "深色";
  return <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => setTheme(next)} aria-label={`当前${label}，切换主题`}><Icon /></Button></TooltipTrigger><TooltipContent side="right">主题：{label}</TooltipContent></Tooltip>;
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  return <Sidebar collapsible="offcanvas" {...props}>
    <SidebarHeader>
      <SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild size="lg">
        <Link href="/"><span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"><Flame className="size-4" /></span><span className="grid flex-1 text-left text-sm leading-tight"><span className="truncate font-semibold">Weibo Hot Hub</span><span className="truncate text-xs">微博热搜档案</span></span></Link>
      </SidebarMenuButton></SidebarMenuItem></SidebarMenu>
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>数据浏览</SidebarGroupLabel>
        <SidebarGroupContent><SidebarMenu>{links.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return <SidebarMenuItem key={href}><SidebarMenuButton asChild isActive={active} tooltip={label}><Link href={href}><Icon /><span>{label}</span></Link></SidebarMenuButton></SidebarMenuItem>;
        })}</SidebarMenu></SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter>
      <SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild tooltip="GitHub"><a href="https://github.com/nateafish/weibo-hot-hub" target="_blank" rel="noreferrer"><Github /><span>GitHub</span></a></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
      <div className="flex justify-end group-data-[collapsible=icon]:justify-center"><ThemeButton /></div>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>;
}
