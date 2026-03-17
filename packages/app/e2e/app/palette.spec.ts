import { test, expect } from "../fixtures"
import { openPalette } from "../actions"
import { promptSelector } from "../selectors"

test("search palette opens and closes", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openPalette(page)

  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})

test("palette selection returns focus to the prompt", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = page.locator(promptSelector)
  await prompt.click()
  await page.keyboard.type("hello")

  const dialog = await openPalette(page)
  await dialog.getByRole("textbox").fill("Toggle review")
  await dialog.locator('[data-slot="list-item"]').first().click()

  await expect(dialog).toHaveCount(0)
  await expect(prompt).toBeFocused()

  await page.keyboard.type("world")
  await expect(prompt).toContainText("helloworld")
})
