"use client";

import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import type { DailyEntry, HotlistEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

type Row = HotlistEntry | DailyEntry;

export function HotlistTable({ entries, daily = false, preserveRank = false, onSelect }: {
  entries: Row[];
  daily?: boolean;
  preserveRank?: boolean;
  onSelect: (entry: Row) => void;
}) {
  const columns = useMemo<ColumnDef<Row>[]>(() => [
    {
      id: "rank",
      header: "排名",
      cell: ({ row }) => {
        const rank = preserveRank ? row.original.original_rank : row.index + 1;
        return <span className={cn("inline-flex size-7 items-center justify-center rounded-md text-xs font-medium tabular-nums", rank <= 3 ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{rank}</span>;
      },
    },
    {
      accessorKey: "title",
      header: "话题",
      cell: ({ row }) => <div><div className="max-w-[32rem] font-medium leading-5">{row.original.title}</div><div className="mt-0.5 text-xs text-muted-foreground">{row.original.topic_id ? "已有档案" : "仅原榜链接"}</div></div>,
    },
    {
      id: "heat",
      header: daily ? "最高热度" : "热度",
      cell: ({ row }) => <span className="font-medium tabular-nums">{formatNumber(daily ? (row.original as DailyEntry).peak_heat : row.original.heat)}</span>,
    },
    {
      id: "originalRank",
      header: daily ? "最佳名次" : "原榜名次",
      cell: ({ row }) => daily ? (row.original as DailyEntry).best_rank : row.original.original_rank,
      meta: { className: "hidden md:table-cell" },
    },
    {
      id: "label",
      header: daily ? "出现小时" : "标记",
      cell: ({ row }) => daily ? `${(row.original as DailyEntry).hours_seen} 小时` : row.original.label ? <Badge variant="outline">{row.original.label}</Badge> : "—",
      meta: { className: "hidden md:table-cell" },
    },
    {
      id: "link",
      header: () => <span className="sr-only">链接</span>,
      cell: ({ row }) => <Button asChild variant="ghost" size="icon" className="size-8"><a href={row.original.url} target="_blank" rel="noreferrer" aria-label={`在微博打开${row.original.title}`} onClick={(event) => event.stopPropagation()}><ExternalLink /></a></Button>,
    },
  ], [daily, preserveRank]);
  const table = useReactTable({ data: entries, columns, getCoreRowModel: getCoreRowModel() });

  if (!entries.length) return <Empty className="min-h-56 border"><EmptyHeader><EmptyTitle>没有符合条件的话题</EmptyTitle><EmptyDescription>请调整搜索或筛选条件。</EmptyDescription></EmptyHeader></Empty>;
  return <Card className="overflow-hidden py-0 shadow-sm"><Table><TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id} className="hover:bg-transparent">{group.headers.map((header) => <TableHead key={header.id} className={cn(header.column.id === "rank" && "w-16 pl-4", header.column.id === "link" && "w-12", (header.column.columnDef.meta as { className?: string } | undefined)?.className)}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}</TableHeader><TableBody>{table.getRowModel().rows.map((row) => <TableRow key={row.id} className={cn(row.original.topic_id && "cursor-pointer")} onClick={() => row.original.topic_id && onSelect(row.original)}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id} className={cn(cell.column.id === "rank" && "pl-4", (cell.column.columnDef.meta as { className?: string } | undefined)?.className)}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>)}</TableBody></Table></Card>;
}
