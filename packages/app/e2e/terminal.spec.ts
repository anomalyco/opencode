import { test, expect } from "./fixtures"
import { terminalSelector, terminalToggleKey } from "./utils"

test("terminal panel can be toggled", async ({ page, gotoSession }) => {
  await gotoSession()

  const terminal = page.locator(terminalSelector)
  const initiallyOpen = await terminal.isVisible()
  if (initiallyOpen) {
    await page.keyboard.press(terminalToggleKey)
    await expect(terminal).toHaveCount(0)
  }

  await page.keyboard.press(terminalToggleKey)
  await expect(terminal).toBeVisible()
})
