import { test, expect } from "../fixtures"
import { modKey, settingsLanguageSelectSelector } from "../utils"

test("smoke changing language updates settings labels", async ({ page, gotoSession }) => {
  await page.addInitScript(() => {
    localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "en" }))
  })

  await gotoSession()

  const dialog = page.getByRole("dialog")

  await page.keyboard.press(`${modKey}+Comma`).catch(() => undefined)

  const opened = await dialog
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false)

  if (!opened) {
    await page.getByRole("button", { name: "Settings" }).first().click()
    await expect(dialog).toBeVisible()
  }

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
