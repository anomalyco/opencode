import type { Page } from "@playwright/test"
import { expect, sourceURL, story } from "../../stories/playwright/story"

// What the fixture's faked browser profile answers; see `SiteScenario` in the fixture.
type SiteScenario = {
  sites: number | "locked"
  hold?: boolean
  partial?: boolean
  skipped?: number
  protected?: number
  empty?: boolean
  site?: { name: string; choose: boolean }
  reveal?: boolean
}

const source = (path: string) => sourceURL(new URL(path, import.meta.url))

const modules = {
  fixture: source("../../gui-plugins/src/browser/site-chooser.fixture.tsx"),
  ui: source("../src/runtime/plugin/ui.tsx"),
}

// Any story loads the app styles; the fixture opens the real import dialog in the real dialog host beside it. Most
// cases here are about the site list, so the dialog opens with it shown unless the case says otherwise.
async function open(page: Page, given: SiteScenario, direction: "ltr" | "rtl" = "ltr") {
  const scenario = { reveal: true, ...given }

  await page.evaluate(
    async (input) => {
      const [{ mountSiteChooser }, { ui }] = await Promise.all([import(input.modules.fixture), import(input.modules.ui)])

      mountSiteChooser({ ui, scenario: input.scenario, direction: input.direction })
    },
    { modules, scenario, direction },
  )

  const dialog = page.getByRole("dialog", { name: /^Import from Google Chrome/ })

  return {
    dialog,
    list: dialog.getByRole("listbox", { name: "Sites" }),
    options: dialog.getByRole("option"),
    search: dialog.getByRole("searchbox", { name: "Search sites" }),
    // "Import all" until the person changes the choice, then how many sites it brings.
    importButton: dialog.getByRole("button", { name: /^Import (all|[\d,]+ sites?)$/ }),
    selectNone: dialog.getByRole("button", { name: "Select none", exact: true }),
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
  // Every site comes over until the person changes that.
  await expect(view.dialog.getByText("5,000 of 5,000 selected")).toBeVisible()
  await expect(
    view.dialog.getByText("Copies cookies for all 5,000 sites. The other browser keeps its own."),
  ).toBeVisible()
  expect(await view.options.count()).toBeLessThan(45)
  await expect(view.importButton).toHaveText("Import all")

  // Tab goes from the search, past the profile and the selection's one enabled action, to the list, then out of it.
  await expect(view.search).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(view.dialog.getByRole("button", { name: /Browser profile/ })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(view.selectNone).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(view.list).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(view.dialog.getByRole("button", { name: "Choose sites" })).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await expect(view.list).toBeFocused()
  await view.selectNone.click()
  await expect(view.dialog.getByText("0 of 5,000 selected")).toBeVisible()
  await expect(view.importButton).toBeDisabled()
  await view.list.focus()

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
  await expect(view.dialog.getByText("2 of 5,000 selected")).toBeVisible()
  await expect(view.importButton).toHaveText("Import 2 sites")

  // Enter imports what is selected; a clean import closes the dialog.
  await page.keyboard.press("Enter")
  await expect(view.record.locator("li")).toHaveText([JSON.stringify({ source: "chrome", profile: "Default", sites: ["linear.app", "figma.com"] })])
  await expect(view.record).toHaveAttribute("data-closed", "true")
  await expect(view.record).toHaveAttribute("data-imported", "1")
})

story("says what Select acts on while a search is active, and only offers what would change something", async ({ page }) => {
  const view = await open(page, { sites: 5_000 })

  await view.selectNone.click()
  await view.search.fill("site-01")
  await expect(view.dialog.getByText("100 shown, 0 selected")).toBeVisible()
  await view.dialog.getByRole("button", { name: "Select 100 shown", exact: true }).click()
  await expect(view.dialog.getByRole("button", { name: "Deselect 100 shown", exact: true })).toBeEnabled()
  await expect(view.dialog.getByRole("button", { name: "Select 100 shown", exact: true })).toBeDisabled()
  await view.search.fill("github")
  await expect(view.options).toHaveCount(1)
  await view.options.click()
  await expect(view.dialog.getByText("1 shown, 101 selected")).toBeVisible()

  // In the search, Escape clears it first, and closes the dialog only once it is empty.
  await view.search.focus()
  await page.keyboard.press("Escape")
  await expect(view.search).toHaveValue("")
  await expect(view.dialog).toBeVisible()
  await expect(view.dialog.getByText("101 of 5,000 selected")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(view.record).toHaveAttribute("data-closed", "true")
})

story("leaves Escape and ArrowDown to an input method while it composes", async ({ page }) => {
  const view = await open(page, { sites: 5 })
  const composing = { key: "Escape", keyCode: 229, isComposing: true }

  // An empty search: Escape ends the composition, not the dialog.
  await view.search.dispatchEvent("compositionstart")
  await view.search.dispatchEvent("keydown", composing)
  await view.search.dispatchEvent("keydown", { ...composing, key: "ArrowDown" })
  await expect(view.dialog).toBeVisible()
  await expect(view.search).toBeFocused()
  await view.search.dispatchEvent("compositionend")

  await view.search.fill("git")
  await view.search.dispatchEvent("compositionstart")
  await view.search.dispatchEvent("keydown", composing)
  await expect(view.search).toHaveValue("git")
  await view.search.dispatchEvent("compositionend")
  await page.keyboard.press("Escape")
  await expect(view.search).toHaveValue("")
  await page.keyboard.press("Escape")
  await expect(view.record).toHaveAttribute("data-closed", "true")
})

story("switches profiles back to every site chosen, at the top, and reads a profile only once while open", async ({ page }) => {
  const view = await open(page, { sites: 5_000 })

  await view.options.first().click()
  await view.list.focus()
  await page.keyboard.press("End")
  await view.dialog.getByRole("button", { name: /Browser profile/ }).click()
  await page.getByRole("option", { name: "Google Chrome · Home" }).click()
  await expect(view.options).toHaveCount(4)
  await expect(view.dialog.getByText("4 of 4 selected")).toBeVisible()
  await view.dialog.getByRole("button", { name: /Browser profile/ }).click()
  await page.getByRole("option", { name: "Google Chrome · Work" }).click()
  await expect(view.options.first()).toHaveAttribute("data-site", "github.com")
  await expect(view.options.first()).toBeInViewport()
  await expect(view.record).toHaveAttribute("data-reads", "Default,Profile 1")
})

story("starts from the site a passkey request came from, and stays open to say why an import left cookies behind", async ({ page }) => {
  const view = await open(page, { sites: 5, site: { name: "github.com", choose: true }, partial: true })

  await expect(view.options).toHaveCount(1)
  await expect(view.options).toHaveAttribute("data-site", "github.com")
  // The site the page belongs to is chosen already.
  await expect(view.options).toHaveAttribute("aria-selected", "true")
  await view.importButton.click()
  const status = view.dialog.getByRole("status")
  await expect(status).toHaveText("Imported 2 cookies. Not imported: 1.")
  await expect(view.record).toHaveAttribute("data-closed", "false")

  // Status sits in the dialog body (not crammed into the footer), with top clearance and 0px edge drift.
  const layout = await view.dialog.evaluate((node) => {
    const body = node.querySelector('[data-slot="dialog-body"]')?.getBoundingClientRect()
    const title = node.querySelector('[data-slot="dialog-title"]')?.getBoundingClientRect()
    const closeSvg = node.querySelector('[data-slot="dialog-close-button"] svg')?.getBoundingClientRect()
    const search = node.querySelector('[data-component="text-input-v2"]')?.getBoundingClientRect()
    const select = node.querySelector('[data-component="select-v2"]')?.getBoundingClientRect()
    const msg = node.querySelector('[data-slot="dialog-body"] [role="status"]')?.getBoundingClientRect()
    const footerMsg = node.querySelector('[data-slot="dialog-footer"] [role="status"]')
    const footerBtns = Array.from(node.querySelectorAll('[data-slot="dialog-footer"] button'))
    const importBtn = footerBtns[footerBtns.length - 1]?.getBoundingClientRect()

    return {
      footerHasStatus: footerMsg !== null,
      topClearanceSearch: body && search ? Math.round(search.top - body.top) : -1,
      topClearanceSelect: body && select ? Math.round(select.top - body.top) : -1,
      leftDeltas: title && search && msg ? [search.left - title.left, msg.left - title.left].map((v) => Math.round(v)) : [],
      rightDeltas:
        importBtn && closeSvg && select ? [closeSvg.right - importBtn.right, select.right - importBtn.right].map((v) => Math.round(v)) : [],
    }
  })

  expect(layout.footerHasStatus).toBe(false)
  expect(layout.topClearanceSearch).toBeGreaterThanOrEqual(4)
  expect(layout.topClearanceSelect).toBeGreaterThanOrEqual(4)
  expect(layout.leftDeltas).toEqual([0, 0])
  expect(layout.rightDeltas).toEqual([0, 0])
})

story("opened for a site, moves on to the browser profile that has exactly it, and chooses only that one", async ({ page }) => {
  const view = await open(page, { sites: 5, site: { name: "google.com", choose: true } })

  await expect(view.dialog.getByRole("button", { name: /Browser profile/ })).toContainText("Home")
  await expect(view.options).toHaveCount(2)
  await expect(view.dialog.locator('[data-site="google.com"]')).toHaveAttribute("aria-selected", "true")
  await expect(view.dialog.locator('[data-site="google.com.au"]')).toHaveAttribute("aria-selected", "false")
  // Counts are grouped for the app's language.
  await expect(view.dialog.locator('[data-site="google.com"]')).toContainText("120,000 cookies")
})

story("a page's site that only another site contains chooses nothing, and says no sign-in was found", async ({ page }) => {
  const view = await open(page, { sites: 5, site: { name: "hub.com", choose: true } })

  // The search still shows github.com, which contains the name, but it is not the page's site.
  await expect(view.options).toHaveCount(1)
  await expect(view.options).toHaveAttribute("data-site", "github.com")
  await expect(view.options).toHaveAttribute("aria-selected", "false")
  await expect(view.dialog.getByText("No sign-in for hub.com was found in Google Chrome.")).toBeVisible()
  await expect(view.importButton).toBeDisabled()
})

story("in a tab the agent drives, the page's site is shown but not chosen", async ({ page }) => {
  const view = await open(page, { sites: 5, site: { name: "github.com", choose: false } })

  await expect(view.options).toHaveCount(1)
  await expect(view.options).toHaveAttribute("data-site", "github.com")
  await expect(view.options).toHaveAttribute("aria-selected", "false")
  await expect(view.importButton).toBeDisabled()
})

story("keeps the active row off the list's edges, and brings it into view from the search", async ({ page }) => {
  const view = await open(page, { sites: 5_000 })

  // How far the row is inside the list's frame, above and below.
  const inset = () =>
    view.dialog.locator("[data-active]").evaluate((row) => {
      const frame = row.closest('[role="listbox"]')?.parentElement?.closest(".overflow-hidden")?.getBoundingClientRect()
      const box = row.getBoundingClientRect()

      return frame ? [Math.round(box.top - frame.top), Math.round(frame.bottom - box.bottom)] : []
    })

  await view.list.focus()
  await page.keyboard.press("End")
  await expect.poll(async () => (await inset())[1]).toBeGreaterThanOrEqual(4)
  await page.keyboard.press("Home")
  await expect.poll(async () => (await inset())[0]).toBeGreaterThanOrEqual(4)

  // A wheel scroll leaves the active first row out of view; ArrowDown from the search scrolls back to it.
  await view.list.hover()
  await page.mouse.wheel(0, 4_000)
  await expect(view.dialog.locator('[data-site="github.com"]')).not.toBeInViewport()
  await view.search.focus()
  await page.keyboard.press("ArrowDown")
  await expect(view.list).toBeFocused()
  await expect(view.dialog.locator('[data-site="github.com"]')).toBeInViewport()

  // The count alone is a live region, so a selection is announced.
  await page.keyboard.press("Space")
  await expect(view.dialog.locator('[aria-live="polite"]')).toHaveText("4,999 of 5,000 selected")
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
  await view.dialog.getByRole("button", { name: "Try again" }).click()
  await expect(view.record).toHaveAttribute("data-reads", "Default,Default")
})

story("an empty profile says so", async ({ page }) => {
  const view = await open(page, { sites: 0 })

  await expect(view.dialog.getByRole("status")).toHaveText("This profile has no sites to import.")
  await expect(view.importButton).toBeDisabled()
})

story("opens on one sentence and Import all, which brings every site without the list", async ({ page }) => {
  const view = await open(page, { sites: 5, reveal: false })

  await expect(view.dialog.getByText("Copies cookies for all 5 sites. The other browser keeps its own.")).toBeVisible()
  await expect(view.list).toHaveCount(0)
  await expect(view.dialog.getByRole("button", { name: "Choose sites" })).toHaveAttribute("aria-expanded", "false")
  await view.importButton.click()
  // No list of sites: main imports the whole profile.
  await expect(view.record.locator("li")).toHaveText([JSON.stringify({ source: "chrome", profile: "Default" })])
  await expect(view.record).toHaveAttribute("data-closed", "true")
})

story("empty fallback uses a compact fit dialog when no browsers are found", async ({ page }) => {
  await page.evaluate(
    async (input) => {
      const [{ mountSiteChooser }, { ui }] = await Promise.all([import(input.modules.fixture), import(input.modules.ui)])

      mountSiteChooser({ ui, scenario: { sites: 0, empty: true } })
    },
    { modules },
  )

  const dialog = page.getByRole("dialog", { name: "Import sign-ins" })
  await expect(dialog.getByText("No other browser found on this computer")).toBeVisible()
  const box = await page.locator('[data-slot="dialog-container"]').boundingBox()
  expect(box && box.width <= 480 && box.height < 250).toBe(true)
})

story("Choose sites shows the list in place, every site ticked, and the button then names how many it brings", async ({ page }) => {
  const view = await open(page, { sites: 5, reveal: false })
  const choose = view.dialog.getByRole("button", { name: "Choose sites" })

  await choose.click()
  await expect(choose).toHaveAttribute("aria-expanded", "true")
  await expect(view.options).toHaveCount(5)
  await expect(view.dialog.getByText("5 of 5 selected")).toBeVisible()
  await expect(view.importButton).toHaveText("Import all")
  await view.dialog.locator('[data-site="github.com"]').click()
  await expect(view.importButton).toHaveText("Import 4 sites")
  // Ticking it again is everything again.
  await view.dialog.locator('[data-site="github.com"]').click()
  await expect(view.importButton).toHaveText("Import all")
  await view.dialog.locator('[data-site="github.com"]').click()
  await view.importButton.click()
  const sent = JSON.parse((await view.record.locator("li").textContent()) ?? "{}")
  expect(sent.sites).toHaveLength(4)
  expect(sent.sites).not.toContain("github.com")
})

story("a list that Choose sites revealed after its sites loaded still draws the rows it scrolls to", async ({ page }) => {
  const view = await open(page, { sites: 5_000, reveal: false })

  await view.dialog.getByRole("button", { name: "Choose sites" }).click()
  await expect(view.dialog.getByText("5,000 of 5,000 selected")).toBeVisible()
  await view.list.hover()
  await page.mouse.wheel(0, 4_000)
  await expect(view.dialog.locator('[data-site="github.com"]')).not.toBeInViewport()
  // 4,000 px down a list of 32 px rows.
  await expect(view.dialog.locator('[role="option"][aria-posinset="130"]')).toBeInViewport()
})

story("keeps site names left to right in a right-to-left layout, the box at the start and long names cut at their start", async ({ page }) => {
  const view = await open(page, { sites: 6 }, "rtl")
  const row = view.dialog.locator('[data-site="xn--mnchen-3ya.de"]')
  const box = await row.locator('[data-slot="checkbox-v2-control"]').boundingBox()
  const name = await row.locator("bdi").first().boundingBox()
  const count = await row.getByText("5 cookies").boundingBox()

  expect(box && name && count && box.x > name.x && name.x > count.x).toBe(true)
  const long = view.dialog.locator('[data-site$="example.co.uk"]').first().locator("span[title]")
  expect(await long.evaluate((element) => [getComputedStyle(element).direction, element.scrollWidth > element.clientWidth])).toEqual(["rtl", true])
})

// The pane's sign-in bar says what an import brought for a few seconds, then goes by itself; Close ends it sooner.
story("the sign-in bar's import confirmation goes by itself after 5 seconds, and Close ends it sooner", async ({ page }) => {
  await page.clock.install()
  await page.evaluate(
    async (input) => {
      const [{ mountSiteChooser }, { ui }] = await Promise.all([import(input.modules.fixture), import(input.modules.ui)])

      mountSiteChooser({ ui, scenario: { sites: 5, skipped: 318 }, offer: true })
    },
    { modules },
  )
  const record = page.getByTestId("site-chooser-imports")
  const confirmation = page.getByRole("status").filter({ hasText: "Imported 10 cookies from Google Chrome" })
  const importing = page.getByRole("button", { name: /^Import from Google Chrome/ })

  // Close ends it at once, and only once: the timer it no longer needs does not report a second close.
  await importing.click()
  await expect(confirmation).toBeVisible()
  await expect(record).toHaveAttribute("data-imported", "1")
  await confirmation.getByRole("button", { name: "Close", exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(record).toHaveAttribute("data-closes", "1")
  await page.clock.runFor(10_000)
  await expect(record).toHaveAttribute("data-closes", "1")

  // Left alone, it goes after 5 seconds.
  await importing.click()
  await expect(confirmation).toBeVisible()
  await page.clock.runFor(4_900)
  await expect(confirmation).toBeVisible()
  await expect(record).toHaveAttribute("data-closes", "1")
  await page.clock.runFor(200)
  await expect(confirmation).toHaveCount(0)
  await expect(record).toHaveAttribute("data-closes", "2")
})
