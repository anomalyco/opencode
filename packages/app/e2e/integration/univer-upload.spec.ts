import { Buffer } from "node:buffer"
import * as XLSX from "xlsx"
import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

function minimalXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([["ok"]])
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))
}

/**
 * Full stack: OpenCode API on PLAYWRIGHT_SERVER_PORT; Playwright webServer with
 * `PLAYWRIGHT_E2E_INFRA=univer` runs `script/dev-e2e-with-univer.ts` (MinIO + compat + Vite).
 * Quick run: `bun run test:e2e:univer` (API must already listen). Or `bun run test:e2e:local-univer` for orchestration.
 */
test("drop xlsx on file tree completes univer-compat exchange import", async ({ page, gotoSession }) => {
  test.setTimeout(180_000)

  await gotoSession()

  const name = "e2e-univer-upload.xlsx"
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

  const tab = page.getByRole("tab", { name })
  await expect(tab).toBeVisible({ timeout: 120_000 })
  await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 120_000 })

  await expect(page.getByText("Loading spreadsheet…")).toBeHidden({ timeout: 120_000 })
  await expect(page.getByRole("tab", { name: "Sheet1" })).toBeVisible({ timeout: 120_000 })
})

test("after full reload spreadsheet reloads from compat (resolved unit id)", async ({ page, gotoSession }) => {
  test.setTimeout(180_000)

  await gotoSession()

  const name = "e2e-univer-refresh.xlsx"
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

  const tab = page.getByRole("tab", { name })
  await expect(tab).toBeVisible({ timeout: 120_000 })
  await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 120_000 })

  await expect(page.getByText("Loading spreadsheet…")).toBeHidden({ timeout: 120_000 })
  await expect(page.getByRole("tab", { name: "Sheet1" })).toBeVisible({ timeout: 120_000 })

  await page.reload()
  await expect(page.locator(promptSelector)).toBeVisible()
  await expect(page.getByRole("tab", { name })).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText("Loading spreadsheet…")).toBeHidden({ timeout: 120_000 })
  await expect(page.getByRole("tab", { name: "Sheet1" })).toBeVisible({ timeout: 120_000 })
})
