import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { openXlsxWorkbookTab } from "../../support/xlsx-tree"

describe("file open", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("opens a workbook tab from the file tree after drop", async () => {
    await app.gotoSession()

    const name = `e2e-file-open-${Date.now()}.xlsx`
    await openXlsxWorkbookTab(app.page, name)

    const wb = app.page.getByRole("tab", { name })
    await wb.waitFor({ state: "visible" })
    expect(await wb.getAttribute("aria-selected")).toBe("true")
  }, 240_000)
})
