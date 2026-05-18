import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { openXlsxWorkbookTab } from "../../support/xlsx-tree"
import { wdPressModW } from "../../support/wd-actions"

describe("tab close", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("mod+w closes the active file tab", async () => {
    await app.gotoSession()

    const name = `e2e-tab-close-${Date.now()}.xlsx`
    await openXlsxWorkbookTab(app.page, name)

    const tab = app.page.getByRole("tab", { name }).first()
    await tab.waitFor({ state: "visible" })
    await tab.click()
    expect(await tab.getAttribute("aria-selected")).toBe("true")

    await wdPressModW(app.page)
    await expect.poll(async () => await app.page.getByRole("tab", { name }).count()).toBe(0)
  }, 240_000)
})
