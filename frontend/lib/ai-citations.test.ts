import { describe, expect, it } from "vitest";
import { compareCitationSources, extractCitationSources } from "./ai-citations";

const post = (id: number) => `https://m.weibo.cn/detail/${id}`;
const sourceList = (...ids: number[]) => `## 信源\n\n${ids.map((id) => `- ${post(id)}`).join("\n")}`;

describe("AI citation comparison", () => {
  it("distinguishes removal, a moved link, and a link that remains in the source list", () => {
    const before = extractCitationSources(`### 一、现场\n\n原说法 [甲](${post(11)}) [乙](${post(22)}) [丁](${post(44)})\n\n${sourceList(11, 22, 33, 44, 55)}`);
    const after = extractCitationSources(`### 一、处置\n\n新说法 [改名](https://m.weibo.cn/status/11?from=feed) [丙](${post(66)})\n\n${sourceList(55, 33, 44, 66)}\n- https://m.weibo.cn/status/detail/11?utm_source=star`);
    const changes = new Map(compareCitationSources(before, after).map((change) => [change.key, change]));

    expect(changes.get("weibo:11")).toMatchObject({
      statuses: ["moved"],
      before: { placements: [{ section: "一、现场", context: "原说法" }] },
      after: { placements: [{ section: "一、处置", context: "新说法" }] },
    });
    expect(changes.get("weibo:22")?.statuses).toEqual(["removed"]);
    expect(changes.get("weibo:33")?.statuses).toEqual(["retained"]);
    expect(changes.get("weibo:44")).toMatchObject({
      statuses: ["references"],
      after: { placements: [], inSourceList: true },
    });
    expect(changes.get("weibo:66")?.statuses).toEqual(["added"]);
  });

  it("tracks repeated references and recognizes link-only material outside the source list", () => {
    const before = extractCitationSources(`### 一、事件\n\n说法 [甲][source] [甲][source]\n\n[source]: ${post(11)}`);
    const after = extractCitationSources(`### 二、事件\n\n[甲](${post(11)})\n\n${sourceList(11)}`);
    const [change] = compareCitationSources(before, after);

    expect(change.statuses).toEqual(["moved", "references"]);
    expect(change.before?.placements).toHaveLength(2);
    expect(change.after).toMatchObject({ placements: [{ kind: "media" }], inSourceList: true });
  });

  it("preserves a bare URL with spaces in the archived source list", () => {
    const sources = extractCitationSources(`正文\n\n${sourceList(11)}\n- https://example.com/iPhone 17 Pro`);

    expect(sources.get("weibo:11")).toMatchObject({ placements: [], inSourceList: true });
    expect(sources.get("https://example.com/iPhone%2017%20Pro")).toMatchObject({ placements: [], inSourceList: true });
  });
});
