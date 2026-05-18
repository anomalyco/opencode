import { Buffer } from "node:buffer"
import * as XLSX from "xlsx"
import type { Page } from "playwright"
import { expect } from "vitest"
import { fileTreeAllTabTriggerSelector, fileTreeToggleSelector } from "../../../e2e/selectors"
import { By, waitVisible } from "./wd-wait"

/** Minimal .xlsx for Univer / file-tree drop tests (virtual projects have no host `package.json`). */
export function minimalXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([["ok"]])
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))
}

export async function expandFileTree(page: Page) {
  const wait = 5_000
  const toggle = await waitVisible(page, By.css(fileTreeToggleSelector), wait)
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await expect.poll(async () => (await toggle.getAttribute("aria-expanded")) === "true", { timeout: wait }).toBe(true)
  await expect
    .poll(
      async () =>
        (await page.evaluate(
          () => document.getElementById("file-tree-panel")?.getBoundingClientRect().width ?? 0,
        )) > 100,
      { timeout: wait },
    )
    .toBe(true)
  await waitVisible(page, By.css("#file-tree-panel"), wait)
  const allTab = await waitVisible(page, By.css(fileTreeAllTabTriggerSelector), wait)
  await allTab.click()
}

export async function dropXlsx(page: Page, name: string, b64: string) {
  await page.evaluate((payload: { data: string; filename: string }) => {
    const panel = document.querySelector("#file-tree-panel")
    const tree = panel?.querySelector('[data-component="filetree"]')
    if (!(tree instanceof HTMLElement)) throw new Error("file tree droppable root missing")
    const raw = atob(payload.data)
    const u = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i)
    const file = new File([u], payload.filename, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    const data = new DataTransfer()
    data.items.add(file)
    const base = { bubbles: true, cancelable: true, dataTransfer: data }
    tree.dispatchEvent(new DragEvent("dragenter", base))
    tree.dispatchEvent(new DragEvent("dragover", base))
    tree.dispatchEvent(new DragEvent("drop", base))
  }, { data: b64, filename: name })
}

export async function noVisibleLoadingSpreadsheet(page: Page, ms: number) {
  const loading = page.getByText("Loading spreadsheet…")
  await expect
    .poll(
      async () => {
        const n = await loading.count()
        if (n === 0) return true
        for (let i = 0; i < n; i++) {
          if (await loading.nth(i).isVisible()) return false
        }
        return true
      },
      { timeout: ms },
    )
    .toBe(true)
}

export async function assertSpreadsheetImportOk(page: Page, ms: number) {
  await expect
    .poll(async () => (await page.getByText(/exchange import failed/i).count()) === 0, { timeout: ms })
    .toBe(true)
}

export async function openXlsxWorkbookTab(page: Page, name: string) {
  await expandFileTree(page)
  await dropXlsx(page, name, Buffer.from(minimalXlsx()).toString("base64"))
  const row = page.locator("#file-tree-panel").getByRole("button", { name })
  const wait = 5_000
  await row.waitFor({ state: "visible", timeout: wait })
  await row.click()
  await page.getByRole("tab", { name }).waitFor({ state: "visible", timeout: wait })
}

/** Workbook tab (filename) visible, loading cleared, no exchange import error. */
export async function openXlsxFromTreeReady(page: Page, name: string) {
  const wait = 5_000
  await openXlsxWorkbookTab(page, name)
  await noVisibleLoadingSpreadsheet(page, wait)
  await assertSpreadsheetImportOk(page, wait)
}
