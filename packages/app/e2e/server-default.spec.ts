import { test, expect } from "./fixtures"
import { serverName, serverUrl } from "./utils"

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

  const menu = row.locator('[data-component="icon-button"]').last()
  await menu.click()
  await page.getByRole("menuitem", { name: "Set as default" }).click()

  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), DEFAULT_SERVER_URL_KEY)).toBe(serverUrl)
  await expect(row.getByText("Default", { exact: true })).toBeVisible()

  await page.keyboard.press("Escape")
  const closed = await dialog
    .waitFor({ state: "detached", timeout: 1500 })
    .then(() => true)
    .catch(() => false)

  if (!closed) {
    await page.keyboard.press("Escape")
    const closedSecond = await dialog
      .waitFor({ state: "detached", timeout: 1500 })
      .then(() => true)
      .catch(() => false)

    if (!closedSecond) {
      await page.locator('[data-component="dialog-overlay"]').click({ position: { x: 5, y: 5 } })
      await expect(dialog).toHaveCount(0)
    }
  }

  await ensurePopoverOpen()

  const serverRow = popover.locator("button").filter({ hasText: serverName }).first()
  await expect(serverRow).toBeVisible()
  await expect(serverRow.getByText("Default", { exact: true })).toBeVisible()
})
