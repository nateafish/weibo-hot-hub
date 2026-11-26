import type { Metadata } from "next";
import { Suspense } from "react";
import { PrivateReview } from "@/components/private-review";

export const metadata: Metadata = { title: "核查", robots: { index: false, follow: false } };
export default function ReviewPage() {
  return <Suspense fallback={<div className="page">正在打开核查页…</div>}><PrivateReview /></Suspense>;
}
