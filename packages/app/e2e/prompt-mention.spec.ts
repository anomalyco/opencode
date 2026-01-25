import { test, expect } from "./fixtures"
import { promptSelector } from "./utils"

test("smoke @mention inserts file pill token", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.locator(promptSelector).click()
  const sep = process.platform === "win32" ? "\\" : "/"
  const file = ["packages", "app", "package.json"].join(sep)
  const filePattern = /packages[\\/]+app[\\/]+\s*package\.json/

  await page.keyboard.type(`@${file}`)

  const suggestion = page.getByRole("button", { name: filePattern }).first()
  await expect(suggestion).toBeVisible()
  await suggestion.hover()

  await page.keyboard.press("Tab")

  const pill = page.locator(`${promptSelector} [data-type="file"]`).first()
  await expect(pill).toBeVisible()
  await expect(pill).toHaveAttribute("data-path", filePattern)

  await page.keyboard.type(" ok")
  await expect(page.locator(promptSelector)).toContainText("ok")
})
