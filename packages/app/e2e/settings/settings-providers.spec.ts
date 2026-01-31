import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { closeDialog, openSettings, clickListItem } from "../actions"

test("smoke providers settings opens provider selector", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)

  await dialog.getByRole("tab", { name: "Providers" }).click()
  await expect(dialog.getByText("Connected providers", { exact: true })).toBeVisible()
  await expect(dialog.getByText("Popular providers", { exact: true })).toBeVisible()

  await dialog.getByRole("button", { name: "Show more providers" }).click()

  const providerDialog = page.getByRole("dialog").filter({ has: page.getByPlaceholder("Search providers") })

  await expect(providerDialog).toBeVisible()
  await expect(providerDialog.getByPlaceholder("Search providers")).toBeVisible()
  await expect(providerDialog.locator('[data-slot="list-item"]').first()).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(providerDialog).toHaveCount(0)
  await expect(page.locator(promptSelector)).toBeVisible()

  const stillOpen = await dialog.isVisible().catch(() => false)
  if (!stillOpen) return

  await closeDialog(page, dialog)
})
