import { test, expect } from "../fixtures"
import { closeDialog, openPalette } from "../actions"

test("search palette opens and closes", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openPalette(page)

  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})

test("search palette also opens with cmd+p", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openPalette(page, "P")

  await closeDialog(page, dialog)
  await expect(dialog).toHaveCount(0)
})
