import { expect, story } from "../../stories/playwright/story"

story("a subagent session shows its model where the composer would be", async ({ mount, page }) => {
  await mount("app-current-session-surface--child-session")

  const bar = page.locator('[data-component="subagent-bar"]')
  await expect(bar.locator('[data-slot="subagent-model"]')).toHaveText("Anthropic / Claude Opus 5.5")
  await expect(bar).toContainText(/high/i)
  await expect(page.locator('[data-component="composer"]')).toHaveCount(0)

  // A status line, not a second composer card.
  await expect(bar).toHaveCSS("border-top-left-radius", "0px")
  await expect(bar).toHaveCSS("height", "32px")

  await bar.getByRole("button", { name: /main session/i }).click()
  await expect(page.getByText("Opened the parent Session locally")).toBeVisible()
})
