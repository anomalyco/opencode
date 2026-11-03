import { expect, story } from "../../stories/playwright/story"

story("returns focus to a menu trigger without a ring after a pointer open", async ({ mount, page }) => {
  await mount("ui-menu--basic")
  const trigger = page.getByRole("button", { name: "Open menu" })

  await trigger.click()
  await expect(page.getByRole("menuitem", { name: "Save" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveCSS("outline-style", "none")
})

story("keeps the ring on a menu trigger after a keyboard open", async ({ mount, page }) => {
  await mount("ui-menu--basic")
  const trigger = page.getByRole("button", { name: "Open menu" })

  await page.keyboard.press("Shift")
  await trigger.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menuitem", { name: "Save" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveCSS("outline-style", "solid")
})

story("returns focus to a dialog's trigger without a ring after a pointer open", async ({ mount, page }) => {
  await mount("ui-dialog--opened-from-button")
  const trigger = page.getByRole("button", { name: "Choose model" })

  await trigger.click()
  await expect(page.getByText("Alpha and Beta are available.")).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-component="dialog-v2"]')))
    .toBe(true)
  await page.keyboard.press("Escape")
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveCSS("outline-style", "none")
})

story("keeps the ring on a dialog's trigger after a keyboard open", async ({ mount, page }) => {
  await mount("ui-dialog--opened-from-button")
  const trigger = page.getByRole("button", { name: "Choose model" })

  await page.keyboard.press("Shift")
  await trigger.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByText("Alpha and Beta are available.")).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-component="dialog-v2"]')))
    .toBe(true)
  await page.keyboard.press("Escape")
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveCSS("outline-style", "solid")
})

story("keeps queue rings inside controls under the list fade", async ({ mount, page }) => {
  await mount("session-queue-panel--scrolling")
  const list = page.locator('[data-slot="session-queue-list"]')
  const remove = page.locator('[data-action="session-queue-remove"]').first()

  await expect(list).toHaveCSS("scroll-padding-top", "8px")
  await expect(list).toHaveCSS("scroll-padding-bottom", "12px")
  await page.keyboard.press("Shift")
  await remove.focus()
  await expect(remove).toHaveCSS("outline-style", "solid")
  await expect(remove).toHaveCSS("outline-offset", "-2px")
})

story("leaves no ring on the review toggle after a pointer click", async ({ mount, page }) => {
  await mount("app-session-header-actions--review-toggle")
  const toggle = page.getByRole("button", { name: "Toggle review" })

  await toggle.click()
  // A later key press makes Chromium ring whatever still holds focus, so the click must not leave it there.
  await page.keyboard.press("Shift")
  expect(await toggle.evaluate((element) => element.matches(":focus-visible"))).toBe(false)
  await expect(toggle).toHaveCSS("outline-style", "none")
})
