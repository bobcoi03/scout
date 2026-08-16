import { expect, test } from "@playwright/test";

test("renders the simple Scout landing page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /A curated feed of launches, startups & side projects from X/ })).toBeVisible();
  await expect(page.getByText("Stop doomscrolling.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the feed" })).toHaveAttribute("href", "/product");
});

test("removed operational routes no longer exist", async ({ page }) => {
  for (const path of ["/feed", "/admin"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
});
