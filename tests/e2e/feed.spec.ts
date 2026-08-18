import { expect, test } from "@playwright/test";

test("renders the simple Scout landing page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /A curated feed of launches, startups & side projects from X/ })).toBeVisible();
  await expect(page.getByText(/Stop doomscrolling.*Index Ventures/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the feed" })).toHaveAttribute("href", "/product");
});

test("removed operational routes no longer exist", async ({ page }) => {
  for (const path of ["/feed", "/admin"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
});

test("themes use a routed, cross-filterable analytics workspace", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/product");
  await expect(page.getByRole("link", { name: "Themes" })).toHaveAttribute("href", "/product/theme");
  await page.goto("/product/theme");

  await expect(page).toHaveURL(/\/product\/theme$/);
  await expect(page.getByTestId("intelligence-theme-workbench")).toBeVisible();
  await expect(page.getByRole("img", { name: "Launches by theme and week" })).toBeVisible();

  await page.getByPlaceholder("Filter by builder").fill("Claude");
  await page.getByRole("button", { name: /Claude.*signals/i }).first().click();
  await expect(page.getByLabel("Selected builders")).toContainText("Claude");

  await page.getByRole("button", { name: "Conviction", exact: true }).click();
  await expect(page.getByRole("img", { name: "Conviction by theme and week" })).toBeVisible();
});
