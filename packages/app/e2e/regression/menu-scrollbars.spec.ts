import { expect, test, type Locator, type Page } from "@playwright/test"
import { openPaletteWorkspace, paletteSession } from "../utils/command-palette"
import { openSettings } from "../utils/workspace"

// Headless Chromium hides scrollbars by default, so a native scrollbar would take no width and the contract below
// could not fail.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } })

async function geometry(viewport: Locator, row: Locator) {
  return viewport.evaluate(
    (element: HTMLElement, item) => {
      const box = element.getBoundingClientRect()
      const rect = item!.getBoundingClientRect()

      return {
        overflow: element.scrollHeight > element.clientHeight,
        scrollbar: element.offsetWidth - element.clientWidth,
        start: Math.round(rect.left - box.left),
        end: Math.round(box.right - rect.right),
      }
    },
    await row.elementHandle(),
  )
}

const surfaces = [
  {
    name: "a search list",
    async open(page: Page) {
      await openPaletteWorkspace(page, true, [
        { ...paletteSession, time: { ...paletteSession.time } },
        ...Array.from({ length: 23 }, (_, index) => ({
          ...paletteSession,
          id: `ses_menu_scrollbar_${index}`,
          title: `Overflowing result ${index}`,
          time: { created: 1700000000000 - index - 1, updated: 1700000000000 - index - 1 },
        })),
      ])
      await page.getByRole("banner").getByRole("button", { name: "Search sessions", exact: true }).click()
      const dialog = page.getByRole("dialog")
      await dialog.getByRole("combobox").fill("Overflowing")
      await expect(dialog.getByRole("option")).toHaveCount(23)

      return {
        viewport: dialog.locator('[data-slot="search-list-scroll"]'),
        row: dialog.getByRole("option", { name: /Overflowing result 0/ }),
      }
    },
  },
  {
    name: "a select",
    async open(page: Page) {
      const view = await openSettings(page, { name: "Menu scrollbars" })
      await view.settings.locator('[data-action="settings-language"]').click()
      const listbox = page.getByRole("listbox")
      await expect(listbox.getByRole("option", { name: "English", exact: true })).toBeVisible()

      return {
        viewport: page.locator('[data-slot="select-v2-content"] [data-component="menu-scroll"] > [data-scrollable]'),
        row: listbox.getByRole("option", { name: "English", exact: true }),
      }
    },
  },
]

for (const surface of surfaces) {
  test(`${surface.name} overlays its scrollbar so rows keep equal insets while it overflows`, async ({ page }) => {
    const list = await surface.open(page)

    const overlaid = await geometry(list.viewport, list.row)
    expect(overlaid.overflow).toBe(true)
    expect(overlaid.scrollbar).toBe(0)
    expect(overlaid.end).toBe(overlaid.start)

    // High-contrast modes get the native scrollbar back, which follows the system colours.
    await page.emulateMedia({ forcedColors: "active" })
    await expect.poll(async () => (await geometry(list.viewport, list.row)).scrollbar).toBeGreaterThan(0)
  })
}
