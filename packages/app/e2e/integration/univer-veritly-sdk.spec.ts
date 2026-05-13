import { Buffer } from "node:buffer"
import * as XLSX from "xlsx"
import { test, expect } from "../fixtures"

function minimalXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([["seed"]])
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))
}

function cellPrimitive(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "object" && v !== null && "v" in v) return String((v as { v: unknown }).v)
  return String(v)
}

/**
 * Same infra as `univer-upload.spec.ts`: `PLAYWRIGHT_E2E_INFRA=univer` → Testcontainers MinIO + univer-compat + Vite.
 * Univer runs in Chromium (not its own Docker image). `window.__veritlyUniverSdk` exists in dev builds — use it to drive
 * `@opencode-ai/univer-sdk` without fragile canvas DOM selectors.
 */
test("Veritly SDK hook edits sheet after compat import", async ({ page, gotoSession }) => {
  test.setTimeout(180_000)

  await gotoSession()

  const name = "e2e-univer-sdk.xlsx"
  const buf = minimalXlsx()
  const b64 = Buffer.from(buf).toString("base64")

  const toggle = page.getByRole("button", { name: "Toggle file tree" })
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()

  const panel = page.locator("#file-tree-panel")
  await expect(panel).toBeVisible()

  const treeTabs = panel.locator('[data-component="tabs"][data-variant="pill"][data-scope="filetree"]')
  await treeTabs.getByRole("tab", { name: /^all files$/i }).click()

  const dt = await page.evaluateHandle(
    (payload: { data: string; filename: string }) => {
      const raw = atob(payload.data)
      const u = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i)
      const file = new File([u], payload.filename, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      const data = new DataTransfer()
      data.items.add(file)
      return data
    },
    { data: b64, filename: name },
  )

  await page.dispatchEvent("#file-tree-panel", "drop", { dataTransfer: dt })

  const item = panel.getByRole("button", { name, exact: true })
  await expect(item).toBeVisible({ timeout: 120_000 })
  await item.click()

  await expect(page.getByRole("tab", { name })).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText("Loading spreadsheet…")).toBeHidden({ timeout: 120_000 })
  await expect(page.getByRole("tab", { name: "Sheet1" })).toBeVisible({ timeout: 120_000 })

  const matrix = await page.evaluate(() => {
    const w = window as Window & {
      __veritlyUniverSdk?: () => {
        setRangeValues(input: {
          range: { startRow: number; endRow: number; startColumn: number; endColumn: number }
          values: string[][]
        }): void
        getSheetRange(input: {
          sheetId?: string
          range: { startRow: number; endRow: number; startColumn: number; endColumn: number }
        }): unknown[][]
      }
    }
    const sdk = w.__veritlyUniverSdk?.()
    if (!sdk) throw new Error("missing window.__veritlyUniverSdk — use Vite dev / PLAYWRIGHT_E2E_INFRA=univer")

    sdk.setRangeValues({
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      values: [["sdk-e2e"]],
    })
    return sdk.getSheetRange({
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    })
  })

  expect(cellPrimitive(matrix[0]?.[0])).toBe("sdk-e2e")
})
