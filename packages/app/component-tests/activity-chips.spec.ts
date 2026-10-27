import { expect, story } from "../../stories/playwright/story"

story("shows how long each background item has been running, ticking while open", async ({ mount, page }) => {
  // Time moves only when the test advances it, so waiting for fonts cannot add a tick.
  await page.clock.install({ time: new Date("2026-10-19T12:00:00Z") })
  await page.clock.pauseAt(new Date("2026-10-19T12:00:00Z"))
  await mount("session-activity-chips--subagents-and-shells")

  await page.locator('[data-slot="session-activity-chip"]').click()
  const elapsed = page.locator('[data-slot="session-activity-panel"] [data-slot="session-activity-elapsed"]')

  // The story starts its subagents 12 s and 65 s ago, and its shells 62 min and 341 s ago.
  await expect(elapsed).toHaveText(["12s", "1m 05s", "1h 02m", "5m 41s"])
  // A late Inter swap widens the panel; measure after fonts settle.
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const width = await page.locator('[data-slot="session-activity-panel"]').evaluate((node) => node.clientWidth)

  await page.clock.runFor(1_000)
  await expect(elapsed).toHaveText(["13s", "1m 06s", "1h 02m", "5m 42s"])
  expect(await page.locator('[data-slot="session-activity-panel"]').evaluate((node) => node.clientWidth)).toBe(width)
})
