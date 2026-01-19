import { test, expect } from "./fixtures"
import { modKey } from "./utils"

test("can open a file tab from the search palette", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.keyboard.press(`${modKey}+P`)

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()

  const input = dialog.getByRole("textbox").first()
  await input.fill("package.json")

  const firstItem = dialog.locator('[data-slot="list-item"]').first()
  await expect(firstItem).toBeVisible()
  await firstItem.click()

  await expect(dialog).toHaveCount(0)

  const tabs = page.locator('[data-component="tabs"][data-variant="normal"]')
  await expect(tabs).toBeVisible()
  await expect(tabs.getByRole("tab").first()).toBeVisible()
})
