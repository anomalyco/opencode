import { test, expect } from "@playwright/test"
import { gotoSession, promptSelector, terminalSelector, terminalToggleKey } from "./utils"

test("terminal panel can be toggled", async ({ page }) => {
  await gotoSession(page)
  await expect(page.locator(promptSelector)).toBeVisible()

  const terminal = page.locator(terminalSelector)
  const initiallyOpen = await terminal.isVisible()
  if (initiallyOpen) {
    await page.keyboard.press(terminalToggleKey)
    await expect(terminal).toHaveCount(0)
  }

  await page.keyboard.press(terminalToggleKey)
  await expect(terminal).toBeVisible()
})
