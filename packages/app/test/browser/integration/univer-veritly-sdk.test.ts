import { Buffer } from "node:buffer"
import { describe, expect, test } from "vitest"
import { useE2eStack } from "../support/use-e2e-stack"

import { useAppBrowser } from "../support/use-app-browser"
import { dropXlsx, expandFileTree, minimalXlsx, noVisibleLoadingSpreadsheet, assertSpreadsheetImportOk } from "../support/xlsx-tree"

function cellPrimitive(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "object" && v !== null && "v" in v) return String((v as { v: unknown }).v)
  return String(v)
}

/** Playwright / poll waits; Vitest budget allows Docker stack. */
const wait = 5_000

describe("univer veritly sdk (webdriver)", () => {
  useE2eStack()
  const app = useAppBrowser()

  test(
    "Veritly SDK hook edits sheet after compat import",
    async () => {
      await app.gotoSession()
      const name = "e2e-univer-sdk.xlsx"
      const b64 = Buffer.from(minimalXlsx()).toString("base64")

      await expandFileTree(app.page)
      await dropXlsx(app.page, name, b64)

      const row = app.page.locator("#file-tree-panel").getByRole("button", { name })
      await row.waitFor({ state: "visible", timeout: wait })
      await row.click()

      await app.page.getByRole("tab", { name }).waitFor({ state: "visible", timeout: wait })
      await noVisibleLoadingSpreadsheet(app.page, wait)
      await assertSpreadsheetImportOk(app.page, wait)

      const matrix = (await app.page.evaluate(() => {
        const w = window as unknown as {
          __veritlyUniverSdk?: () => {
            setRangeValues: (o: {
              range: { startRow: number; endRow: number; startColumn: number; endColumn: number }
              values: string[][]
            }) => void
            getSheetRange: (o: {
              range: { startRow: number; endRow: number; startColumn: number; endColumn: number }
            }) => unknown[][]
          }
        }
        const sdk = w.__veritlyUniverSdk?.()
        if (!sdk) throw new Error("missing window.__veritlyUniverSdk — run full browser E2E (`bun run e2e` from packages/app)")
        sdk.setRangeValues({
          range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
          values: [["sdk-e2e"]],
        })
        return sdk.getSheetRange({
          range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
        })
      })) as unknown[][]

      expect(cellPrimitive(matrix[0]?.[0])).toBe("sdk-e2e")
    },
    180_000,
  )
})
