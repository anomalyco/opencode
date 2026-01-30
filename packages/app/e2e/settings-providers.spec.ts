import { test, expect } from "./fixtures"
import { modKey, promptSelector } from "./utils"

test("smoke providers settings opens provider selector", async ({ page, gotoSession }) => {
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

  await page.keyboard.press("Escape")
  const closed = await dialog
    .waitFor({ state: "detached", timeout: 1500 })
    .then(() => true)
    .catch(() => false)
  if (closed) return

  await page.keyboard.press("Escape")
  const closedSecond = await dialog
    .waitFor({ state: "detached", timeout: 1500 })
    .then(() => true)
    .catch(() => false)
  if (closedSecond) return

  await page.locator('[data-component="dialog-overlay"]').click({ position: { x: 5, y: 5 } })
  await expect(dialog).toHaveCount(0)
})
