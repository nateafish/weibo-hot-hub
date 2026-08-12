import { describe, expect, it } from "vitest";
import { filterHotlist, formatNumber, sortByHeat } from "./format";
import type { HotlistEntry } from "./types";

const items: HotlistEntry[] = [
  { title: "置顶", query: "置顶", url: "#", heat: null, original_rank: 1 },
  { title: "热榜", query: "热榜", url: "#", heat: 1234, original_rank: 2, label: "热" },
];

describe("hotlist helpers", () => {
  it("sorts unknown heat last", () => expect(sortByHeat(items)[0].title).toBe("热榜"));
  it("filters by label and heat", () => expect(filterHotlist(items, "", "热", 1000)).toHaveLength(1));
  it("formats heat for Chinese display", () => expect(formatNumber(1234)).toBe("1,234"));
});
