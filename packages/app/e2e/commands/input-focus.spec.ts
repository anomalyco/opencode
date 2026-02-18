import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

test("ctrl+l focuses the prompt", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = page.locator(promptSelector)
  await expect(prompt).toBeVisible()

  await page.locator("main").click({ position: { x: 5, y: 5 } })
  await expect(prompt).not.toBeFocused()

  await page.keyboard.press("Control+L")
  await expect(prompt).toBeFocused()
})
