import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

test("smoke @mention inserts file pill token", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.locator(promptSelector).click()
  const filePattern = /packages[\\/]+app[\\/]+\s*package\.json/i

  await page.keyboard.type("@package.json")

  const suggestion = page.getByRole("button", { name: filePattern }).first()
  await expect(suggestion).toBeVisible({ timeout: 30_000 })
  await suggestion.hover()

  await page.keyboard.press("Tab")

  const pill = page.locator(`${promptSelector} [data-type="file"]`).first()
  await expect(pill).toBeVisible()
  await expect(pill).toHaveAttribute("data-path", filePattern)

  await page.keyboard.type(" ok")
  await expect(page.locator(promptSelector)).toContainText("ok")
})
