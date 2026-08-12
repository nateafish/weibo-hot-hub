import { expect, test } from "@playwright/test";

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
  await expect(page.getByRole("heading", { name: /核心数据创历史新低/ })).toBeVisible();
  const source = page.getByRole("link", { name: "https://m.weibo.cn/detail/5331088060977776" });
  await expect(source).toHaveAttribute("href", "https://m.weibo.cn/detail/5331088060977776");
});
