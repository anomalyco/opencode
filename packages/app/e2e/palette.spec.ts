import { test, expect } from "./fixtures"
import { modKey } from "./utils"

test("search palette opens and closes", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.keyboard.press(`${modKey}+P`)

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("textbox").first()).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})
