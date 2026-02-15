import { test, expect } from "@playwright/test"

test("basic test", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveTitle(/OpenCode/)
})
