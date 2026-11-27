import type { Locator } from "@playwright/test"
import { expect, test } from "../../lab/playwright/test"

// The list's scroll position, read from its scrolling viewport.
const scrollTop = (list: Locator) =>
  list.evaluate((element) => element.closest<HTMLElement>('[data-slot="search-list-scroll"]')?.scrollTop ?? NaN)

const frames = (list: Locator) =>
  list.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))

test("unfavoriting a model from its flyout keeps the list where it is", async ({ mount, page }) => {
  await mount("app-dialog-model-selector--long-list")
  const list = page.getByRole("dialog").getByRole("listbox")
  // The second favorite, so the pointer has to take the highlight. Its own group is far below the fold.
  const favorite = list.getByRole("group", { name: "Favorites" }).getByRole("option", { name: /Zeta Model 24/ })

  await expect(favorite).toBeVisible()
  expect(await scrollTop(list)).toBe(0)

  await favorite.hover({ position: { x: 24, y: 6 } })
  await favorite.hover({ position: { x: 40, y: 10 } })
  await page.getByRole("menuitem", { name: /Unfavorite/ }).click()

  await expect(list.getByRole("group", { name: "Favorites" }).getByRole("option")).toHaveCount(1)
  // A reveal would run on the next frame.
  await frames(list)
  expect(await scrollTop(list)).toBe(0)
})

test("unfavoriting from the keyboard follows the model to its group", async ({ mount, page }) => {
  await mount("app-dialog-model-selector--long-list")
  const list = page.getByRole("dialog").getByRole("listbox")
  const search = page.getByRole("combobox", { name: "Search models" })

  await expect(list.getByRole("group", { name: "Favorites" }).getByRole("option")).toHaveCount(2)
  await search.press("ArrowDown")
  await expect(list.getByRole("option", { name: /Zeta Model 24/, selected: true })).toBeVisible()
  await search.press("ControlOrMeta+f")

  await expect(list.getByRole("group", { name: "Favorites" }).getByRole("option")).toHaveCount(1)
  await expect(
    list.getByRole("group", { name: "Zeta" }).getByRole("option", { name: /Zeta Model 24/ }),
  ).toBeInViewport()
  expect(await scrollTop(list)).toBeGreaterThan(0)
})
