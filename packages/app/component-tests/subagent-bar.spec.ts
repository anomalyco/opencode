import { expect, story } from "../../stories/playwright/story"

story("a subagent session names the subagent and its task where the composer would be", async ({ mount, page }) => {
  await mount("app-current-session-surface--child-session")

  const bar = page.locator('[data-component="subagent-bar"]')
  await expect(bar).toContainText("Surveyor subagent")
  await expect(bar.locator('[data-slot="subagent-title"]')).toHaveText("Trace why the sidebar flickers on resize")
  await expect(bar).not.toContainText("Claude Opus 5.5")
  await expect(page.locator('[data-component="composer"]')).toHaveCount(0)
})
