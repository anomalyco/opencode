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

      const matrix = (await app.page.evaluate(async () => {
        const w = window as unknown as {
          __veritlyUniverBridge?: { call: (payload: string) => Promise<string> }
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
        const bridge = w.__veritlyUniverBridge
        if (!bridge) {
          throw new Error("missing window.__veritlyUniverBridge — run full browser E2E (`bun run e2e` from packages/app)")
        }
        const setRaw = await bridge.call(
          JSON.stringify({
            id: "e2e-set",
            op: "set_range",
            params: {
              range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
              values: [["sdk-e2e"]],
            },
          }),
        )
        const setResp = JSON.parse(setRaw) as { ok: boolean; error?: string }
        if (!setResp.ok) throw new Error(setResp.error ?? "set_range failed")

        const getRaw = await bridge.call(
          JSON.stringify({
            id: "e2e-get",
            op: "get_range",
            params: {
              range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
            },
          }),
        )
        const getResp = JSON.parse(getRaw) as { ok: boolean; result?: unknown[][]; error?: string }
        if (!getResp.ok) throw new Error(getResp.error ?? "get_range failed")
        return getResp.result ?? []
      })) as unknown[][]

      expect(cellPrimitive(matrix[0]?.[0])).toBe("sdk-e2e")
    },
    180_000,
  )
})
