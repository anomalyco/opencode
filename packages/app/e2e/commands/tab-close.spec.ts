import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { modKey } from "../utils"

test("mod+w closes the active file tab", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.locator(promptSelector).click()
  await page.keyboard.type("/open")
  await expect(page.locator('[data-slash-id="file.open"]').first()).toBeVisible()
  await page.keyboard.press("Enter")

  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByPlaceholder(/search files/i) })
    .first()
  await expect(dialog).toBeVisible()

  await dialog.getByRole("textbox").first().fill("package.json")
  const item = dialog.locator('[data-slot="list-item"][data-key^="file:"]').first()
  await expect(item).toBeVisible({ timeout: 30_000 })
  await item.click()
  await expect(dialog).toHaveCount(0)

  const tab = page.getByRole("tab", { name: "package.json" }).first()
  await expect(tab).toBeVisible()
  await tab.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")

  await page.keyboard.press(`${modKey}+W`)
  await expect(page.getByRole("tab", { name: "package.json" })).toHaveCount(0)
})
