import type { Metadata } from "next";
import { AboutContent } from "@/components/about-content";

export const metadata: Metadata = { title: "关于项目" };
export default function AboutPage() { return <AboutContent />; }
