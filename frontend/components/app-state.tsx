import { FileQuestion, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return <Empty className="min-h-48 border"><EmptyHeader><EmptyMedia variant="icon"><FileQuestion /></EmptyMedia><EmptyTitle>{title}</EmptyTitle>{description && <EmptyDescription>{description}</EmptyDescription>}</EmptyHeader></Empty>;
}

export function ErrorState({ message }: { message: string }) {
  return <Empty className="min-h-32 border border-destructive/30 bg-destructive/5"><EmptyHeader><EmptyMedia variant="icon" className="text-destructive"><TriangleAlert /></EmptyMedia><EmptyTitle className="text-base text-destructive">加载失败</EmptyTitle><EmptyDescription>{message}</EmptyDescription></EmptyHeader></Empty>;
}

export function MetricCard({ label, value }: { label: string; value: string }) {
  return <Card className="gap-2 py-4 shadow-none"><CardHeader className="px-4"><CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle></CardHeader><CardContent className="px-4 text-2xl font-semibold tracking-tight tabular-nums">{value}</CardContent></Card>;
}
