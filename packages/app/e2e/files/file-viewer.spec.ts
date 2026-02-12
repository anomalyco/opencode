import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

test("smoke file viewer renders real file content", async ({ page, gotoSession }) => {
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

  const file = "packages/app/package.json"

  const input = dialog.getByRole("textbox").first()
  await input.fill(file)

  const item = dialog
    .locator('[data-slot="list-item"]')
    .filter({ hasText: /packages[\\/].*app[\\/].*package.json/ })
    .first()
  await expect(item).toBeVisible({ timeout: 30_000 })
  await item.click()

  await expect(dialog).toHaveCount(0)

  const tab = page.getByRole("tab", { name: "package.json" })
  await expect(tab).toBeVisible()
  await tab.click()

  const code = page.locator('[data-component="code"]').first()
  await expect(code).toBeVisible()
  await expect(code.getByText("@opencode-ai/app")).toBeVisible()
})
