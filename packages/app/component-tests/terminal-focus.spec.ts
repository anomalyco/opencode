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

story("disposing a terminal invalidates its retained quote anchor", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountTerminalQuote } = await import(fixture)
    await mountTerminalQuote()
  }, fixture)
  const root = page.getByTestId("terminal-quote-fixture")
  await root.getByRole("button", { name: "Select output", exact: true }).click()
  await page.getByRole("toolbar", { name: "quote.actions", exact: true }).getByRole("button").click()
  await expect(root.getByLabel("Quoted output", { exact: true })).toHaveText("Retained terminal output")
  await expect(root.getByLabel("Quote placement", { exact: true })).toHaveText("Source")
  await root.getByRole("button", { name: "Dispose source", exact: true }).click()

  await expect(root.getByTestId("terminal-quote-source")).toHaveCount(0)
  await expect(root.getByLabel("Quote placement", { exact: true })).toHaveText("Tile")
  await expect(root.getByLabel("Quoted output", { exact: true })).toHaveText("Retained terminal output")
})
