import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { closeDialog, openSettings } from "../../../../e2e/actions"

describe("settings smoke", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("smoke settings dialog opens, switches tabs, closes", async () => {
    await app.gotoSession()
    const page = app.page

    const dialog = await openSettings(page)

    await dialog.getByRole("tab", { name: "Shortcuts" }).click()
    await dialog.getByRole("button", { name: "Reset to defaults" }).waitFor({ state: "visible" })
    await dialog.getByPlaceholder("Search shortcuts").waitFor({ state: "visible" })

    await closeDialog(page, dialog)
    expect(await page.locator('[role="dialog"]').count()).toBe(0)
  })
})
