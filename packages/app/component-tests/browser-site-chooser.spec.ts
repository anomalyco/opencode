import type { Locator, Page } from "@playwright/test"
import { expect, sourceURL, test } from "../../lab/playwright/test"

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
  pages?: number
  none?: boolean
  keychain?: boolean
  unreadable?: boolean
}

const source = (path: string) => sourceURL(new URL(path, import.meta.url))

const modules = {
  fixture: source("../../gui-plugins/src/browser/site-chooser.fixture.tsx"),
  ui: source("../src/runtime/plugin/ui.tsx"),
}

// Any page loads the app styles; the fixture opens the real import dialog in the real dialog host beside it. Most
// cases here are about the site list, so the dialog opens on "Only sites I choose" unless the case says otherwise. The
// faked browser has two profiles, so the dialog offers a profile picker and its title names no browser.
async function open(page: Page, given: SiteScenario, direction: "ltr" | "rtl" = "ltr") {
  const scenario = { reveal: true, ...given }

  await page.evaluate(
    async (input) => {
      const [{ mountSiteChooser }, { ui }] = await Promise.all([import(input.modules.fixture), import(input.modules.ui)])

      mountSiteChooser({ ui, scenario: input.scenario, direction: input.direction })
    },
    { modules, scenario, direction },
  )

  const dialog = page.getByRole("dialog", { name: "Import from another browser", exact: true })

  return {
    dialog,
    list: dialog.getByRole("listbox", { name: "Sites" }),
    options: dialog.getByRole("option"),
    search: dialog.getByRole("searchbox", { name: "Search sites" }),
    // "Import" until the person changes which sites come, then how many sites it brings.
    importButton: dialog.getByRole("button", { name: /^Import( [\d,]+ sites?)?$/ }),
    // What comes over: two real checkboxes, ticked until the person unticks one.
    signins: dialog.getByRole("checkbox", { name: "Sign-ins", exact: true }),
    history: dialog.getByRole("checkbox", { name: "Browsing history", exact: true }),
    // Which sites: every one, or only the ticked ones, which start with none.
    every: dialog.getByRole("radio", { name: /^All sites/ }),
    only: dialog.getByRole("radio", { name: "Only sites I choose", exact: true }),
    // One box ticks or unticks every site the search shows.
    selectAll: dialog.getByRole("checkbox", { name: /^Select (all|[\d,]+ shown)$/ }),
    profile: dialog.getByRole("button", { name: /Browser profile/ }),
    // The dialog is modal, so the record beside it is hidden from the accessibility tree.
    record: page.getByTestId("site-chooser-imports"),
  }
}

// A radio's or a box's input is visually hidden under the control drawn for it, which takes the pointer.
const press = (input: Locator) =>
  input
    .locator('xpath=ancestor::*[@data-slot="radio-v2-item" or @data-slot="checkbox-v2"][1]')
    .locator('[data-slot$="-control"]')
    .click()

test.beforeEach(async ({ mount }) => {
  await mount("ui-line-comment--editor")
})

test("lists 5,000 sites in a window of rows, as one keyboard stop with roving focus", async ({ page }) => {
  const view = await open(page, { sites: 5_000 })

  await expect(view.options.first()).toHaveAttribute("data-site", "github.com")
  await expect(view.list).toHaveAttribute("aria-multiselectable", "true")
  await expect(view.options.first()).toHaveAttribute("aria-setsize", "5000")
  // Only the sites the person ticks come over, and none is ticked yet: there is nothing to import.
  await expect(view.dialog.getByText("0 of 5,000 selected")).toBeVisible()
  expect(await view.options.count()).toBeLessThan(45)
  await expect(view.importButton).toHaveText("Import")
  await expect(view.importButton).toBeDisabled()

  // Reading order: the profile, the two boxes and the choice of sites come before the search. Tab goes from the
  // search, past the box that ticks every site, to the list, then out of it.
  await expect(view.search).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await expect(view.only).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await expect(view.history).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await expect(view.signins).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await expect(view.profile).toBeFocused()
  await page.keyboard.press("Tab")
  await page.keyboard.press("Tab")
  await page.keyboard.press("Tab")
  await page.keyboard.press("Tab")
  await expect(view.search).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(view.selectAll).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(view.list).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(view.dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused()
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
  await expect(view.dialog.getByText("2 of 5,000 selected")).toBeVisible()
  await expect(view.importButton).toHaveText("Import 2 sites")

  // Enter imports what is selected; a clean import closes the dialog.
  await page.keyboard.press("Enter")
  await expect(view.record.locator("li")).toHaveText([JSON.stringify({ source: "chrome", profile: "Default", sites: ["linear.app", "figma.com"], cookies: true, history: true })])
  await expect(view.record).toHaveAttribute("data-closed", "true")
  await expect(view.record).toHaveAttribute("data-imported", "1")
})

test("the box that ticks every site acts on what a search shows, and says so", async ({ page }) => {
  const view = await open(page, { sites: 5_000 })

  await view.search.fill("site-01")
  await expect(view.dialog.getByText("100 shown, 0 selected")).toBeVisible()
  await expect(view.selectAll).toHaveAccessibleName("Select 100 shown")
  await press(view.selectAll)
  await expect(view.selectAll).toBeChecked()
  await expect(view.dialog.getByText("100 shown, 100 selected")).toBeVisible()
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

test("leaves Escape and ArrowDown to an input method while it composes", async ({ page }) => {
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

test("switches profiles at the top with none of another profile's sites chosen, and reads a profile only once while open", async ({ page }) => {
  const view = await open(page, { sites: 5_000 })

  await view.options.first().click()
  await view.list.focus()
  await page.keyboard.press("End")
  await view.profile.click()
  await page.getByRole("option", { name: "Google Chrome · Home" }).click()
  await expect(view.options).toHaveCount(4)
  await expect(view.dialog.getByText("0 of 4 selected")).toBeVisible()
  await view.profile.click()
  await page.getByRole("option", { name: "Google Chrome · Work" }).click()
  await expect(view.options.first()).toHaveAttribute("data-site", "github.com")
  await expect(view.options.first()).toBeInViewport()
  await expect(view.record).toHaveAttribute("data-reads", "Default,Profile 1")
})

test("starts from the site a passkey request came from, brings its sign-in alone, and stays open to say that some stayed behind", async ({ page }) => {
  const view = await open(page, { sites: 5, site: { name: "github.com", choose: true }, partial: true, pages: 4210 })

  await expect(view.options).toHaveCount(1)
  await expect(view.options).toHaveAttribute("data-site", "github.com")
  // The site the page belongs to is chosen already.
  await expect(view.options).toHaveAttribute("aria-selected", "true")
  // This dialog is about one site's sign-in: it offers neither box nor a choice of sites, and asks main for no history.
  await expect(view.signins).toHaveCount(0)
  await expect(view.history).toHaveCount(0)
  await expect(view.dialog.getByRole("radio")).toHaveCount(0)
  await view.importButton.click()
  await expect(view.record.locator("li")).toHaveText([JSON.stringify({ source: "chrome", profile: "Default", sites: ["github.com"], cookies: true, history: false })])
  const status = view.dialog.getByRole("status")
  await expect(status).toHaveText("Imported from Google Chrome. Some sites will ask you to sign in again.")
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
      // The profile picker is as wide as its name, so only the close button ends on the buttons' edge.
      rightDeltas: importBtn && closeSvg ? [Math.round(closeSvg.right - importBtn.right)] : [],
    }
  })

  expect(layout.footerHasStatus).toBe(false)
  expect(layout.topClearanceSearch).toBeGreaterThanOrEqual(4)
  expect(layout.topClearanceSelect).toBeGreaterThanOrEqual(4)
  expect(layout.leftDeltas).toEqual([0, 0])
  expect(layout.rightDeltas).toEqual([0])
})

test("opened for a site, moves on to the browser profile that has exactly it, and chooses only that one", async ({ page }) => {
  const view = await open(page, { sites: 5, site: { name: "google.com", choose: true } })

  await expect(view.profile).toContainText("Home")
  await expect(view.options).toHaveCount(2)
  await expect(view.dialog.locator('[data-site="google.com"]')).toHaveAttribute("aria-selected", "true")
  await expect(view.dialog.locator('[data-site="google.com.au"]')).toHaveAttribute("aria-selected", "false")
  // A row is the site's name and nothing else.
  await expect(view.dialog.locator('[data-site="google.com"]')).toHaveText("google.com")
})

test("a page's site that only another site contains chooses nothing, and says no sign-in was found", async ({ page }) => {
  const view = await open(page, { sites: 5, site: { name: "hub.com", choose: true } })

  // The search still shows github.com, which contains the name, but it is not the page's site.
  await expect(view.options).toHaveCount(1)
  await expect(view.options).toHaveAttribute("data-site", "github.com")
  await expect(view.options).toHaveAttribute("aria-selected", "false")
  await expect(view.dialog.getByText("No sign-in for hub.com was found in Google Chrome.")).toBeVisible()
  await expect(view.importButton).toBeDisabled()
})

test("in a tab the agent drives, the page's site is shown but not chosen", async ({ page }) => {
  const view = await open(page, { sites: 5, site: { name: "github.com", choose: false } })

  await expect(view.options).toHaveCount(1)
  await expect(view.options).toHaveAttribute("data-site", "github.com")
  await expect(view.options).toHaveAttribute("aria-selected", "false")
  await expect(view.importButton).toBeDisabled()
})

test("keeps the active row off the list's edges, and brings it into view from the search", async ({ page }) => {
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
  await expect(view.dialog.locator('[aria-live="polite"]')).toHaveText("1 of 5,000 selected")
})

test("shows what the list is doing in its place, with a way to try again", async ({ page }) => {
  const held = await open(page, { sites: 5, hold: true })

  await expect(held.dialog.getByRole("status")).toHaveText("Reading the sites in Google Chrome…")
  await expect(held.dialog.getByText(/selected/)).toBeHidden()
  await page.getByTestId("site-chooser-release").dispatchEvent("click")
  await expect(held.options).toHaveCount(5)
  await held.search.fill("nothing-like-this")
  await expect(held.dialog.getByRole("status")).toHaveText("No site matches your search.")
})

test("says why a profile has no list, and reads it again on Try again", async ({ page }) => {
  const view = await open(page, { sites: "locked" })

  await expect(view.dialog.getByRole("alert")).toHaveText("Quit Google Chrome and try again.")
  await view.dialog.getByRole("button", { name: "Try again" }).click()
  await expect(view.record).toHaveAttribute("data-reads", "Default,Default")
})

test("an empty profile says so", async ({ page }) => {
  const view = await open(page, { sites: 0 })

  await expect(view.dialog.getByRole("status")).toHaveText("This profile has no sites to import.")
  await expect(view.importButton).toBeDisabled()
})

// Where the two boxes of what comes over are in the dialog, in CSS pixels: each box's left edge and label against the title's left edge,
// each 28px row's top from the dialog's top, and how far the first box's focus ring (a 2px outline, 2px off the 16px
// box) stays inside what clips the body.
const boxes = (dialog: ReturnType<Page["getByRole"]>) =>
  dialog.evaluate((node) => {
    const text = (element: Element | null) => {
      const range = document.createRange()

      if (element) range.selectNodeContents(element)

      return range.getBoundingClientRect()
    }

    const container = (node.closest('[data-slot="dialog-container"]') ?? node).getBoundingClientRect()
    const title = text(node.querySelector('[data-slot="dialog-title"]'))
    const clip = node.querySelector('[data-slot="dialog-body"] [data-scrollable]')?.getBoundingClientRect()
    const kinds = Array.from(node.querySelectorAll('[data-slot="dialog-body"] section:first-of-type [data-slot="checkbox-v2"]'))
    const controls = kinds.map((kind) => kind.querySelector('[data-slot="checkbox-v2-control"]')?.getBoundingClientRect())
    const first = controls[0]
    const last = controls[controls.length - 1]

    return {
      left: controls.map((control) => Math.round((control?.left ?? -1) - title.left)),
      label: kinds.map((kind) => Math.round(text(kind.querySelector('[data-slot="checkbox-v2-label"]')).left - title.left)),
      top: kinds.map((kind) => Math.round((kind.parentElement?.getBoundingClientRect().top ?? -1) - container.top)),
      height: kinds.map((kind) => kind.parentElement?.getBoundingClientRect().height),
      ring: clip && first && last ? [first.left - 4 - clip.left, first.top - 4 - clip.top, clip.bottom - last.bottom - 4].map((value) => Math.round(value)) : [],
    }
  })

test("opens on two ticked boxes, All sites and Import, which brings everything without the list", async ({ page }) => {
  const view = await open(page, { sites: 5, reveal: false, pages: 4210 })

  // No sentence: the title, the two boxes, the choice of sites and the buttons say it.
  await expect(view.signins).toBeChecked()
  await expect(view.history).toBeChecked()
  await expect(view.every).toBeChecked()
  await expect(view.dialog.locator('[data-slot="dialog-description"]')).toHaveCount(0)
  await expect(view.list).toHaveCount(0)
  await expect(view.importButton).toHaveText("Import")
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const collapsed = await boxes(view.dialog)

  // Both boxes start on the title's left edge, in 28px rows, with their focus ring inside the body's clip.
  expect(collapsed).toMatchObject({ left: [0, 0], label: [24, 24], height: [28, 28] })
  expect(Math.min(...collapsed.ring)).toBeGreaterThanOrEqual(0)

  // "Only sites I choose" opens the list under the choice; the dialog keeps its top edge, so the boxes stay where they
  // are.
  await press(view.only)
  await expect(view.options).toHaveCount(5)
  const expanded = await boxes(view.dialog)
  expect(expanded).toMatchObject({ left: [0, 0], label: [24, 24], height: [28, 28], top: collapsed.top })
  expect(Math.min(...expanded.ring)).toBeGreaterThanOrEqual(0)
  await press(view.every)
  await expect(view.list).toHaveCount(0)

  await view.importButton.click()
  // No list of sites: main imports the whole profile, its sign-ins and its history.
  await expect(view.record.locator("li")).toHaveText([JSON.stringify({ source: "chrome", profile: "Default", cookies: true, history: true })])
  await expect(view.record).toHaveAttribute("data-closed", "true")
})

test("a box the person unticks stays behind, Import needs one of them, and Enter on a box imports", async ({ page }) => {
  const view = await open(page, { sites: 5, reveal: false, pages: 4210 })

  // The dialog opens with the focus on itself. Tab reaches the boxes in reading order, after Close and the profile;
  // Space toggles the one that has the focus.
  await expect(view.dialog.locator('[data-slot="dialog-content"]').or(view.dialog)).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(view.dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(view.profile).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(view.signins).toBeFocused()
  await page.keyboard.press("Space")
  await expect(view.signins).not.toBeChecked()
  await page.keyboard.press("Tab")
  await expect(view.history).toBeFocused()
  await page.keyboard.press("Space")
  await expect(view.history).not.toBeChecked()
  // Nothing is ticked: there is nothing to import, by the button or by Enter.
  await expect(view.importButton).toBeDisabled()
  await page.keyboard.press("Enter")
  await expect(view.record.locator("li")).toHaveCount(0)

  // History alone: no cookie is asked for.
  await page.keyboard.press("Space")
  await expect(view.importButton).toBeEnabled()
  await page.keyboard.press("Enter")
  await expect(view.record.locator("li")).toHaveText([JSON.stringify({ source: "chrome", profile: "Default", cookies: false, history: true })])
  await expect(view.record).toHaveAttribute("data-closed", "true")
})

test("with Browsing history unticked the import brings sign-ins alone, of the chosen sites", async ({ page }) => {
  const view = await open(page, { sites: 5 })

  // A click on the label unticks its box.
  await view.dialog.getByText("Browsing history", { exact: true }).click()
  await expect(view.history).not.toBeChecked()
  await view.dialog.locator('[data-site="github.com"]').click()
  await expect(view.importButton).toHaveText("Import 1 site")
  await view.importButton.click()
  await expect(view.record.locator("li")).toHaveText([JSON.stringify({ source: "chrome", profile: "Default", sites: ["github.com"], cookies: true, history: false })])
})

test("empty fallback uses a compact fit dialog when no browsers are found", async ({ page }) => {
  await page.evaluate(
    async (input) => {
      const [{ mountSiteChooser }, { ui }] = await Promise.all([import(input.modules.fixture), import(input.modules.ui)])

      mountSiteChooser({ ui, scenario: { sites: 0, empty: true } })
    },
    { modules },
  )

  const dialog = page.getByRole("dialog", { name: "Import from another browser" })
  await expect(dialog.getByText("No other browser found on this computer")).toBeVisible()
  const box = await page.locator('[data-slot="dialog-container"]').boundingBox()
  expect(box && box.width <= 480 && box.height < 250).toBe(true)
})

test("Only sites I choose shows the list in place with none ticked, and the button then names how many it brings", async ({ page }) => {
  const view = await open(page, { sites: 5, reveal: false })

  await press(view.only)
  await expect(view.options).toHaveCount(5)
  await expect(view.dialog.getByText("0 of 5 selected")).toBeVisible()
  await expect(view.importButton).toHaveText("Import")
  await expect(view.importButton).toBeDisabled()
  await view.dialog.locator('[data-site="github.com"]').click()
  await expect(view.importButton).toHaveText("Import 1 site")
  // Every site ticked is everything again.
  await press(view.selectAll)
  await expect(view.dialog.getByText("5 of 5 selected")).toBeVisible()
  await expect(view.importButton).toHaveText("Import")
  await view.dialog.locator('[data-site="github.com"]').click()
  await expect(view.importButton).toHaveText("Import 4 sites")
  await view.importButton.click()
  const sent = JSON.parse((await view.record.locator("li").textContent()) ?? "{}")
  expect(sent.sites).toHaveLength(4)
  expect(sent.sites).not.toContain("github.com")
})

test("a list that Only sites I choose showed after its sites loaded still draws the rows it scrolls to", async ({ page }) => {
  const view = await open(page, { sites: 5_000, reveal: false })

  await press(view.only)
  await expect(view.dialog.getByText("0 of 5,000 selected")).toBeVisible()
  await view.list.hover()
  await page.mouse.wheel(0, 4_000)
  await expect(view.dialog.locator('[data-site="github.com"]')).not.toBeInViewport()
  // 4,000 px down a list of 32 px rows.
  await expect(view.dialog.locator('[role="option"][aria-posinset="130"]')).toBeInViewport()
})

test("keeps site names left to right in a right-to-left layout, the box at the start and long names cut at their start", async ({ page }) => {
  const view = await open(page, { sites: 6 }, "rtl")
  const row = view.dialog.locator('[data-site="xn--mnchen-3ya.de"]')
  const box = await row.locator('[data-slot="checkbox-v2-control"]').boundingBox()
  const name = await row.locator("bdi").first().boundingBox()

  expect(box && name && box.x > name.x).toBe(true)
  const long = view.dialog.locator('[data-site$="example.co.uk"]').first().locator("span[title]")
  expect(await long.evaluate((element) => [getComputedStyle(element).direction, element.scrollWidth > element.clientWidth])).toEqual(["rtl", true])
})

// The pane's offer, as a bar over a page or a card on the new tab page, with what the faked profile answers an import.
async function offer(page: Page, scenario: SiteScenario, card = false) {
  await page.evaluate(
    async (input) => {
      const [{ mountSiteChooser }, { ui }] = await Promise.all([import(input.modules.fixture), import(input.modules.ui)])

      mountSiteChooser({ ui, scenario: input.scenario, offer: true, card: input.card })
    },
    { modules, scenario, card },
  )

  return {
    importing: page.getByRole("button", { name: "Import", exact: true }),
    confirmation: page.getByRole("status").filter({ hasText: /^Imported/ }),
    record: page.getByTestId("site-chooser-imports"),
  }
}

test("the sign-in bar names the browser, imports sign-ins and history in one click, and says in words what came", async ({ page }) => {
  const bar = await offer(page, { sites: 5, pages: 4210 })

  await expect(page.getByText("Bring your sign-ins and history from Google Chrome · Work", { exact: true })).toBeVisible()
  await bar.importing.click()
  // No dialog and no boxes here: the one click brings both.
  await expect(bar.record.locator("li")).toHaveText([JSON.stringify({ source: "chrome", profile: "Default", cookies: true, history: true })])
  await expect(bar.confirmation).toHaveText("Imported sign-ins and history from Google Chrome")
  await expect(bar.record).toHaveAttribute("data-imported", "1")
})

test("the sign-in bar says that some sites will ask again when sign-ins stayed behind", async ({ page }) => {
  const bar = await offer(page, { sites: 5, pages: 4210, protected: 3 })

  await bar.importing.click()
  await expect(bar.confirmation).toHaveText("Imported from Google Chrome. Some sites will ask you to sign in again.")
})

test("the bar's own dialog brings history alone when Sign-ins is unticked, and the bar says so without loading the page again", async ({ page }) => {
  const bar = await offer(page, { sites: 5, pages: 4210 })

  await page.getByRole("button", { name: "Import from another browser", exact: true }).click()
  await page.getByRole("menuitem", { name: "Choose sites to import", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Import from another browser", exact: true })
  // It opens on the sites the person ticks, none yet; All sites brings the whole profile.
  await press(dialog.getByRole("radio", { name: /^All sites/ }))
  await dialog.getByText("Sign-ins", { exact: true }).click()
  await expect(dialog.getByRole("checkbox", { name: "Sign-ins", exact: true })).not.toBeChecked()
  await dialog.getByRole("button", { name: "Import", exact: true }).click()
  await expect(bar.record.locator("li")).toHaveText([JSON.stringify({ source: "chrome", profile: "Default", cookies: false, history: true })])
  await expect(dialog).toHaveCount(0)
  await expect(bar.confirmation).toHaveText("Imported history from Google Chrome")
  // No sign-in came, so the page has nothing new to load with.
  await expect(bar.record).toHaveAttribute("data-imported", "0")
})

test("a browser's import never counts cookies: with none brought the bar says nothing was imported, or that the browser locks them", async ({ page }) => {
  // One sign-in could not be written and none came: no history either, so nothing was imported.
  const bar = await offer(page, { sites: 5, none: true, partial: true })

  await bar.importing.click()
  await expect(page.getByRole("alert")).toHaveText("Nothing was imported from Google Chrome.")
  await expect(bar.confirmation).toHaveCount(0)
})

test("the import dialog stays open to say that the browser locks its sign-ins from other apps", async ({ page }) => {
  const view = await open(page, { sites: 5, reveal: false, none: true, protected: 12 })

  await view.importButton.click()
  await expect(view.dialog.getByRole("alert")).toHaveText("Google Chrome locks its sign-ins from other apps. Sign in here instead.")
  await expect(view.record).toHaveAttribute("data-closed", "false")
})

test("a browser whose data cannot be read says so about the browser, with what to do", async ({ page }) => {
  const view = await open(page, { sites: 5, reveal: false, unreadable: true })

  await view.importButton.click()
  await expect(view.dialog.getByRole("alert")).toHaveText("Could not read this browser's data. Close it and try again.")
  await expect(view.record).toHaveAttribute("data-closed", "false")
})

test("on macOS the dialog says what the Keychain prompt asks while a Chromium import waits, and not to choose Always Allow", async ({ page }) => {
  const view = await open(page, { sites: 5, reveal: false, keychain: true })

  await view.importButton.click()
  await expect(view.dialog.getByRole("status")).toHaveText(
    'macOS asks for your password (shown as "security") to import Google Chrome\'s sign-ins. Choose Allow, not Always Allow, which lets any app read them without asking.',
  )
  await page.getByTestId("site-chooser-release").dispatchEvent("click")
  await expect(view.record).toHaveAttribute("data-closed", "true")
})

test("the offer card has a title and no paragraph, and its Import brings both", async ({ page }) => {
  const card = await offer(page, { sites: 5, pages: 4210 }, true)
  const region = page.getByRole("region", { name: "Bring your sign-ins and history", exact: true })

  await expect(region.getByText("Bring your sign-ins and history", { exact: true })).toBeVisible()
  await expect(region.getByText(/Copy your sign-ins/)).toHaveCount(0)
  await region.getByRole("button", { name: "Import", exact: true }).first().click()
  await expect(card.record.locator("li")).toHaveText([JSON.stringify({ source: "chrome", profile: "Default", cookies: true, history: true })])
  await expect(card.confirmation).toHaveText("Imported sign-ins and history from Google Chrome")
})

// The pane's sign-in bar says what an import brought for a few seconds, then goes by itself; Close ends it sooner.
test("the sign-in bar's import confirmation goes by itself after 5 seconds, and Close ends it sooner", async ({ page }) => {
  await page.clock.install()
  // No history in this profile: the line names the sign-ins alone.
  const { record, confirmation, importing } = await offer(page, { sites: 5, skipped: 318 })
  await expect(confirmation).toHaveCount(0)

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
