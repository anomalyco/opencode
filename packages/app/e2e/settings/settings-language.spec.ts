import { test, expect } from "../fixtures"
import { settingsLanguageSelectSelector } from "../selectors"
import { openSettings } from "../actions"

test("smoke changing language updates settings labels", async ({ page, gotoSession }) => {
  await page.addInitScript(() => {
    localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "en" }))
  })

  await gotoSession()

  const dialog = await openSettings(page)

  const heading = dialog.getByRole("heading", { level: 2 })
  await expect(heading).toHaveText("General")

  const select = dialog.locator(settingsLanguageSelectSelector)
  await expect(select).toBeVisible()
  await select.locator('[data-slot="select-select-trigger"]').click()

  await page.locator('[data-slot="select-select-item"]').filter({ hasText: "Deutsch" }).click()

  await expect(heading).toHaveText("Allgemein")

  await select.locator('[data-slot="select-select-trigger"]').click()
  await page.locator('[data-slot="select-select-item"]').filter({ hasText: "English" }).click()
  await expect(heading).toHaveText("General")
})
