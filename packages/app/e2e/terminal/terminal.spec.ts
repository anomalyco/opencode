import { test, expect } from "../fixtures"
import { terminalPanelSelector, terminalSelector } from "../selectors"
import { terminalToggleKey } from "../utils"

test("terminal panel can be toggled", async ({ page, gotoSession }) => {
  await gotoSession()

  const terminalPanel = page.locator(terminalPanelSelector)
  const terminal = page.locator(terminalSelector)
  const initiallyOpen = await terminalPanel.isVisible().catch(() => false)
  if (initiallyOpen) {
    await page.keyboard.press(terminalToggleKey)
    await expect(terminalPanel).toHaveCount(0)
  }

  await page.keyboard.press(terminalToggleKey)
  await expect(terminalPanel).toBeVisible()
  await expect(terminal).toBeVisible()
})
