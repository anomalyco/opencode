import { expect, test } from "@playwright/test"
import { captureConsoleWarnings, openCommandPalette } from "../utils/command-palette"

test.use({ serviceWorkers: "block", video: "off" })

test("opening and closing files does not duplicate tab commands", async ({ page }) => {
  const warnings = captureConsoleWarnings(page)
  const palette = await openCommandPalette(page)
  await page.route("**/api/fs/find?*", (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: { data: [{ path: "fixture.txt", type: "file" }] },
    }),
  )
  await palette.input.fill("fixture.txt")
  await palette.dialog.getByRole("option", { name: /fixture\.txt/ }).click()
  const file = page.getByRole("tab", { name: /fixture\.txt/ })
  await expect(file).toBeVisible()
  await expect(palette.dialog).toHaveCount(0)
  await page
    .getByRole("complementary", { name: "Review and files" })
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  await expect(file).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Palette fixture session", exact: true })).toBeVisible()
  expect(warnings).toEqual([])
})

test("navigation replaces commands without retaining disposed owners", async ({ page }) => {
  const warnings = captureConsoleWarnings(page)
  const palette = await openCommandPalette(page, true)
  await palette.input.press("Escape")
  await expect(palette.dialog).toHaveCount(0)
  await page
    .getByRole("region", { name: "Recent sessions" })
    .getByRole("button", { name: /Palette fixture session/ })
    .click()
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  await page.keyboard.press("ControlOrMeta+t")
  await expect(page).toHaveURL(/\/new-session\?/)
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  await page.locator('[data-component="composer-editor"]').blur()
  await page.keyboard.press("Control+l")
  await expect(page.locator('[data-component="composer-editor"]')).toBeFocused()
  await page.keyboard.press("ControlOrMeta+Shift+P")
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("textbox")).toBeFocused()
  await expect(dialog.getByRole("textbox")).toHaveAttribute("placeholder", "Search files, commands, and sessions")
  await dialog.getByRole("textbox").fill("copy session")
  await expect(dialog.getByRole("option", { name: "Copy Session ID", exact: true })).toHaveCount(0)
  await dialog.getByRole("textbox").press("Escape")
  await expect(dialog).toHaveCount(0)
  await page.locator("[data-titlebar-tab-link]").filter({ hasText: "Palette fixture session" }).click()
  await expect(page.getByRole("heading", { name: "Palette fixture session", exact: true })).toBeVisible()
  for (const count of [3, 4]) {
    await page.getByRole("button", { name: "New session", exact: true }).click()
    await expect(page.locator("[data-titlebar-tab-link]")).toHaveCount(count)
    await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  }
  await page.setViewportSize({ width: 600, height: 800 })
  await page.locator('[data-slot="mobile-tabs-trigger"]').click()
  await expect(page.locator('[data-slot="mobile-tabs-drawer"] [data-titlebar-tab-link]')).toHaveCount(4)
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator('[data-slot="titlebar-tabs"] [data-titlebar-tab-link]')).toHaveCount(4)
  await page.keyboard.press("ControlOrMeta+w")
  await expect(page.locator("[data-titlebar-tab-link]")).toHaveCount(3)
  await page.locator("[data-titlebar-tab-link]").filter({ hasText: "Palette fixture session" }).click()
  await expect(page.getByRole("heading", { name: "Palette fixture session", exact: true })).toBeVisible()
  await page.keyboard.press("ControlOrMeta+Shift+P")
  await expect(dialog.getByRole("textbox")).toBeFocused()
  await dialog.getByRole("textbox").fill("copy session")
  await expect(dialog.getByRole("option", { name: "Copy Session ID", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  expect(warnings).toEqual([])
})
