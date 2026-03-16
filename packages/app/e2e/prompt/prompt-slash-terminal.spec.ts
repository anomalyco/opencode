import { test, expect } from "../fixtures"
import { waitTerminalReady } from "../actions"
import { promptSelector, terminalSelector } from "../selectors"

test("/terminal toggles the terminal panel", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = page.locator(promptSelector)
  const terminal = page.locator(terminalSelector)
  const slash = page.locator('[data-slash-id="terminal.toggle"]').first()

  await expect(terminal).not.toBeVisible()

  await prompt.fill("/terminal")
  await expect(slash).toBeVisible()
  await page.keyboard.press("Enter")
  await waitTerminalReady(page, { term: terminal })

  // Terminal panel retries focus (immediate, RAF, 120ms, 240ms) after opening,
  // which can steal focus from the prompt and prevent fill() from triggering
  // the slash popover. Re-attempt click+fill until all retries are exhausted
  // and the popover appears.
  await expect
    .poll(
      async () => {
        await prompt.click().catch(() => false)
        await prompt.fill("/terminal").catch(() => false)
        return slash.isVisible().catch(() => false)
      },
      { timeout: 10_000 },
    )
    .toBe(true)
  await page.keyboard.press("Enter")
  await expect(terminal).not.toBeVisible()
})
