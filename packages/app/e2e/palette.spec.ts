import { test, expect } from "@playwright/test"
import { gotoSession, modKey, promptSelector } from "./utils"

test("search palette opens and closes", async ({ page }) => {
  await gotoSession(page)
  await expect(page.locator(promptSelector)).toBeVisible()

  await page.keyboard.press(`${modKey}+P`)

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("textbox").first()).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})
