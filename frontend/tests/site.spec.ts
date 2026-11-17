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
