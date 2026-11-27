import type { Page } from "@playwright/test"
import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./tab-strip-widths.fixture.tsx", import.meta.url))

const long = (name: string) => `a-file-name-long-enough-to-truncate-${name}.md`

story.beforeEach(async ({ mount }) => {
  // Any story loads the app's styles; the fixture mounts the strip beside it.
  await mount("ui-line-comment--editor")
})

async function mountStrip(page: Page, input: { titles: string[]; width: number; dir?: "ltr" | "rtl" }) {
  await page.evaluate(
    async ({ fixture, input }) => {
      const { mountTabStrip } = await import(fixture)
      mountTabStrip({ dir: "ltr", ...input })
      await document.fonts.ready
    },
    { fixture, input },
  )
  await expect(strip(page).locator("[data-pane-tab]")).toHaveCount(input.titles.length)
}

const strip = (page: Page) => page.getByTestId("tab-strip-fixture").locator('[data-slot="tabs-list"]')

const closeButton = (page: Page, title: string) =>
  strip(page).locator(`[data-pane-tab="${title}"] [data-slot="tabs-trigger-close-button"]`)

async function center(page: Page, title: string) {
  const box = (await closeButton(page, title).boundingBox())!

  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// The tab whose close button is at the point.
const under = (page: Page, point: { x: number; y: number }) =>
  page.evaluate(
    (point) =>
      document
        .elementFromPoint(point.x, point.y)
        ?.closest('[data-slot="tabs-trigger-close-button"]')
        ?.closest<HTMLElement>("[data-pane-tab]")?.dataset.paneTab,
    point,
  )

const hold = (page: Page) => strip(page).evaluate((el) => el.style.paddingInlineEnd)

const tabWidth = async (page: Page, title: string) =>
  (await strip(page).locator(`[data-pane-tab="${title}"]`).boundingBox())!.width

story(
  "a mouse close keeps the next close button under the pointer until the pointer leaves the strip",
  async ({ page }) => {
    const titles = [long("alpha"), "a.md", long("beta"), long("gamma"), "b.md", long("delta")]
    await mountStrip(page, { titles, width: 900 })
    const width = await tabWidth(page, long("gamma"))

    const middle = await center(page, long("beta"))
    await page.mouse.click(middle.x, middle.y)
    await expect(strip(page).locator(`[data-pane-tab="${long("beta")}"]`)).toHaveCount(0)
    await expect.poll(() => under(page, middle)).toBe(long("gamma"))

    // The short tab before the last one keeps its width, so the long ones fill the closed tab's place.
    const last = await center(page, long("delta"))
    await page.mouse.click(last.x, last.y)
    await expect(strip(page).locator(`[data-pane-tab="${long("delta")}"]`)).toHaveCount(0)
    await expect.poll(() => under(page, last)).toBe("b.md")

    // The "+" stays a gap after the last tab, and the held strip shows no end fade.
    const gap = await strip(page).evaluate((el) => {
      const plus = el.lastElementChild!.getBoundingClientRect()
      const tab = el.querySelector('[data-pane-tab="b.md"]')!.getBoundingClientRect()

      return Math.round(plus.left - tab.right)
    })

    expect(gap).toBe(8)
    expect(await strip(page).evaluate((el) => el.style.getPropertyValue("--tab-strip-fade-end"))).toBe("0px")

    await page.mouse.move(middle.x, middle.y + 200)
    await expect.poll(() => hold(page)).toBe("")
    await expect.poll(() => tabWidth(page, long("gamma"))).toBeGreaterThan(width + 1)
  },
)

story("a middle click close holds the strip, and resizing the strip releases it", async ({ page }) => {
  const titles = [long("alpha"), long("beta"), long("gamma"), long("delta")]
  await mountStrip(page, { titles, width: 700 })
  const width = await tabWidth(page, long("gamma"))

  await strip(page)
    .locator(`[data-pane-tab="${long("beta")}"] [role="tab"]`)
    .click({ button: "middle" })
  await expect(strip(page).locator(`[data-pane-tab="${long("beta")}"]`)).toHaveCount(0)
  await expect.poll(() => tabWidth(page, long("gamma"))).toBeCloseTo(width, 0)

  // Held, the three tabs would shrink with the strip; released, they share the whole of it.
  await page.evaluate(async (fixture) => {
    const { setTabStripWidth } = await import(fixture)
    setTabStripWidth(650)
  }, fixture)
  await expect.poll(() => tabWidth(page, long("gamma"))).toBeGreaterThan(width + 1)
  expect(await hold(page)).toBe("")
})

story("closing from the keyboard, or a middle click that closes nothing, resizes the tabs", async ({ page }) => {
  const titles = [long("alpha"), "pinned.md", long("beta"), long("gamma")]
  await mountStrip(page, { titles, width: 700 })
  const width = await tabWidth(page, long("gamma"))

  // The middle click on a tab without a middle-click close arms nothing for the keyboard close that follows.
  await strip(page).locator('[data-pane-tab="pinned.md"] [role="tab"]').click({ button: "middle" })
  await closeButton(page, "pinned.md").getByRole("button").focus()
  await page.keyboard.press("Enter")
  await expect(strip(page).locator('[data-pane-tab="pinned.md"]')).toHaveCount(0)
  await expect.poll(() => tabWidth(page, long("gamma"))).toBeGreaterThan(width + 1)

  const next = await tabWidth(page, long("gamma"))
  await closeButton(page, long("alpha")).getByRole("button").focus()
  await page.keyboard.press("Enter")
  await expect(strip(page).locator(`[data-pane-tab="${long("alpha")}"]`)).toHaveCount(0)
  await expect.poll(() => tabWidth(page, long("gamma"))).toBeGreaterThan(next + 1)
})

story("in a right-to-left strip the next close button slides under the pointer", async ({ page }) => {
  const titles = [long("alpha"), long("beta"), long("gamma"), long("delta")]
  await mountStrip(page, { titles, width: 700, dir: "rtl" })

  const middle = await center(page, long("beta"))
  await page.mouse.click(middle.x, middle.y)
  await expect(strip(page).locator(`[data-pane-tab="${long("beta")}"]`)).toHaveCount(0)
  await expect.poll(() => under(page, middle)).toBe(long("gamma"))
})

story(
  "an overflowing strip is never held, so closing its last tab keeps the other tabs at their width",
  async ({ page }) => {
    const titles = Array.from({ length: 8 }, (_, index) => long(String(index)))
    await mountStrip(page, { titles, width: 400 })
    expect(await strip(page).evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    const width = await tabWidth(page, titles[6])

    await strip(page).evaluate((el) => (el.scrollLeft = el.scrollWidth))
    const last = await center(page, titles[7])
    await page.mouse.click(last.x, last.y)
    await expect(strip(page).locator("[data-pane-tab]")).toHaveCount(7)
    expect(await hold(page)).toBe("")
    expect(await tabWidth(page, titles[6])).toBeCloseTo(width, 0)
  },
)

story.describe("touch", () => {
  story.use({ hasTouch: true })

  story("a tap on a close button never holds the strip", async ({ page }) => {
    const titles = [long("alpha"), long("beta"), long("gamma"), long("delta")]
    await mountStrip(page, { titles, width: 700 })
    const width = await tabWidth(page, long("gamma"))

    await closeButton(page, long("beta")).getByRole("button").tap()
    await expect(strip(page).locator(`[data-pane-tab="${long("beta")}"]`)).toHaveCount(0)
    await expect.poll(() => tabWidth(page, long("gamma"))).toBeGreaterThan(width + 1)
  })
})
