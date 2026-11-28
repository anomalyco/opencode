import type { Locator } from "@playwright/test"
import { expect, sourceURL, test } from "../../lab/playwright/test"

const fixture = sourceURL(new URL("./focus-rescue.fixture.tsx", import.meta.url))

const rescue = sourceURL(new URL("../../ui/src/context/focus-rescue.tsx", import.meta.url))

test.describe("scopes", () => {
  test.beforeEach(async ({ mount, page }) => {
    // Any page loads the app's styles; the fixture mounts its scopes beside it.
    await mount("ui-line-comment--editor")
    await page.evaluate(async (fixture) => {
      const { mountFocusRescue } = await import(fixture)
      mountFocusRescue()
    }, fixture)
  })

  const ringed = (locator: Locator) => locator.evaluate((element) => element.matches(":focus-visible"))

  test("moves focus to the next item, or to the previous one after the last", async ({ page }) => {
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

  test("leaves the item that takes over without a ring when no key moved focus there", async ({ page }) => {
    const list = page.getByTestId("list")

    // Typing and Enter are not navigation, and the item got focus from code.
    await page.keyboard.press("a")
    await list.getByRole("button", { name: "Two" }).focus()
    await page.keyboard.press("Enter")
    await expect(list.getByRole("button", { name: "Three" })).toBeFocused()
    expect(await ringed(list.getByRole("button", { name: "Three" }))).toBe(false)
  })

  test("returns focus to what had it before when a scope is left empty", async ({ page }) => {
    await page.getByTestId("opener").focus()
    await page.getByTestId("toasts").getByRole("button", { name: "Toast" }).focus()
    await page.keyboard.press("Enter")

    await expect(page.getByTestId("opener")).toBeFocused()
  })

  test("never moves focus into a tab list", async ({ page }) => {
    await page.getByTestId("opener").focus()
    await page.getByTestId("strip").getByRole("tab", { name: "Tab B" }).focus()
    await page.keyboard.press("Enter")

    // Tab A and Add tab are still there, but a tab list's tabs select themselves on focus.
    await expect(page.getByTestId("opener")).toBeFocused()
  })
})

for (const action of ["Steer", "Remove"]) {
  test(
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
