import type { Metadata } from "next";
import { Suspense } from "react";
import { TopicDetailView } from "@/components/topic-detail-view";

export const metadata: Metadata = { title: "话题详情" };
export default function TopicPage() { return <Suspense fallback={<div className="page"><div className="loading-block h-96" /></div>}><TopicDetailView /></Suspense>; }
