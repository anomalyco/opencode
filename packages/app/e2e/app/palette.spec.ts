import { test, expect } from "../fixtures"
import { openCommandPalette } from "../actions"
import { modKey } from "../utils"

test("command palette opens with mod+shift+p and closes", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openCommandPalette(page)

  await dialog.getByRole("textbox").first().fill("package.json")
  await expect(dialog).toContainText("No results found")

  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})

test("original mixed palette still opens with mod+p", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.keyboard.press(`${modKey}+P`)

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()

  const input = dialog.getByRole("textbox").first()
  await input.fill("package.json")
  await expect(dialog).not.toContainText("No results found")
  await expect(dialog).toContainText("package.json")
})
