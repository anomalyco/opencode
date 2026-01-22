import { test, expect } from "./fixtures"
import { promptSelector } from "./utils"

test("smoke @mention inserts file pill token", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.locator(promptSelector).click()
  await page.keyboard.type("@packages/app/package.json")

  const suggestion = page.getByRole("button", { name: /packages\/app\/\s*package\.json/ }).first()
  await expect(suggestion).toBeVisible()
  await suggestion.hover()

  await page.keyboard.press("Tab")

  const pill = page.locator(`${promptSelector} [data-type="file"][data-path="packages/app/package.json"]`)
  await expect(pill).toBeVisible()

  await page.keyboard.type(" ok")
  await expect(page.locator(promptSelector)).toContainText("ok")
})
