import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

test("shift+enter inserts a newline without submitting", async ({ page, gotoSession }) => {
  await gotoSession()

  await expect(page).toHaveURL(/\/session\/?$/)

  const prompt = page.locator(promptSelector)
  await prompt.click()
  await page.keyboard.type("line one")
  await page.keyboard.press("Shift+Enter")
  await page.keyboard.type("line two")

  await expect(page).toHaveURL(/\/session\/?$/)
  await expect(prompt).toContainText("line one")
  await expect(prompt).toContainText("line two")
})
