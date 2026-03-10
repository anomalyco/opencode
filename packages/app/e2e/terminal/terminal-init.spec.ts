import { test, expect } from "../fixtures"
import { promptSelector, terminalPanelSelector, terminalSelector } from "../selectors"
import { terminalToggleKey } from "../utils"

test("smoke terminal mounts and can create a second tab", async ({ page, gotoSession }) => {
  await gotoSession()

  const terminalPanel = page.locator(terminalPanelSelector)
  const terminals = page.locator(terminalSelector)
  const tabs = page.locator('#terminal-panel [data-slot="tabs-trigger"]')
  const opened = await terminalPanel.isVisible().catch(() => false)

  if (!opened) {
    await page.keyboard.press(terminalToggleKey)
  }

  await expect(terminalPanel).toBeVisible()
  await expect(terminals.first()).toBeVisible()
  await expect(terminals.first().locator("textarea")).toHaveCount(1)
  await expect(terminals).toHaveCount(1)

  // Ghostty captures a lot of keybinds when focused; move focus back
  // to the app shell before triggering `terminal.new`.
  await page.locator(promptSelector).click()
  await page.keyboard.press("Control+Alt+T")

  await expect(tabs).toHaveCount(2)
  await expect(terminals).toHaveCount(1)
  await expect(terminals.first().locator("textarea")).toHaveCount(1)
})
