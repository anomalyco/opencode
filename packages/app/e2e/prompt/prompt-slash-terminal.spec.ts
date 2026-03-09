import { test, expect } from "../fixtures"
import { promptSelector, terminalSelector } from "../selectors"

test("/terminal toggles the terminal panel", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = page.locator(promptSelector)
  const terminal = page.locator(terminalSelector)

  await expect(terminal).not.toBeVisible()

  await prompt.click()
  await page.keyboard.type("/terminal")
  await expect(page.locator('[data-slash-id="terminal.toggle"]').first()).toBeVisible()
  await page.keyboard.press("Enter")
  await expect(terminal).toBeVisible()

  await prompt.click()
  await page.keyboard.type("/terminal")
  await expect(page.locator('[data-slash-id="terminal.toggle"]').first()).toBeVisible()
  await page.keyboard.press("Enter")
  await expect(terminal).not.toBeVisible()
})
