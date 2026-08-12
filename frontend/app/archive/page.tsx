import type { Metadata } from "next";
import { ArchiveBrowser } from "@/components/archive-browser";

export const metadata: Metadata = { title: "历史归档" };
export default function ArchivePage() { return <ArchiveBrowser />; }
