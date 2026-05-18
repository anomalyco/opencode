import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { clickMenuItem, closeDialog } from "../../../../e2e/actions"
import { serverNamePattern, serverUrls } from "../../../../e2e/utils"

const DEFAULT_SERVER_URL_KEY = "opencode.settings.dat:defaultServerUrl"

describe("default server", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("can set a default server on web", async () => {
    await app.page.addInitScript(
      (key: string) => {
        try {
          localStorage.removeItem(key)
        } catch {
          return
        }
      },
      DEFAULT_SERVER_URL_KEY,
    )

    await app.gotoSession()

    const status = app.page.getByRole("button", { name: "Status" })
    await status.waitFor({ state: "visible" })
    const popover = app.page
      .locator('[data-component="popover-content"]')
      .filter({ hasText: "Manage servers" })

    const open = async () => {
      if (await popover.isVisible()) return
      await status.click()
      await popover.waitFor({ state: "visible" })
    }

    await open()
    await popover.getByRole("button", { name: "Manage servers" }).click()

    const dialog = app.page.getByRole("dialog")
    await dialog.waitFor({ state: "visible" })

    await dialog.getByText(serverNamePattern()).first().waitFor({ state: "visible" })

    const trigger = dialog.locator('[data-slot="dropdown-menu-trigger"]').first()
    await trigger.waitFor({ state: "visible" })
    await trigger.click({ force: true })

    const menu = app.page.locator('[data-component="dropdown-menu-content"]').first()
    await menu.waitFor({ state: "visible" })
    await clickMenuItem(menu, /set as default/i)

    await expect
      .poll(async () => {
        const v = await app.page.evaluate(
          (key: string) => localStorage.getItem(key),
          DEFAULT_SERVER_URL_KEY,
        )
        return v ? serverUrls().includes(v) : false
      }, { timeout: 20_000 })
      .toBe(true)

    await dialog.getByText("Default", { exact: true }).waitFor({ state: "visible" })

    await closeDialog(app.page, dialog)

    await open()

    const serverRow = popover.locator("button").filter({ hasText: serverNamePattern() }).first()
    await serverRow.waitFor({ state: "visible" })
    await serverRow.getByText("Default", { exact: true }).waitFor({ state: "visible" })
  })
})
