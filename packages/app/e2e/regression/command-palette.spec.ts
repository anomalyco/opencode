import { expect, test } from "@playwright/test"
import { captureConsoleWarnings, openCommandPalette, paletteSession } from "../utils/command-palette"

test.use({ serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write"] })

test("copies the session ID while file and session searches are still pending", async ({ page }) => {
  const warnings = captureConsoleWarnings(page)
  const { dialog, input } = await openCommandPalette(page)
  const release = Promise.withResolvers<void>()
  await page.route(/\/api\/(session\?|fs\/find\?)/, async (route) => {
    await release.promise
    await route.fallback()
  })
  await input.pressSequentially("copy session")
  const copy = dialog.getByRole("option", { name: "Copy Session ID", exact: true })
  await expect(copy).toHaveAttribute("aria-selected", "true")
  await input.press("Enter")
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(paletteSession.id)
  await expect(page.locator('[data-testid^="toast-v2-"] [data-slot="icon-svg"]')).toBeVisible()
  expect(warnings).toEqual([])
  release.resolve()
})

test("home commands do not wait for session search", async ({ page }) => {
  const { dialog, input } = await openCommandPalette(page, true)
  const release = Promise.withResolvers<void>()
  await page.route("**/api/session?*", async (route) => {
    await release.promise
    await route.fallback()
  })
  await input.fill("open settings")
  await expect(dialog.getByRole("option")).toHaveCount(1)
  await expect(dialog.getByRole("option", { name: /^Open settings/ })).toHaveAttribute("aria-selected", "true")
  await input.press("Enter")
  await expect(page).toHaveURL("/settings")
  await expect(page.getByTestId("settings-screen").getByRole("tab", { name: "Preferences", exact: true })).toBeVisible()
  release.resolve()
})

test("lists recent sessions before a query is entered", async ({ page }) => {
  const { dialog } = await openCommandPalette(page, true)
  const session = dialog.getByRole("option", { name: /Palette fixture session/ })
  await expect(dialog.getByText("Recent sessions", { exact: true })).toBeVisible()
  await expect(session).toHaveAttribute("aria-selected", "false")
  await session.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole("heading", { name: paletteSession.title, exact: true })).toBeVisible()
})

test("appends search results without resetting the selected command", async ({ page }) => {
  const { dialog, input } = await openCommandPalette(page)
  const files = Promise.withResolvers<void>()
  const sessions = Promise.withResolvers<void>()
  await page.route("**/api/fs/find?*", async (route) => {
    await files.promise
    await route.fulfill({ json: { data: [{ path: "copy.txt", type: "file" }] } })
  })
  await page.route("**/api/session?*", async (route) => {
    await sessions.promise
    await route.fulfill({
      json: {
        data: [{ ...paletteSession, location: { directory: paletteSession.directory }, title: "Copy fixture" }],
      },
    })
  })
  await input.fill("copy")
  const project = dialog.getByRole("option", { name: "Copy Project ID", exact: true })
  await expect(project).toBeVisible()
  // Select a non-first command with the keyboard before remote results arrive.
  await input.press("ArrowDown")
  await expect(project).toHaveAttribute("aria-selected", "true")
  files.resolve()
  await expect(dialog.getByRole("option", { name: "/ copy.txt", exact: true })).toBeVisible()
  await expect(project).toHaveAttribute("aria-selected", "true")
  // File results are usable even while sessions are still pending.
  sessions.resolve()
  await expect(dialog.getByRole("option", { name: /Copy fixture/ })).toBeVisible()
  await expect(project).toHaveAttribute("aria-selected", "true")
  await input.fill("copy session")
  await expect(dialog.getByRole("option", { name: "Copy Session ID", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(dialog.getByRole("option", { name: "Copy Project ID", exact: true })).toHaveCount(0)
})

test("selects the first session when it arrives above automatically selected files", async ({ page }) => {
  const { dialog, input } = await openCommandPalette(page)
  const sessions = Promise.withResolvers<void>()
  await page.route("**/api/fs/find?*", (route) =>
    route.fulfill({ json: { data: [{ path: "README.md", type: "file" }] } }),
  )
  await page.route("**/api/session?*", async (route) => {
    await sessions.promise
    await route.fulfill({
      json: {
        data: Array.from({ length: 18 }, (_, index) => ({
          ...paletteSession,
          id: index === 0 ? paletteSession.id : `ses_palette_readme_${index}`,
          location: { directory: paletteSession.directory },
          title: `README work ${index + 1}`,
        })),
      },
    })
  })
  await input.fill("README")
  await expect(dialog.getByRole("option", { name: "/ README.md", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  sessions.resolve()
  const first = dialog.getByRole("option", { name: /README work 1 command-palette/ })
  const second = dialog.getByRole("option", { name: /README work 2 command-palette/ })
  await expect(first).toHaveAttribute("aria-selected", "true")
  await expect(first).toBeInViewport()
  await input.press("ArrowDown")
  await expect(second).toHaveAttribute("aria-selected", "true")
  await expect(second).toBeInViewport()
  await input.press("ArrowUp")
  await expect(first).toHaveAttribute("aria-selected", "true")
  await input.press("Enter")
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole("heading", { name: paletteSession.title, exact: true })).toBeVisible()
})

test("keeps a keyboard-selected file when session results arrive later", async ({ page }) => {
  const warnings = captureConsoleWarnings(page)
  const { dialog, input } = await openCommandPalette(page)
  const sessions = Promise.withResolvers<void>()
  await page.route("**/api/fs/find?*", (route) =>
    route.fulfill({ json: { data: [{ path: "README.txt", type: "file" }, { path: "README.md", type: "file" }] } }),
  )
  await page.route("**/api/session?*", async (route) => {
    await sessions.promise
    await route.fulfill({
      json: {
        data: [{ ...paletteSession, location: { directory: paletteSession.directory }, title: "README work" }],
      },
    })
  })
  await input.fill("README")
  const file = dialog.getByRole("option", { name: "/ README.md", exact: true })
  await expect(dialog.getByRole("option", { name: "/ README.txt", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await input.press("ArrowDown")
  await expect(file).toHaveAttribute("aria-selected", "true")
  sessions.resolve()
  await expect(dialog.getByRole("option", { name: /README work/ })).toBeVisible()
  await expect(file).toHaveAttribute("aria-selected", "true")
  await input.press("Enter")
  await expect(dialog).toHaveCount(0)
  const tab = page.getByRole("tab", { name: "README.md", exact: true })
  await expect(tab).toBeVisible()
  await expect(page.getByRole("heading", { name: paletteSession.title, exact: true })).toBeVisible()
  await page
    .getByRole("complementary", { name: "Review and files" })
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  await expect(tab).toHaveCount(0)
  await expect(page.getByRole("heading", { name: paletteSession.title, exact: true })).toBeVisible()
  // The duplicate command ID warning is DEV-only, so only dev-server runs can catch duplicate tab commands here.
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
  const editor = page.locator('[data-component="composer-editor"]')
  await expect(editor).toBeEditable()
  await page.keyboard.press("ControlOrMeta+t")
  await expect(page).toHaveURL(/\/new-session\?/)
  await expect(editor).toBeEditable()
  await editor.blur()
  await page.keyboard.press("Control+l")
  await expect(editor).toBeFocused()
  await page.keyboard.press("ControlOrMeta+Shift+P")
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("textbox")).toBeFocused()
  await expect(dialog.getByRole("textbox")).toHaveAttribute("placeholder", "Search files, commands, and sessions")
  await dialog.getByRole("textbox").fill("copy session")
  await expect(dialog.getByRole("option", { name: "Copy Session ID", exact: true })).toHaveCount(0)
  await dialog.getByRole("textbox").press("Escape")
  await expect(dialog).toHaveCount(0)
  const tabs = page.locator("[data-titlebar-tab-link]")
  await tabs.filter({ hasText: paletteSession.title }).click()
  await expect(page.getByRole("heading", { name: paletteSession.title, exact: true })).toBeVisible()

  for (const count of [3, 4]) {
    await page.getByRole("button", { name: "New session", exact: true }).click()
    await expect(tabs).toHaveCount(count)
    await expect(editor).toBeEditable()
  }

  await page.setViewportSize({ width: 600, height: 800 })
  await page.locator('[data-slot="mobile-tabs-trigger"]').click()
  await expect(page.locator('[data-slot="mobile-tabs-drawer"] [data-titlebar-tab-link]')).toHaveCount(4)
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator('[data-slot="titlebar-tabs"] [data-titlebar-tab-link]')).toHaveCount(4)
  const active = new URL(page.url())
  const closing = page.locator(`[data-titlebar-tab-link][href="${active.pathname}${active.search}"]`)
  await expect(closing).toHaveCount(1)
  await page.keyboard.press("ControlOrMeta+w")
  await expect(tabs).toHaveCount(3)
  await expect(closing).toHaveCount(0)
  await expect(tabs.filter({ hasText: paletteSession.title })).toHaveCount(1)
  await tabs.filter({ hasText: paletteSession.title }).click()
  await expect(page.getByRole("heading", { name: paletteSession.title, exact: true })).toBeVisible()
  await page.keyboard.press("ControlOrMeta+Shift+P")
  await expect(dialog.getByRole("textbox")).toBeFocused()
  await dialog.getByRole("textbox").fill("copy session")
  await expect(dialog.getByRole("option", { name: "Copy Session ID", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  expect(warnings).toEqual([])
})
