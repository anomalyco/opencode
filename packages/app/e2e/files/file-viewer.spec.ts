import { test, expect } from "../fixtures"
import { openPalette, clickListItem } from "../actions"

test("smoke file viewer renders real file content", async ({ page, gotoSession }) => {
  await gotoSession()

  const sep = process.platform === "win32" ? "\\" : "/"
  const file = ["packages", "app", "package.json"].join(sep)

  const dialog = await openPalette(page)

  const input = dialog.getByRole("textbox").first()
  await input.fill(file)

  await clickListItem(dialog, { text: /packages.*app.*package.json/ })

  await expect(dialog).toHaveCount(0)

  const tab = page.getByRole("tab", { name: "package.json" })
  await expect(tab).toBeVisible()
  await tab.click()

  const code = page.locator('[data-component="code"]').first()
  await expect(code).toBeVisible()
  await expect(code.getByText("@opencode-ai/app")).toBeVisible()
})
