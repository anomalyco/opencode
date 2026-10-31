import { expect, story } from "../../stories/playwright/story"

story("opens a neighbouring tooltip without the open delay", async ({ mount, page }) => {
  const root = await mount("ui-tooltip--appearances")
  await root.getByText("Standard", { exact: true }).hover()
  await expect(page.getByRole("tooltip", { name: "Standard tooltip" })).toBeVisible()
  // With timers frozen, the next tooltip can only open through the skip-delay window that closing this one starts.
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") })
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"))
  await root.getByText("Compact", { exact: true }).hover()
  await expect(page.getByRole("tooltip", { name: "Compact tooltip" })).toBeVisible()
})
