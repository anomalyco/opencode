import type { Page } from "@playwright/test"
import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("../../gui-plugins/src/terminal/terminal.fixture.tsx", import.meta.url))

const mountTerminal = async (page: Page, autoFocus: boolean) => {
  await page.evaluate(
    async (input) => {
      const { mountTerminalFocus } = await import(input.fixture)
      mountTerminalFocus({ autoFocus: input.autoFocus })
    },
    { fixture, autoFocus },
  )
  const root = page.getByTestId("terminal-focus-fixture")
  await expect(root.locator('[data-component="terminal"] textarea')).toBeAttached()
  // The terminal's deferred focus and restore run on timers queued when it opened; let them run first.
  await page.evaluate(
    () => new Promise<void>((resolve) => setTimeout(() => setTimeout(() => requestAnimationFrame(() => resolve()), 0), 0)),
  )

  return root
}

story.beforeEach(async ({ mount }) => {
  // Any story loads the app styles; the fixture mounts the real terminal beside it.
  await mount("ui-line-comment--editor")
})

story("a terminal opened with a focus request keeps focus after the request is consumed", async ({ page }) => {
  const root = await mountTerminal(page, true)

  await expect(root.locator('[data-component="terminal"] textarea')).toBeFocused()
})

story("a terminal opened without a focus request leaves focus in the composer", async ({ page }) => {
  const root = await mountTerminal(page, false)

  await expect(root.getByRole("textbox", { name: "Composer", exact: true })).toBeFocused()
})
