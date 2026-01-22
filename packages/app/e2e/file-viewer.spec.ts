import { test, expect } from "./fixtures"
import { modKey } from "./utils"

test("smoke file viewer renders real file content", async ({ page, gotoSession }) => {
  await gotoSession()

  const sep = process.platform === "win32" ? "\\" : "/"
  const file = ["packages", "app", "package.json"].join(sep)

  await page.keyboard.press(`${modKey}+P`)

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()

  const input = dialog.getByRole("textbox").first()
  await input.fill(file)

  const fileItem = dialog
    .locator(
      '[data-slot="list-item"][data-key^="file:"][data-key*="packages"][data-key*="app"][data-key$="package.json"]',
    )
    .first()
  await expect(fileItem).toBeVisible()
  await fileItem.click()

  await expect(dialog).toHaveCount(0)

  const tab = page.getByRole("tab", { name: "package.json" })
  await expect(tab).toBeVisible()
  await tab.click()

  const code = page.locator('[data-component="code"]').first()
  await expect(code).toBeVisible()
  await expect(code.getByText("@opencode-ai/app")).toBeVisible()
})
