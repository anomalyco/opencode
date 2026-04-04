import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { dirPath } from "../utils"

test("project route redirects to /session", async ({ page, directory, slug }) => {
  await page.goto(dirPath(directory))
  await page.waitForURL(new RegExp(`/${slug}/session`), { timeout: 30_000 })
  await expect(page.locator(promptSelector)).toBeVisible()
})
