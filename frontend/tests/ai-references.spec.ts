import { expect, test } from "@playwright/test";
import type { AiReferenceTrace, TopicSummary } from "../lib/types";

test("reference comparison uses the selected answer versions and reverses percentage-point changes", async ({ page }) => {
  const topic = "231522720a9ba0fab3b46ab7f606b51b58d8cc";
  const dataPath = `/site-data/topics/${topic}`;
  const summary: TopicSummary = await (await page.request.get(`${dataPath}/summary.json`)).json();
  const [newest, previous] = summary.ai_versions;
  await page.route(`**${dataPath}/**`, async (route) => {
    const response = await route.fetch();
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/summary.json")) {
      const json = { ...summary, ai_versions: summary.ai_versions.map((version) => ({ ...version, has_reference_trace: version === newest || version === previous })) };
      await route.fulfill({ response, json });
      return;
    }
    const version = [newest, previous].find((item) => path.endsWith(`/ai/${item.id}.json`));
    if (!version) {
      await route.fulfill({ response });
      return;
    }
    const isNew = version === newest;
    const reference_trace: AiReferenceTrace = {
      captured_at: version.captured_at, source_url: "https://s.weibo.com/aisearch",
      reference_url: "https://s.weibo.com/aisearchmore", reported_count: isNew ? 46 : 41,
      breakdown: [{ label: "金橙V", percent: isNew ? 80 : 83, url: "https://s.weibo.com/aisearchmore" }],
      posts: [{ mid: "11", username: isNew ? "新版作者" : "旧版作者", url: "https://m.weibo.cn/detail/11" }],
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
  const row = breakdown.getByRole("row", { name: /金橙V/ });
  await expect(row.getByRole("cell")).toHaveText(["83%", "80%", "-3 个百分点"]);
  await page.getByRole("button", { name: "交换基准和对照版本" }).click();
  await expect(row.getByRole("cell")).toHaveText(["80%", "83%", "+3 个百分点"]);

  await page.getByRole("tab", { name: "信源追溯" }).click();
  const trace = page.getByRole("region", { name: "信源追溯" });
  await expect(trace.getByRole("link", { name: "新版作者" })).toBeVisible();
  await page.getByRole("combobox", { name: "采集版本" }).click();
  await page.getByRole("option", { name: "2026/08/12 21:39" }).click();
  await expect(trace.getByRole("link", { name: "旧版作者" })).toBeVisible();
});
