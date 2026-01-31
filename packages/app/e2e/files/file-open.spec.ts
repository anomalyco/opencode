import { test, expect } from "../fixtures"
import { openPalette } from "../actions"

test("can open a file tab from the search palette", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openPalette(page)

  const input = dialog.getByRole("textbox").first()
  await input.fill("package.json")

  const fileItem = dialog.locator('[data-slot="list-item"][data-key^="file:"]').first()
  await expect(fileItem).toBeVisible()
  await fileItem.click()

  await expect(dialog).toHaveCount(0)

  const tabs = page.locator('[data-component="tabs"][data-variant="normal"]')
  await expect(tabs.locator('[data-slot="tabs-trigger"]').first()).toBeVisible()
})
