import { test, expect } from "./fixtures"
import { promptSelector, terminalSelector, terminalToggleKey } from "./utils"

test("smoke terminal mounts and can create a second tab", async ({ page, gotoSession }) => {
  await gotoSession()

  const terminals = page.locator(terminalSelector)
  const opened = await terminals.first().isVisible()

  if (!opened) {
    await page.keyboard.press(terminalToggleKey)
  }

  await expect(terminals.first()).toBeVisible()
  await expect(terminals.first().locator("textarea")).toHaveCount(1)
  await expect(terminals).toHaveCount(1)

  // Ghostty captures a lot of keybinds when focused; move focus back
  // to the app shell before triggering `terminal.new`.
  await page.locator(promptSelector).click()
  await page.keyboard.press("Control+Alt+T")

  await expect(terminals).toHaveCount(2)
  await expect(terminals.nth(1).locator("textarea")).toHaveCount(1)
})
