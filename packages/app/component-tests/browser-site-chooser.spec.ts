import type { Page } from "@playwright/test"
import { expect, sourceURL, story } from "../../stories/playwright/story"

// What the fixture's faked browser profile answers; see `SiteScenario` in the fixture.
type SiteScenario = { sites: number | "locked"; hold?: boolean; partial?: boolean; query?: string }

const source = (path: string) => sourceURL(new URL(path, import.meta.url))

const modules = {
  fixture: source("../../gui-plugins/src/browser/site-chooser.fixture.tsx"),
  ui: source("../src/runtime/plugin/ui.tsx"),
}

// Any story loads the app styles; the fixture opens the real import dialog in the real dialog host beside it.
async function open(page: Page, scenario: SiteScenario, direction: "ltr" | "rtl" = "ltr") {
  await page.evaluate(
    async (input) => {
      const [{ mountSiteChooser }, { ui }] = await Promise.all([import(input.modules.fixture), import(input.modules.ui)])

      mountSiteChooser({ ui, scenario: input.scenario, direction: input.direction })
    },
    { modules, scenario, direction },
  )

  const dialog = page.getByRole("dialog", { name: "Choose sites to import" })

  return {
    dialog,
    list: dialog.getByRole("listbox", { name: "Sites" }),
    options: dialog.getByRole("option"),
    search: dialog.getByRole("searchbox", { name: "Search sites" }),
    importButton: dialog.getByRole("button", { name: "Import", exact: true }),
    // The dialog is modal, so the record beside it is hidden from the accessibility tree.
    record: page.getByTestId("site-chooser-imports"),
  }
}

story.beforeEach(async ({ mount }) => {
  await mount("ui-line-comment--editor")
})

story("lists 5,000 sites in a window of rows, as one keyboard stop with roving focus", async ({ page }) => {
  const view = await open(page, { sites: 5_000 })

  await expect(view.options.first()).toHaveAttribute("data-site", "github.com")
  await expect(view.list).toHaveAttribute("aria-multiselectable", "true")
  await expect(view.options.first()).toHaveAttribute("aria-setsize", "5000")
  await expect(view.dialog.getByText("0 of 5000 selected · Most recently used first")).toBeVisible()
  expect(await view.options.count()).toBeLessThan(45)
  await expect(view.importButton).toBeDisabled()

  // Tab goes from the search, past the profile and the selection's one enabled action, to the list, then out of it.
  await expect(view.search).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(view.dialog.getByRole("button", { name: /Browser profile/ })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(view.dialog.getByRole("button", { name: "Select all" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(view.list).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(view.dialog.getByRole("button", { name: "Cancel" })).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await expect(view.list).toBeFocused()

  // Down moves, Space toggles, End goes to the last site, and type-ahead jumps to the next site that starts so.
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Space")
  await expect(view.dialog.getByRole("option", { name: /linear\.app/ })).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("End")
  await expect(view.list).toHaveAttribute("aria-activedescendant", /site-4999\.example\.co\.uk$/)
  await expect(view.dialog.locator('[data-site="site-4999.example.co.uk"]')).toBeVisible()
  expect(await view.options.count()).toBeLessThan(45)
  await page.keyboard.press("Home")
  await page.keyboard.type("fig")
  await expect(view.list).toHaveAttribute("aria-activedescendant", /figma\.com$/)
  await page.keyboard.press("Space")
  await expect(view.dialog.getByText("2 of 5000 selected · Most recently used first")).toBeVisible()

  // Enter imports what is selected; a clean import closes the dialog.
  await page.keyboard.press("Enter")
  await expect(view.record.locator("li")).toHaveText([JSON.stringify({ source: "chrome", profile: "Default", sites: ["linear.app", "figma.com"] })])
  await expect(view.record).toHaveAttribute("data-closed", "true")
  await expect(view.record).toHaveAttribute("data-imported", "1")
})

story("says what Select acts on while a search is active, and only offers what would change something", async ({ page }) => {
  const view = await open(page, { sites: 5_000 })

  await view.search.fill("site-01")
  await expect(view.dialog.getByText("100 shown, 0 selected · Most recently used first")).toBeVisible()
  await view.dialog.getByRole("button", { name: "Select 100 shown", exact: true }).click()
  await expect(view.dialog.getByRole("button", { name: "Deselect 100 shown", exact: true })).toBeEnabled()
  await expect(view.dialog.getByRole("button", { name: "Select 100 shown", exact: true })).toBeDisabled()
  await view.search.fill("github")
  await expect(view.options).toHaveCount(1)
  await view.options.click()
  await expect(view.dialog.getByText("1 shown, 101 selected · Most recently used first")).toBeVisible()

  // In the search, Escape clears it first, and closes the dialog only once it is empty.
  await view.search.focus()
  await page.keyboard.press("Escape")
  await expect(view.search).toHaveValue("")
  await expect(view.dialog).toBeVisible()
  await expect(view.dialog.getByText("101 of 5000 selected · Most recently used first")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(view.record).toHaveAttribute("data-closed", "true")
})

story("switches profiles from none chosen, at the top, and reads a profile only once while open", async ({ page }) => {
  const view = await open(page, { sites: 5_000 })

  await view.options.first().click()
  await view.list.focus()
  await page.keyboard.press("End")
  await view.dialog.getByRole("button", { name: /Browser profile/ }).click()
  await page.getByRole("option", { name: "Google Chrome · Home" }).click()
  await expect(view.options).toHaveCount(2)
  await expect(view.dialog.getByText("0 of 2 selected · Most recently used first")).toBeVisible()
  await view.dialog.getByRole("button", { name: /Browser profile/ }).click()
  await page.getByRole("option", { name: "Google Chrome · Work" }).click()
  await expect(view.options.first()).toHaveAttribute("data-site", "github.com")
  await expect(view.options.first()).toBeInViewport()
  await expect(view.record).toHaveAttribute("data-reads", "Default,Profile 1")
})

story("starts from the site a passkey request came from, and stays open to say why an import left cookies behind", async ({ page }) => {
  const view = await open(page, { sites: 5, query: "accounts.github.com", partial: true })

  await expect(view.options).toHaveCount(1)
  await expect(view.options).toHaveAttribute("data-site", "github.com")
  // The one site the page belongs to is chosen already.
  await expect(view.options).toHaveAttribute("aria-selected", "true")
  await view.importButton.click()
  await expect(view.dialog.getByRole("status")).toHaveText("Imported 2 cookies. Not imported: 1.")
  await expect(view.record).toHaveAttribute("data-closed", "false")
})

story("opened for a site, moves on to the browser profile that has it", async ({ page }) => {
  const view = await open(page, { sites: 5, query: "www.netflix.com" })

  await expect(view.options).toHaveCount(1)
  await expect(view.options).toHaveAttribute("data-site", "netflix.com")
  await expect(view.dialog.getByRole("button", { name: /Browser profile/ })).toContainText("Home")
})

story("shows what the list is doing in its place, with a way to try again", async ({ page }) => {
  const held = await open(page, { sites: 5, hold: true })

  await expect(held.dialog.getByRole("status")).toHaveText("Reading the sites in Google Chrome…")
  await expect(held.dialog.getByText(/selected/)).toBeHidden()
  await page.getByTestId("site-chooser-release").dispatchEvent("click")
  await expect(held.options).toHaveCount(5)
  await held.search.fill("nothing-like-this")
  await expect(held.dialog.getByRole("status")).toHaveText("No site matches your search.")
})

story("says why a profile has no list, and reads it again on Try again", async ({ page }) => {
  const view = await open(page, { sites: "locked" })

  await expect(view.dialog.getByRole("alert")).toHaveText("Google Chrome keeps its cookies locked while it runs. Quit Google Chrome, then import again.")
  await expect(view.importButton).toBeDisabled()
  await view.dialog.getByRole("button", { name: "Try again" }).click()
  await expect(view.record).toHaveAttribute("data-reads", "Default,Default")
})

story("an empty profile says so", async ({ page }) => {
  const view = await open(page, { sites: 0 })

  await expect(view.dialog.getByRole("status")).toHaveText("This profile has no sites to import.")
})

story("keeps site names left to right in a right-to-left layout, the box at the start and long names cut at their start", async ({ page }) => {
  const view = await open(page, { sites: 6 }, "rtl")
  const row = view.dialog.locator('[data-site="xn--mnchen-3ya.de"]')
  const box = await row.locator('[data-slot="checkbox-v2-control"]').boundingBox()
  const name = await row.locator("bdi").boundingBox()
  const count = await row.getByText("5 cookies").boundingBox()

  expect(box && name && count && box.x > name.x && name.x > count.x).toBe(true)
  const long = view.dialog.locator('[data-site$="example.co.uk"]').first().locator("span").first()
  expect(await long.evaluate((element) => [getComputedStyle(element).direction, element.scrollWidth > element.clientWidth])).toEqual(["rtl", true])
})
