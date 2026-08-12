import type { Metadata } from "next";
import { TopicsLibrary } from "@/components/topics-library";

export const metadata: Metadata = { title: "话题档案" };
export default function TopicsPage() { return <TopicsLibrary />; }
