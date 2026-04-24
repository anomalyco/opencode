import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { projectPath } from "../utils"

test("project route redirects to /session", async ({ page, directory, slug }) => {
  await page.goto(projectPath(directory))

  await expect(page).toHaveURL(new RegExp(`/${slug}/session`))
  await expect(page.locator(promptSelector)).toBeVisible()
})
