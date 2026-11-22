import { expect, test } from "@playwright/test";
import type { ArchiveEvent } from "../lib/event-archive";

test("home hotlist opens preview and full topic archive", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "今日微博热搜" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "最新一小时" })).toBeVisible();
  const archivedRow = page.locator("tbody tr").filter({ hasText: "已有档案" }).first();
  await archivedRow.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("link", { name: /查看完整档案/ }).click();
  await expect(page).toHaveURL(/\/topic\/\?id=/);
  await expect(page.getByRole("tab", { name: "趋势" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "正文" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "智搜" })).toBeVisible();
});

test("archive preserves original ranking", async ({ page }) => {
  await page.goto("/archive/");
  await expect(page.getByRole("heading", { name: "历史归档" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^\d{2}:00$/ }).first()).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
});

test("event filters and event links work on the exported page", async ({ page }) => {
  const id = "Ec91140c3e34856";
  const month = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/event-data/2026-11.json"));
  await page.goto(`events/?month=2026-11&id=${id}`);
  const { events } = await (await month).json() as { events: ArchiveEvent[] };
  const event = events.find((item) => item.id === id)!;
  const links = event.members.reduce((count, member) =>
    count + new Set(member.appearances.map(({ hour }) => hour)).size, 0);
  await expect(page.locator("[data-slot='card-title']")).toHaveText(event.title);
  await expect(page.getByRole("heading", { name: "事件始末" })).toHaveCount(0);
  const timeline = page.getByRole("table");
  await expect(timeline.locator("tbody tr")).toHaveCount(event.members.length);
  await expect(timeline.locator("tbody td a")).toHaveCount(links);
  expect(await timeline.locator("tbody td").count()).toBeLessThanOrEqual(links * 2 + event.members.length);
  expect(await timeline.evaluate((element) => {
    const table = element as HTMLTableElement;
    const columnCount = table.tHead?.rows[0].cells.length;
    return Array.from(table.tBodies[0].rows, (row) =>
      Array.from(row.cells).reduce((count, cell) => count + cell.colSpan, 0),
    ).every((width) => width === columnCount);
  })).toBe(true);
  await page.route(/\/events\/(?:index|__next\.[^/]+)\.txt\b/, (route) => route.abort());

  await page.getByRole("combobox", { name: "微博分类" }).selectOption("all");
  await expect(page).toHaveURL(/category=all/);
  await page.getByRole("textbox", { name: "搜索事件" }).fill("地面停飞");
  await page.locator('a[href*="id=Ebcae683281cf07"]').click();
  await expect(page).toHaveURL(/id=Ebcae683281cf07/);
  await expect(page.locator("[data-slot='card-title']")).toHaveText("美全国范围实施地面停飞");

  await page.getByRole("textbox", { name: "搜索事件" }).clear();
  await page.getByRole("combobox", { name: "归档月份" }).selectOption("2026-10");
  await expect(page.getByText(/至 2026-10-30 16:00/)).toBeVisible();
  await page.getByRole("combobox", { name: "排序" }).selectOption("duration-desc");
  await expect(page).toHaveURL(/month=2026-10&category=all&sort=duration-desc/);
});

test("topic archive scrolls and searches across the full index", async ({ page }) => {
  await page.goto("topics/");
  const cards = page.locator(".topic-grid [data-slot='card']");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeLessThan(200);
  const firstTitle = await cards.first().locator("[data-slot='card-title']").innerText();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
  await expect(cards.first().locator("[data-slot='card-title']")).not.toHaveText(firstTitle);
  expect(await cards.count()).toBeLessThan(200);

  await page.getByPlaceholder("搜索标题、主持人或分类").fill("黄仁勋承认出轨");
  await page.getByText("黄仁勋承认出轨", { exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "黄仁勋承认出轨" })).toBeVisible();
});

test("topic archive combines date, hours and category filters with search", async ({ page }) => {
  function archivedTopic(id: string, title: string, category: string | null, lastSeen: string | null, hours: number) {
    return { topic_id: id, title, category, last_seen_at: lastSeen, hours_seen: hours, has_posts: false, has_ai: false };
  }
  await page.route("**/site-data/topics/index.json", (route) => route.fulfill({ json: [
    archivedTopic("end", "苹果话题甲", "社会", "2026-11-22T15:59:59.999Z", 2),
    archivedTopic("start", "梨话题", "社会", "2026-11-22T00:00:00+08:00", 4),
    archivedTopic("tomorrow", "苹果话题乙", "社会", "2026-11-22T16:00:00Z", 3),
    archivedTopic("short", "苹果话题丙", "社会", "2026-11-22T12:00:00+08:00", 1),
    archivedTopic("long", "苹果话题丁", "社会", "2026-11-22T12:00:00+08:00", 5),
    archivedTopic("other", "苹果话题戊", "综艺-内地综艺", "2026-11-22T12:00:00+08:00", 3),
    archivedTopic("unclassified", "苹果话题己", null, "2026-11-22T12:00:00+08:00", 3),
    archivedTopic("undated", "苹果话题庚", "社会", null, 3),
  ] }));
  await page.goto("/topics/");
  const status = page.getByRole("status").filter({ hasText: "个话题" });
  const filterButton = page.getByRole("button", { name: /^筛选/ });
  const filters = page.getByRole("dialog", { name: "筛选话题" });
  const search = page.getByPlaceholder("搜索标题、主持人或分类");
  const cards = page.locator(".topic-grid [data-slot='card-title']");
  await expect(status).toHaveText("8 个话题");

  await filterButton.click();
  await filters.getByLabel("开始日期").fill("2026-11-22");
  await filters.getByLabel("结束日期").fill("2026-11-22");
  await filters.getByLabel("最少小时数").fill("5");
  await filters.getByLabel("最多小时数").fill("4");
  const apply = filters.getByRole("button", { name: "应用筛选" });
  await expect(apply).toBeDisabled();
  await expect(filters.getByRole("alert")).toHaveText("最少小时数不能大于最多小时数。");
  await filters.getByLabel("最少小时数").fill("2");
  await filters.getByRole("combobox", { name: "话题分类" }).click();
  await page.getByRole("option", { name: "社会", exact: true }).click();
  await expect(status).toHaveText("8 个话题");
  await apply.click();
  await expect(filters).toBeHidden();
  await expect(status).toHaveText("2 / 8 个话题");
  await expect(cards).toHaveText(["苹果话题甲", "梨话题"]);
  await expect(filterButton).toHaveAccessibleName("筛选，已应用 3 项条件");

  await search.fill("苹果");
  await expect(status).toHaveText("1 / 8 个话题");
  await expect(cards).toHaveText(["苹果话题甲"]);
  await filterButton.click();
  await expect(filters.getByLabel("最少小时数")).toHaveValue("2");
  await filters.getByRole("button", { name: "清除筛选" }).click();
  await expect(status).toHaveText("7 / 8 个话题");
  await search.clear();
  await expect(status).toHaveText("8 个话题");

  await filterButton.click();
  await filters.getByRole("combobox", { name: "话题分类" }).click();
  await page.getByRole("option", { name: "未分类", exact: true }).click();
  await apply.click();
  await expect(cards).toHaveText(["苹果话题己"]);
});

test("mobile navigation exposes all four pages", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only assertion");
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect(page.getByRole("link", { name: "历史归档" })).toBeVisible();
  await expect(page.getByRole("link", { name: "话题档案" })).toBeVisible();
  await expect(page.getByRole("link", { name: "关于项目" })).toBeVisible();
});

test("AI archive renders markdown and HTTPS sources", async ({ page }) => {
  await page.goto("/topic/?id=231522720a9ba0fab3b46ab7f606b51b58d8cc");
  await page.getByRole("tab", { name: "智搜" }).click();
  await page.getByRole("combobox", { name: "采集版本" }).click();
  await page.getByRole("option", { name: "2026/08/12 21:39" }).click();
  await expect(page.getByRole("heading", { name: /核心数据创历史新低/ })).toBeVisible();
  const source = page.getByRole("link", { name: "https://m.weibo.cn/detail/5331088060977776" });
  await expect(source).toHaveAttribute("href", "https://m.weibo.cn/detail/5331088060977776");
});
