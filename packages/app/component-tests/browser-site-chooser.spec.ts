import type { Page } from "@playwright/test"
import { expect, sourceURL, story } from "../../stories/playwright/story"

// What the fixture's faked browser profile answers: a number of made-up sites, or why it lists none.
type SiteScenario = { sites: number } | { failed: "locked" | "access" | "read" }

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

  return page.getByRole("dialog", { name: "Choose sites to import" })
}

story.beforeEach(async ({ mount }) => {
  await mount("ui-line-comment--editor")
})

story("imports only the sites chosen from a profile of 5,000, which lists in a window of rows", async ({ page }) => {
  const dialog = await open(page, { sites: 5_000 })
  const rows = dialog.locator("[data-site]")
  // The dialog is modal, so the record beside it is hidden from the accessibility tree.
  const imports = page.getByTestId("site-chooser-imports")

  await expect(rows.first()).toHaveAttribute("data-site", "github.com")
  await expect(dialog.getByText("0 of 5000 selected")).toBeVisible()
  // Only the rows in view, and a few around them, exist.
  expect(await rows.count()).toBeLessThan(40)
  await expect(dialog.getByRole("button", { name: "Import 0 sites" })).toBeDisabled()

  // The person searches for each tool and picks it; Select all applies to what the search shows.
  const search = dialog.getByRole("searchbox", { name: "Search sites" })
  await search.fill("linear")
  await expect(rows).toHaveCount(1)
  await dialog.getByRole("button", { name: "Select all" }).click()
  await search.fill("https://github.com/anomalyco/opencode")
  await expect(rows).toHaveCount(1)
  await rows.getByText("github.com").click()
  await search.fill("")
  await expect(dialog.getByText("2 of 5000 selected")).toBeVisible()

  // Deep rows render as the list scrolls.
  await dialog.locator("[data-site]").first().hover()
  await page.mouse.wheel(0, 32 * 4_000)
  await expect(dialog.locator('[data-site="site-4000.example.co.uk"]')).toBeVisible()
  expect(await rows.count()).toBeLessThan(40)

  await dialog.getByRole("button", { name: "Import 2 sites" }).click()
  await expect(dialog.getByRole("status").filter({ hasText: "Imported 4 cookies." })).toBeVisible()
  await expect(imports.locator("li")).toHaveText([
    JSON.stringify({ source: "chrome", profile: "Default", sites: ["github.com", "linear.app"] }),
  ])
})

story("selects and imports from the keyboard", async ({ page }) => {
  const dialog = await open(page, { sites: 5 })
  const search = dialog.getByRole("searchbox", { name: "Search sites" })

  await expect(search).toBeFocused()
  await search.fill("figma")
  await page.keyboard.press("Tab")
  // The profile select, then the selection's actions, then the rows.
  await expect(dialog.getByRole("button", { name: "Browser profile" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(dialog.getByRole("button", { name: "Select all" })).toBeFocused()
  await page.keyboard.press("Tab")
  await page.keyboard.press("Tab")
  await expect(dialog.getByRole("checkbox", { name: /figma\.com/ })).toBeFocused()
  await page.keyboard.press("Space")
  await expect(dialog.getByRole("checkbox", { name: /figma\.com/ })).toBeChecked()
  await expect(dialog.getByText("1 of 5 selected")).toBeVisible()
  await dialog.getByRole("button", { name: "Import 1 site" }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("site-chooser-imports").locator("li")).toHaveText([
    JSON.stringify({ source: "chrome", profile: "Default", sites: ["figma.com"] }),
  ])
})

story("says why a profile has no list, and imports nothing", async ({ page }) => {
  const dialog = await open(page, { failed: "locked" })

  await expect(dialog.getByRole("alert")).toHaveText(
    "Google Chrome keeps its cookies locked while it runs. Quit Google Chrome, then import again.",
  )
  await expect(dialog.getByRole("button", { name: "Import 0 sites" })).toBeDisabled()
})

story("keeps site names left to right in a right-to-left layout, the checkbox at the start", async ({ page }) => {
  const dialog = await open(page, { sites: 5 }, "rtl")
  const row = dialog.locator('[data-site="xn--mnchen-3ya.de"]')
  const box = await row.locator('[data-slot="checkbox-v2-control"]').boundingBox()
  const name = await row.locator("bdi").boundingBox()
  const count = await row.getByText("5 cookies").boundingBox()

  expect(await row.locator("bdi").getAttribute("dir")).toBe("ltr")
  expect(box && name && count && box.x > name.x && name.x > count.x).toBe(true)
})
