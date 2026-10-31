import { expect, story } from "../../stories/playwright/story"

story("a subagent session shows its model where the composer would be", async ({ mount, page }) => {
  await mount("app-current-session-surface--child-session")

  const bar = page.locator('[data-component="subagent-bar"]')
  // The variant follows the model name, dimmer and without a separator, like the message metadata.
  const model = bar.locator('[data-slot="subagent-model"]')
  await expect(model).toHaveText("Anthropic / Claude Opus 5.5 high")
  await expect(model.getByText("high", { exact: true })).toHaveCSS("opacity", "0.66")
  await expect(page.locator('[data-component="composer"]')).toHaveCount(0)

  // A status line, not a second composer card.
  await expect(bar).toHaveCSS("border-top-left-radius", "0px")
  await expect(bar).toHaveCSS("height", "32px")

  await bar.getByRole("button", { name: /main session/i }).click()
  await expect(page.getByText("Opened the parent Session locally")).toBeVisible()
})

story("a subagent with no recorded outcome starts its line at the agent", async ({ mount, page }) => {
  await mount("app-current-session-surface--child-session-no-outcome")

  const bar = page.locator('[data-component="subagent-bar"]')
  await expect(bar.locator('[data-slot="subagent-model"]')).toBeVisible()
  // No empty status icon box, and no separator before the first item.
  await expect(bar.locator(":scope > span")).toHaveCount(0)
  await expect(bar).toHaveText(/^surveyor·Anthropic/)
})

story("a subagent status line fits a phone-width viewport", async ({ mount, page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await mount("app-current-session-surface--child-session-done")

  const bar = page.locator('[data-component="subagent-bar"]')
  const overlap = await bar.evaluate((el) => {
    const text = el.querySelector(":scope > div.flex-1")!
    const button = el.querySelector("button")!
    const contentRight = Math.max(...[...text.querySelectorAll("span")].map((span) => span.getBoundingClientRect().right))
    return contentRight - button.getBoundingClientRect().left
  })

  expect(overlap).toBeLessThanOrEqual(0)
  await expect(bar.locator('[data-slot="subagent-model"]')).toBeVisible()
  await expect(bar.getByText("Anthropic", { exact: true })).toBeHidden()
})
