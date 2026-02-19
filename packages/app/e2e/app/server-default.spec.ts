import { test, expect } from "../fixtures"
import { serverName, serverUrl } from "../utils"
import { clickListItem, closeDialog, clickMenuItem } from "../actions"

const DEFAULT_SERVER_URL_KEY = "opencode.settings.dat:defaultServerUrl"

test("can set a default server on web", async ({ page, gotoSession }) => {
  await page.addInitScript((key: string) => {
    try {
      localStorage.removeItem(key)
    } catch {
      return
    }
  }, DEFAULT_SERVER_URL_KEY)

  await gotoSession()

  const status = page.getByRole("button", { name: "Status" })
  await expect(status).toBeVisible()
  const popover = page.locator('[data-component="popover-content"]').filter({ hasText: "Manage servers" })

  const ensurePopoverOpen = async () => {
    if (await popover.isVisible()) return
    await status.click()
    await expect(popover).toBeVisible()
  }

  await ensurePopoverOpen()
  await popover.getByRole("button", { name: "Manage servers" }).click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()

  const row = dialog.locator('[data-slot="list-item"]').filter({ hasText: serverName }).first()
  await expect(row).toBeVisible()

  const menuTrigger = row.locator('[data-slot="dropdown-menu-trigger"]').first()
  await expect(menuTrigger).toBeVisible()
  await menuTrigger.click({ force: true })

  const menu = page.locator('[data-component="dropdown-menu-content"]').first()
  await expect(menu).toBeVisible()
  await clickMenuItem(menu, /set as default/i)

  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), DEFAULT_SERVER_URL_KEY)).toBe(serverUrl)
  await expect(row.getByText("Default", { exact: true })).toBeVisible()

  await closeDialog(page, dialog)

  await ensurePopoverOpen()

  const serverRow = popover.locator("button").filter({ hasText: serverName }).first()
  await expect(serverRow).toBeVisible()
  await expect(serverRow.getByText("Default", { exact: true })).toBeVisible()
})
