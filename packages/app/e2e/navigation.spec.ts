import { test, expect } from "@playwright/test"
import { dirPath, dirSlug, getWorktree, promptSelector } from "./utils"

test("project route redirects to /session", async ({ page }) => {
  const directory = await getWorktree()
  const slug = dirSlug(directory)

  await page.goto(dirPath(directory))
  await expect(page).toHaveURL(new RegExp(`/${slug}/session`))
  await expect(page.locator(promptSelector)).toBeVisible()
})
