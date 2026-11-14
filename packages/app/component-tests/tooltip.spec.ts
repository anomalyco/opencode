import { expect, story } from "../../stories/playwright/story"

story.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") })
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"))
})

story("cancels a pending hover on click and opens again on re-entry", async ({ mount, page }) => {
  const root = await mount("ui-tooltip--with-button")

  const trigger = root.getByRole("button", { name: "Add" })

  const tooltip = page.getByRole("tooltip", { name: "Add one to the count" })

  await trigger.hover()
  await page.clock.runFor(300)
  await trigger.click()
  await expect(root.getByRole("status")).toHaveText("Count: 1")
  await expect(tooltip).toBeHidden()
  await page.clock.runFor(600)
  await expect(tooltip).toBeHidden()

  await page.mouse.move(0, 0)
  await trigger.hover()
  await page.clock.runFor(600)
  await expect(tooltip).toBeVisible()
})

story("dismisses an open tooltip on pointerdown before the button activates", async ({ mount, page }) => {
  const root = await mount("ui-tooltip--with-button")

  const tooltip = page.getByRole("tooltip", { name: "Add one to the count" })

  await root.getByRole("button", { name: "Add" }).hover()
  await page.clock.runFor(600)
  await expect(tooltip).toBeVisible()
  await page.mouse.down()
  await expect(tooltip).toBeHidden()
  await expect(root.getByRole("status")).toHaveText("Count: 0")
  await page.mouse.up()
  await expect(root.getByRole("status")).toHaveText("Count: 1")
  await page.clock.runFor(600)
  await expect(tooltip).toBeHidden()
})

story("shows the wrapped button's tooltip on Tab and Shift+Tab, even after a click", async ({ mount, page }) => {
  const root = await mount("ui-tooltip--with-button")

  const trigger = root.getByRole("button", { name: "Add" })

  const tooltip = page.getByRole("tooltip", { name: "Add one to the count" })

  await page.keyboard.press("Tab")
  await expect(trigger).toBeFocused()
  await expect(tooltip).toBeVisible()

  await trigger.click()
  await expect(tooltip).toBeHidden()
  await page.keyboard.press("Tab")
  await expect(root.getByRole("button", { name: "Reset" })).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await expect(trigger).toBeFocused()
  await expect(tooltip).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(tooltip).toBeHidden()
  await expect(trigger).toBeFocused()
})

story("restored focus does not open a tooltip after Tab leaves the window", async ({ mount, page }) => {
  const root = await mount("ui-tooltip--with-button")

  await page.keyboard.down("Tab")
  await expect(root.getByRole("button", { name: "Add" })).toBeFocused()
  // The page loses focus before receiving Tab's keyup.
  await page.evaluate(() => window.dispatchEvent(new FocusEvent("blur")))
  await root.getByRole("button", { name: "Reset" }).focus()
  await expect(page.getByRole("tooltip", { name: "Reset the count" })).toBeHidden()
  await page.keyboard.up("Tab")
})

story.describe("touch", () => {
  story.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  story("tapping the button preserves the tooltip's hover state", async ({ mount, page }) => {
    const root = await mount("ui-tooltip--with-button")

    const trigger = root.getByRole("button", { name: "Add" })

    const tooltip = page.getByRole("tooltip", { name: "Add one to the count" })

    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true)
    await trigger.tap()
    await expect(root.getByRole("status")).toHaveText("Count: 1")
    await expect(tooltip).toBeHidden()
    await page.clock.runFor(600)
    await expect(tooltip).toBeHidden()

    await trigger.hover()
    await page.clock.runFor(600)
    await expect(tooltip).toBeVisible()
    await trigger.tap()
    await expect(root.getByRole("status")).toHaveText("Count: 2")
    await expect(tooltip).toBeVisible()
  })
})

story("waits 600 ms on first hover and opens a neighbouring tooltip immediately", async ({ mount, page }) => {
  const root = await mount("ui-tooltip--appearances")

  const tooltip = page.getByRole("tooltip", { name: "Standard tooltip" })

  await root.getByText("Standard", { exact: true }).hover()
  await page.clock.runFor(599)
  await expect(tooltip).toBeHidden()
  await page.clock.runFor(1)
  await expect(tooltip).toBeVisible()
  // With timers frozen, the next tooltip can only open through the skip-delay window that closing this one starts.
  await root.getByText("Compact", { exact: true }).hover()
  await expect(page.getByRole("tooltip", { name: "Compact tooltip" })).toBeVisible()
})

story("keeps a menu trigger's tooltip hidden when the menu closes under a still pointer", async ({ mount, page }) => {
  const root = await mount("ui-tooltip--with-menu")

  const trigger = root.getByRole("button", { name: "Actions" })

  const tooltip = page.getByRole("tooltip", { name: "More actions" })

  await trigger.hover()
  await page.clock.runFor(600)
  await expect(tooltip).toBeVisible()
  await trigger.click()
  await expect(page.getByRole("menu")).toBeVisible()
  await expect(tooltip).toBeHidden()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toBeHidden()
  // The menu restores focus in a zero-delay task after unmounting.
  await page.clock.runFor(0)
  await expect(trigger).toBeFocused()
  // The menu's closing layer can hand the still pointer a fresh pointerenter.
  await page.clock.runFor(600)
  await expect(tooltip).toBeHidden()
  await page.mouse.move(0, 0)
  await trigger.hover()
  await page.clock.runFor(600)
  await expect(tooltip).toBeVisible()
})

story("opens a menu trigger's tooltip on the next hover after the menu closes", async ({ mount, page }) => {
  const root = await mount("ui-tooltip--with-menu")

  const trigger = root.getByRole("button", { name: "Actions" })

  const tooltip = page.getByRole("tooltip", { name: "More actions" })

  await trigger.hover()
  await page.clock.runFor(600)
  await expect(tooltip).toBeVisible()
  await trigger.click()
  await expect(page.getByRole("menu")).toBeVisible()
  await page.mouse.move(0, 0)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toBeHidden()
  await page.clock.runFor(0)
  await expect(trigger).toBeFocused()
  await trigger.hover()
  await page.clock.runFor(600)
  await expect(tooltip).toBeVisible()
})
