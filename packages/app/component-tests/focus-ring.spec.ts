import { expect, story } from "../../stories/playwright/story"

story("shows rings for keyboard navigation and operation only", async ({ mount, page }) => {
  await mount("ui-button--icon")
  const normal = page.getByRole("button", { name: "Normal", exact: true })
  const large = page.getByRole("button", { name: "Large", exact: true })

  // Typing and lone modifiers are not navigation, so focus the app moves afterwards shows no ring.
  await page.keyboard.press("a")
  await page.keyboard.press("Shift")
  await normal.focus()
  await expect(normal).toHaveCSS("outline-style", "none")

  // A key that moves focus is, and focus the app moves keeps the ring while the keyboard is in use.
  await page.keyboard.press("Tab")
  await expect(large).toBeFocused()
  await expect(large).toHaveCSS("outline-style", "solid")
  await normal.focus()
  await expect(normal).toHaveCSS("outline-style", "solid")

  // A pointer press ends it. Operating the clicked control from the keyboard brings it back.
  await large.click()
  await expect(large).toHaveCSS("outline-style", "none")
  await page.keyboard.press("Space")
  await expect(large).toHaveCSS("outline-style", "solid")
})

story("returns focus to a menu trigger without a ring after a pointer open", async ({ mount, page }) => {
  await mount("ui-menu--basic")
  const trigger = page.getByRole("button", { name: "Open menu" })

  await trigger.click()
  await expect(page.getByRole("menuitem", { name: "Save" })).toBeVisible()
  // The menu takes focus a task after it opens; an Escape before that rings the trigger, which still holds focus.
  await expect(page.getByRole("menu")).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveCSS("outline-style", "none")
})

story("keeps the ring on a menu trigger after a keyboard open", async ({ mount, page }) => {
  await mount("ui-menu--basic")
  const trigger = page.getByRole("button", { name: "Open menu" })

  await trigger.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menuitem", { name: "Save" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveCSS("outline-style", "solid")
})

story("leaves no ring on a menu trigger that code opens after pointer use", async ({ mount, page }) => {
  await mount("ui-menu--programmatic-and-non-modal")
  const trigger = page.getByRole("button", { name: "Controlled" })

  await trigger.click()
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menuitem", { name: "Rename" })).toHaveCount(0)
  await page.getByRole("button", { name: "Open from code" }).click()
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveCSS("outline-style", "none")
})

story("leaves focus where an outside click put it when a non-modal menu closes", async ({ mount, page }) => {
  await mount("ui-menu--programmatic-and-non-modal")
  const trigger = page.getByRole("button", { name: "Non-modal" })

  await trigger.click()
  await expect(page.getByRole("menuitem", { name: "Pin" })).toBeVisible()
  // Kobalte starts listening for outside presses a task after the menu opens, queued behind the one that focuses it.
  await expect(page.getByRole("menu")).toBeFocused()
  await page.mouse.click(4, 300)
  await expect(page.getByRole("menuitem", { name: "Pin" })).toHaveCount(0)
  // The close focus restore has run once the story counts it; the click on empty space left focus on the body.
  await expect(page.getByLabel("Non-modal focus restores")).toHaveText("1")
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
  await expect(trigger).not.toBeFocused()
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
  // Tab starts keyboard navigation, so the ring shows on the control focused next.
  await page.keyboard.press("Tab")
  await remove.focus()
  await expect(remove).toHaveCSS("outline-style", "solid")
  await expect(remove).toHaveCSS("outline-offset", "-2px")
})
