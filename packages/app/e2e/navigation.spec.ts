import { test, expect } from "./fixtures"
import { dirPath, promptSelector } from "./utils"

test("project route redirects to /session", async ({ page, directory, slug }) => {
  await page.goto(dirPath(directory))

  await expect(page).toHaveURL(new RegExp(`/${slug}/session`))
  await expect(page.locator(promptSelector)).toBeVisible()
})
