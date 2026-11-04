import { expect, story } from "../../stories/playwright/story"

story("separates model capabilities in the Simplified Chinese flyout", async ({ mount, page }) => {
  await mount("app-dialog-model-selector--dialog", { globals: { locale: "zh" } })
  const dialog = page.getByRole("dialog", { name: "选择模型", exact: true })
  await expect(dialog).toBeVisible()
  await page.mouse.move(0, 0)
  await dialog.locator('[data-option-key="openai:gpt-5.6-sol"]').hover()
  const flyout = page.locator('[data-slot="model-dialog-flyout"]')
  await expect(flyout.getByText("Text、Image和Tools", { exact: true })).toBeVisible()
})

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
