import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { promptSelector } from "../../../../e2e/selectors"
import { modKey } from "../../../../e2e/utils"
import { openXlsxFromTreeReady } from "../../support/xlsx-tree"

describe("file viewer", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("spreadsheet workbook tab is visible after xlsx drop", async () => {
    await app.gotoSession()
    const name = `e2e-viewer-${Date.now()}.xlsx`
    await openXlsxFromTreeReady(app.page, name)

    const tab = app.page.getByRole("tab", { name })
    await tab.waitFor({ state: "visible" })
    await tab.click()
    expect(await tab.getAttribute("aria-selected")).toBe("true")
  })

  test("cmd+f finds in page while prompt is focused (spreadsheet session)", async () => {
    await app.gotoSession()
    const name = `e2e-viewer-find-${Date.now()}.xlsx`
    await openXlsxFromTreeReady(app.page, name)

    await app.page.locator(promptSelector).click()
    await app.page.keyboard.press(`${modKey}+f`)

    const findInput = app.page.getByPlaceholder("Find")
    await findInput.waitFor({ state: "visible", timeout: 15_000 })
    await expect
      .poll(async () => findInput.evaluate((el) => document.activeElement === el))
      .toBe(true)
  })

  test("cmd+f finds in page after clicking sheet tab", async () => {
    await app.gotoSession()
    const name = `e2e-viewer-find2-${Date.now()}.xlsx`
    await openXlsxFromTreeReady(app.page, name)

    await app.page.getByRole("tab", { name }).click()
    await app.page.keyboard.press(`${modKey}+f`)

    const findInput = app.page.getByPlaceholder("Find")
    await findInput.waitFor({ state: "visible", timeout: 15_000 })
    await expect
      .poll(async () => findInput.evaluate((el) => document.activeElement === el))
      .toBe(true)
  })
})
