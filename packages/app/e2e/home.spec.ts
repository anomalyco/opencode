import { test, expect } from "@playwright/test"

test("home shows recent projects header", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Recent projects")).toBeVisible()
})
