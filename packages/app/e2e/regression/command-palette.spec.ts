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

test("keeps the automatically selected file when session results arrive later", async ({ page }) => {
  const { dialog, input } = await openCommandPalette(page)
  const sessions = Promise.withResolvers<void>()
  await page.route("**/api/fs/find?*", (route) =>
    route.fulfill({ json: { data: [{ path: "README.md", type: "file" }] } }),
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
  await expect(file).toHaveAttribute("aria-selected", "true")
  sessions.resolve()
  await expect(dialog.getByRole("option", { name: /README work/ })).toBeVisible()
  await expect(file).toHaveAttribute("aria-selected", "true")
  await input.press("Enter")
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole("tab", { name: "README.md", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: paletteSession.title, exact: true })).toBeVisible()
})
