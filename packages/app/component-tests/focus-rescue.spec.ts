import type { Locator } from "@playwright/test"
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

    await list.getByRole("button", { name: "Two" }).focus()
    await page.keyboard.press("Enter")
    await expect(list.getByRole("button", { name: "Three" })).toBeFocused()
    expect(await ringed(list.getByRole("button", { name: "Three" }))).toBe(true)

    await page.keyboard.press("Enter")
    await expect(list.getByRole("button", { name: "One" })).toBeFocused()
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
      await expect(editor).not.toHaveAttribute("data-keyboard-focus")
    },
  )
}
