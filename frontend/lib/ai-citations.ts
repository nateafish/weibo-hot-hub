import type { Definition, Nodes } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface CitationPlacement {
  section: string;
  paragraph: number;
  kind: "text" | "media" | "heading";
  context: string;
  position: string;
  offset?: number;
}

export interface CitationSource {
  url: string;
  name?: string;
  placements: CitationPlacement[];
  inSourceList: boolean;
}

export type CitationStatus = "added" | "removed" | "moved" | "references" | "retained";

export interface CitationChange {
  key: string;
  source: CitationSource;
  before?: CitationSource;
  after?: CitationSource;
  beforeChanged: CitationPlacement[];
  afterChanged: CitationPlacement[];
  statuses: CitationStatus[];
}

const markdownParser = unified().use(remarkParse).use(remarkGfm);

function plainText(node: Nodes, omitLinks = false): string {
  if (node.type === "link" || node.type === "linkReference") {
    if (omitLinks) return "";
  }
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  if ("children" in node) return node.children.map((child) => plainText(child, omitLinks)).join("");
  return "value" in node ? node.value : "";
}

function normalizedText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sourceKey(url: URL): string {
  const post = /^\/(?:detail|status(?:\/detail)?)\/([\da-z]+)\/?$/i.exec(url.pathname);
  if (url.hostname === "m.weibo.cn" && post) return `weibo:${post[1]}`;
  return url.href;
}

function sourceUrl(href: string): URL | undefined {
  if (!/^(https?:)?\/\//i.test(href)) return;
  try {
    return new URL(href.startsWith("//") ? `https:${href}` : href);
  } catch {
    return;
  }
}

export function citationKey(href: string): string | undefined {
  const url = sourceUrl(href);
  return url && sourceKey(url);
}

function collectLinks(node: Nodes, definitions: Map<string, Definition>, addLink: (url: string, label: string, offset?: number) => void) {
  const offset = node.position?.start.offset;
  if (node.type === "link") addLink(node.url, plainText(node), offset);
  if (node.type === "linkReference") {
    const definition = definitions.get(node.identifier);
    if (definition) addLink(definition.url, plainText(node), offset);
  }
  if ("children" in node) {
    for (const child of node.children) collectLinks(child, definitions, addLink);
  }
}

export function extractCitationSources(markdown: string): Map<string, CitationSource> {
  const { children } = markdownParser.parse(markdown);
  const sources = new Map<string, CitationSource>();
  const definitions = new Map<string, Definition>();
  for (const node of children) {
    if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
  }

  // The exporter appends a terminal level-two heading and a list of bare URLs.
  const contentNodes = children.filter((node) => node.type !== "definition");
  const listHeading = contentNodes.at(-2);
  const footerStart = listHeading?.position?.end.offset;
  let footerLinks: string[] = [];
  if (listHeading?.type === "heading" && listHeading.depth === 2 && plainText(listHeading).trim() === "信源" &&
    contentNodes.at(-1)?.type === "list" && footerStart !== undefined) {
    const lines = markdown.slice(footerStart).trim().split(/\r?\n/).filter((line) => line.trim());
    // Read the archived destinations directly because Markdown autolinks can truncate spaces and punctuation.
    if (lines.every((line) => /^- https?:\/\//i.test(line))) footerLinks = lines.map((line) => line.slice(2).trim());
  }

  function addSource(href: string, label: string, placement?: CitationPlacement) {
    const url = sourceUrl(href);
    if (!url) return;
    const key = sourceKey(url);
    const source = sources.get(key) ?? { url: url.href, placements: [], inSourceList: false };
    const name = normalizedText(label);
    if (!source.name && name && name !== href && !/^(?:(?:https?:)?\/\/|\d+$|微博来源$|微博素材$)/i.test(name)) source.name = name;
    if (placement) source.placements.push(placement);
    else source.inSourceList = true;
    sources.set(key, source);
  }

  const headings: Array<{ depth: number; title: string; key: string }> = [];
  const headingCounts = new Map<string, number>();
  let sectionKey = "";
  let paragraph = 0;

  function visit(node: Nodes) {
    if (node.type === "heading") {
      const title = normalizedText(plainText(node));
      while (headings.length && headings[headings.length - 1].depth >= node.depth) headings.pop();
      const key = title.replace(/^[\d一二三四五六七八九十]+[、.．]\s*/, "");
      headings.push({ depth: node.depth, title, key });
      const path = JSON.stringify(headings.map((heading) => heading.key));
      const count = (headingCounts.get(path) ?? 0) + 1;
      headingCounts.set(path, count);
      sectionKey = `${path}:${count}`;
      paragraph = 0;
    }

    if (node.type === "paragraph" || node.type === "tableCell" || node.type === "heading") {
      const context = normalizedText(plainText(node, true));
      const section = headings.map((heading) => heading.title).join(" / ") || "开头";
      if (node.type !== "heading") paragraph += 1;
      const kind = node.type === "heading" ? "heading" : /^[\s·•、，,|／/]*$/.test(context) ? "media" : "text";
      const placement: CitationPlacement = {
        section,
        paragraph,
        context: kind === "media" ? "" : context,
        kind,
        position: JSON.stringify([sectionKey, paragraph, kind]),
      };
      collectLinks(node, definitions, (url, label, offset) => addSource(url, label, { ...placement, offset }));
    } else if ("children" in node) {
      for (const child of node.children) visit(child);
    }
  }

  for (const node of footerLinks.length ? contentNodes.slice(0, -2) : contentNodes) visit(node);
  for (const url of footerLinks) addSource(url, "");
  return sources;
}

function unmatchedPlacements(placements: CitationPlacement[], counterpart: CitationPlacement[]): CitationPlacement[] {
  const unmatched = new Map<string, number>();
  for (const placement of counterpart) {
    unmatched.set(placement.position, (unmatched.get(placement.position) ?? 0) + 1);
  }
  return placements.filter((placement) => {
    const remaining = unmatched.get(placement.position) ?? 0;
    if (!remaining) return true;
    unmatched.set(placement.position, remaining - 1);
    return false;
  });
}

export function compareCitationSources(before: Map<string, CitationSource>, after: Map<string, CitationSource>): CitationChange[] {
  const changes: CitationChange[] = [];
  for (const [key, source] of after) {
    const previous = before.get(key);
    const beforeChanged = previous ? unmatchedPlacements(previous.placements, source.placements) : [];
    const afterChanged = unmatchedPlacements(source.placements, previous?.placements ?? []);
    const statuses: CitationStatus[] = [];
    if (!previous) statuses.push("added");
    else {
      if (beforeChanged.length && afterChanged.length) statuses.push("moved");
      if (previous.placements.length !== source.placements.length || previous.inSourceList !== source.inSourceList) {
        statuses.push("references");
      }
    }
    changes.push({ key, source, before: previous, after: source, beforeChanged, afterChanged, statuses: statuses.length ? statuses : ["retained"] });
  }
  for (const [key, source] of before) {
    if (!after.has(key)) changes.push({ key, source, before: source, beforeChanged: source.placements, afterChanged: [], statuses: ["removed"] });
  }
  return changes;
}
