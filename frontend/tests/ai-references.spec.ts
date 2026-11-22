import { expect, test } from "@playwright/test";
import type { AiReferenceTrace, TopicSummary } from "../lib/types";

test("reference comparison shows post counts and splits share changes for the selected versions", async ({ page }) => {
  const topic = "231522720a9ba0fab3b46ab7f606b51b58d8cc";
  const dataPath = `/site-data/topics/${topic}`;
  const summary: TopicSummary = await (await page.request.get(`${dataPath}/summary.json`)).json();
  const newest = summary.ai_versions[0];
  const oldest = summary.ai_versions[summary.ai_versions.length - 1];
  let includeAllPosts = true;
  await page.route(`**${dataPath}/**`, async (route) => {
    const response = await route.fetch();
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/summary.json")) {
      const json = { ...summary, ai_versions: summary.ai_versions.map((version) => ({ ...version, has_reference_trace: version === newest || version === oldest })) };
      await route.fulfill({ response, json });
      return;
    }
    const version = [newest, oldest].find((item) => path.endsWith(`/ai/${item.id}.json`));
    if (!version) {
      await route.fulfill({ response });
      return;
    }
    const isNew = version === newest;
    const categories = [
      { label: "金橙V", count: isNew ? 60 : 30, percent: isNew ? 69 : 45 },
      { label: "认证用户", count: isNew ? 14 : 7, percent: isNew ? 16 : 10 },
      { label: "普通用户", count: isNew ? 2 : 4, percent: isNew ? 2 : 6 },
      { label: "媒体", count: isNew ? 11 : 26, percent: isNew ? 13 : 39 },
    ];
    const posts = categories.flatMap(({ label, count }, group) => Array.from({ length: count }, (_, index) => {
      const mid = String(group * 100 + index + 1);
      const username = mid === "1" ? (isNew ? "新版作者" : "旧版作者") : undefined;
      return { mid, username, category: label, url: `https://m.weibo.cn/detail/${mid}` };
    }));
    const reference_trace: AiReferenceTrace = {
      captured_at: version.captured_at, source_url: "https://s.weibo.com/aisearch",
      reference_url: "https://s.weibo.com/aisearchmore", reported_count: posts.length,
      breakdown: categories.map(({ label, percent }) => ({ label, percent, url: "https://s.weibo.com/aisearchmore" })),
      posts: includeAllPosts ? posts : posts.slice(0, 1),
    };
    const thinking = isNew ? { thinking_markdown: "先核对时间，再核对引文。" } : {};
    await route.fulfill({ response, json: { ...(await response.json()), reference_trace, ...thinking } });
  });

  await page.goto(`/topic/?id=${topic}`);
  await page.getByRole("tab", { name: "智搜" }).click();
  const thinking = page.getByText("先核对时间，再核对引文。", { exact: true });
  await expect(page.getByText("深度思考", { exact: true })).toBeVisible();
  await expect(thinking).toBeHidden();
  await page.getByText("深度思考", { exact: true }).click();
  await expect(thinking).toBeVisible();
  await page.getByRole("tab", { name: "信源对比" }).click();
  const breakdown = page.getByRole("region", { name: "信源账号占比变化" });
  const media = breakdown.getByRole("row", { name: /媒体/ });
  const cells = media.getByRole("cell");
  await expect(breakdown.getByRole("row", { name: /引用博文/ }).getByRole("cell")).toHaveText(["67 篇", "87 篇", "+20 篇"]);
  await expect(cells.nth(0).locator("span")).toHaveText(["26 篇", "38.81%"]);
  await expect(cells.nth(1).locator("span")).toHaveText(["11 篇", "12.64%"]);
  await expect(cells.nth(2).locator(":scope > span")).toHaveText(["-15 篇", "-26.16 个百分点"]);
  await expect(cells.nth(2).locator("dd")).toHaveText(["-19.81 个百分点", "-6.35 个百分点"]);
  await page.getByRole("button", { name: "交换基准和对照版本" }).click();
  await expect(cells.nth(2).locator(":scope > span")).toHaveText(["+15 篇", "+26.16 个百分点"]);
  await expect(cells.nth(2).locator("dd")).toHaveText(["+19.81 个百分点", "+6.35 个百分点"]);

  await page.getByRole("tab", { name: "信源追溯" }).click();
  const trace = page.getByRole("region", { name: "信源追溯" });
  await expect(trace.getByRole("link", { name: "新版作者" })).toBeVisible();
  await page.getByRole("combobox", { name: "采集版本" }).click();
  await page.getByRole("option", { name: "2026/08/12 21:00" }).click();
  await expect(trace.getByRole("link", { name: "旧版作者" })).toBeVisible();

  includeAllPosts = false;
  await page.reload();
  await page.getByRole("tab", { name: "智搜" }).click();
  await page.getByRole("tab", { name: "信源对比" }).click();
  await expect(cells).toHaveText(["39%", "13%", "-26 个百分点"]);
  await expect(breakdown.getByText("分类明细不全的版本仅显示归档占比。")).toBeVisible();
});
