import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

test("ctrl+l focuses the prompt", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = page.locator(promptSelector)
  await expect(prompt).toBeVisible()

  await prompt.evaluate((node) => {
    if (node instanceof HTMLElement) node.blur()
  })
  await expect(prompt).not.toBeFocused()

  await page.keyboard.press("Control+L")
  await expect(prompt).toBeFocused()
})
