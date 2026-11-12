import type { Metadata } from "next";
import { Suspense } from "react";
import { EventArchive } from "@/components/event-archive";

export const metadata: Metadata = { title: "事件档案" };

export default function EventsPage() {
  return (
    <Suspense fallback={<div className="page"><div className="loading-block h-96" /></div>}>
      <EventArchive />
    </Suspense>
  );
}
