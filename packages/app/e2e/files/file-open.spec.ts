import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

test("can open a file tab from the search palette", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.locator(promptSelector).click()
  await page.keyboard.type("/open")

  const command = page.locator('[data-slash-id="file.open"]').first()
  await expect(command).toBeVisible()
  await page.keyboard.press("Enter")

  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByPlaceholder(/search files/i) })
    .first()
  await expect(dialog).toBeVisible()

  const input = dialog.getByRole("textbox").first()
  await input.fill("package.json")

  const item = dialog.locator('[data-slot="list-item"][data-key^="file:"]').first()
  await expect(item).toBeVisible({ timeout: 30_000 })
  await item.click()

  await expect(dialog).toHaveCount(0)

  const tabs = page.locator('[data-component="tabs"][data-variant="normal"]')
  await expect(tabs.locator('[data-slot="tabs-trigger"]').first()).toBeVisible()
})
