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

story("keeps a menu trigger's tooltip hidden when the menu closes under a still pointer", async ({ mount, page }) => {
  const root = await mount("ui-tooltip--with-menu")
  await page.clock.install()
  const trigger = root.getByRole("button", { name: "Actions" })
  const tooltip = page.getByRole("tooltip", { name: "More actions" })
  await trigger.hover()
  await expect(tooltip).toBeVisible()
  await trigger.click()
  await expect(page.getByRole("menu")).toBeVisible()
  await expect(tooltip).toBeHidden()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toBeHidden()
  await expect(trigger).toBeFocused()
  // The menu's closing layer hands the still pointer a fresh pointerenter, which would open the tooltip 400 ms later.
  await page.clock.runFor(1000)
  await expect(tooltip).toBeHidden()
  await page.mouse.move(0, 0)
  await trigger.hover()
  await expect(tooltip).toBeVisible()
})

story("opens a menu trigger's tooltip on the next hover after the menu closes", async ({ mount, page }) => {
  const root = await mount("ui-tooltip--with-menu")
  const trigger = root.getByRole("button", { name: "Actions" })
  const tooltip = page.getByRole("tooltip", { name: "More actions" })
  await trigger.hover()
  await expect(tooltip).toBeVisible()
  await trigger.click()
  await expect(page.getByRole("menu")).toBeVisible()
  await page.mouse.move(0, 0)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toBeHidden()
  await expect(trigger).toBeFocused()
  await trigger.hover()
  await expect(tooltip).toBeVisible()
})
