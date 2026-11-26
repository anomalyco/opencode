import type { Locator, Page } from "@playwright/test"
import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./focus-rescue.fixture.tsx", import.meta.url))

const rescue = sourceURL(new URL("../../ui/src/context/focus-rescue.tsx", import.meta.url))

story.describe("scopes", () => {
  story.beforeEach(async ({ mount, page }) => {
    // Any story loads the app's styles; the fixture mounts its scopes beside it.
    await mount("ui-line-comment--editor")
    await page.evaluate(async (fixture) => {
      const { mountFocusRescue } = await import(fixture)
      mountFocusRescue()
    }, fixture)
  })

  const ringed = (locator: Locator) => locator.evaluate((element) => element.matches(":focus-visible"))

  story("moves focus to the next item, or to the previous one after the last", async ({ page }) => {
    const list = page.getByTestId("list")

    // Tab moves focus to the item, so the item that takes over shows its ring.
    await list.getByRole("button", { name: "One" }).press("Tab")
    await expect(list.getByRole("button", { name: "Two" })).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(list.getByRole("button", { name: "Three" })).toBeFocused()
    expect(await ringed(list.getByRole("button", { name: "Three" }))).toBe(true)

    await page.keyboard.press("Enter")
    await expect(list.getByRole("button", { name: "One" })).toBeFocused()
  })

  story("leaves the item that takes over without a ring when no key moved focus there", async ({ page }) => {
    const list = page.getByTestId("list")

    // Typing and Enter are not navigation, and the item got focus from code.
    await page.keyboard.press("a")
    await list.getByRole("button", { name: "Two" }).focus()
    await page.keyboard.press("Enter")
    await expect(list.getByRole("button", { name: "Three" })).toBeFocused()
    expect(await ringed(list.getByRole("button", { name: "Three" }))).toBe(false)
  })

  story("returns focus to what had it before when a scope is left empty", async ({ page }) => {
    await page.getByTestId("opener").focus()
    await page.getByTestId("toasts").getByRole("button", { name: "Toast" }).focus()
    await page.keyboard.press("Enter")

    await expect(page.getByTestId("opener")).toBeFocused()
  })

  story("never moves focus into a tab list", async ({ page }) => {
    await page.getByTestId("opener").focus()
    await page.getByTestId("strip").getByRole("tab", { name: "Tab B" }).focus()
    await page.keyboard.press("Enter")

    // Tab A and Add tab are still there, but a tab list's tabs select themselves on focus.
    await expect(page.getByTestId("opener")).toBeFocused()
  })

  // What has focus: a test id, a button's text, or "page" when focus rests on nothing.
  const focused = (page: Page) =>
    page.evaluate(() => {
      const active = document.activeElement

      return !active || active === document.body ? "page" : (active.getAttribute("data-testid") ?? active.textContent)
    })

  story(
    "gives focus to the scroll area, and scrolls nothing, when the only item left is out of view",
    async ({ page }) => {
      const scroller = page.getByTestId("scroller")

      await scroller.getByRole("button", { name: "Near" }).focus()
      await page.keyboard.press("Enter")

      // Far is the next item, 800 px down. Focus on it would scroll it into view.
      await expect.poll(() => focused(page)).toBe("scroller")
      expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0)
    },
  )

  story("moves no focus when what had it last is still there and can still take it", async ({ page }) => {
    const scroller = page.getByTestId("scroller")

    // A click in a scroll area gives it focus as a whole, and a click on the bare page takes focus away again.
    await scroller.click({ position: { x: 8, y: 64 } })
    await expect(scroller).toBeFocused()
    await page.mouse.click(4, (page.viewportSize()?.height ?? 600) - 4)
    await expect.poll(() => focused(page)).toBe("page")

    // The toggle takes no focus, and the panel it shows changes the page around the scroll area.
    await page.getByTestId("panel").click()
    await expect(page.getByTestId("side")).toBeVisible()
    expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0)
    expect(await focused(page)).toBe("page")
  })
})

for (const action of ["Steer", "Remove"]) {
  story(
    `composer takes focus without a ring after a click on ${action} removes the last queued prompt`,
    async ({ mount, page }) => {
      const root = await mount("session-composer-docks--queue-one")
      await page.evaluate(async (rescue) => {
        const { installFocusRescue } = await import(rescue)
        installFocusRescue()
      }, rescue)

      const row = root.locator('[data-component="session-queue-row"]')

      await row.hover()
      await row.getByRole("button", { name: action }).click()

      const editor = root.locator('[data-component="session-composer-dock"] [contenteditable="true"]')

      await expect(editor).toBeFocused()
    },
  )
}
