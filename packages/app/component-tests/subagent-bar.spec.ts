import { expect, story } from "../../stories/playwright/story"

story("a subagent session shows its model where the composer would be", async ({ mount, page }) => {
  await mount("app-current-session-surface--child-session")

  const bar = page.locator('[data-component="subagent-bar"]')
  await expect(bar.locator('[data-slot="subagent-model"]')).toHaveText("Anthropic / Claude Opus 5.5")
  await expect(bar).toContainText(/high/i)
  await expect(page.locator('[data-component="composer"]')).toHaveCount(0)
})
