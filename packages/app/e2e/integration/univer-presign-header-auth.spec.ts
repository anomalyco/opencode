import { Buffer } from "node:buffer"
import * as XLSX from "xlsx"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"

const HEADER = "x-veritly-univer-test-user"
const CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

async function routUniverUser(page: Page, user: string | null) {
  await page.unroute("**/universer-api/**")
  if (!user) return
  await page.route("**/universer-api/**", (route) =>
    route.continue({
      headers: { ...route.request().headers(), [HEADER]: user },
    }),
  )
}

function minimalXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([["e2e"]])
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))
}

const headerAuthE2e = process.env.PLAYWRIGHT_UNIVER_HEADER_AUTH?.trim() === "1"
const describeHeader = headerAuthE2e ? test.describe : test.describe.skip

describeHeader(
  headerAuthE2e
    ? "univer presign header auth"
    : "univer presign header auth (skipped — set PLAYWRIGHT_UNIVER_HEADER_AUTH=1, see test:e2e:univer-presign)",
  () => {
    test.describe.configure({ mode: "serial" })

    test("drop xlsx through UI completes import when identity header is injected", async ({ page, gotoSession }) => {
      test.setTimeout(180_000)
      await routUniverUser(page, "e2e-route-tenant-one")
      await gotoSession()

      const name = "e2e-univer-header-auth.xlsx"
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

    test("clearing injected identity blocks presign-upload (401)", async ({ page, gotoSession }) => {
      test.setTimeout(120_000)
      await routUniverUser(page, "e2e-route-tenant-one")
      await gotoSession()
      await routUniverUser(page, null)

      const base = new URL(page.url()).origin
      const st = await page.evaluate(
        async ({ origin, ct }) => {
          const r = await fetch(`${origin}/universer-api/stream/file/presign-upload`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ size: 10, contentType: ct }),
          })
          return r.status
        },
        { origin: base, ct: CT },
      )
      expect(st).toBe(401)
    })

    test("second tenant cannot import first tenant exchange fileId", async ({ page, gotoSession }) => {
      test.setTimeout(120_000)
      await routUniverUser(page, "e2e-route-tenant-alpha")
      await gotoSession()

      const base = new URL(page.url()).origin
      const b64 = Buffer.from(minimalXlsx()).toString("base64")

      const fileId = await page.evaluate(
        async ({ origin, ct, b64: payload }) => {
          const raw = atob(payload)
          const u = new Uint8Array(raw.length)
          for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i)
          const pr = await fetch(`${origin}/universer-api/stream/file/presign-upload`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ size: u.byteLength, contentType: ct }),
          })
          if (pr.status !== 200) throw new Error(`presign ${pr.status}`)
          const j = (await pr.json()) as { FileId: string; uploadUrl: string; headers: Record<string, string> }
          const put = await fetch(j.uploadUrl, {
            method: "PUT",
            credentials: "omit",
            headers: j.headers,
            body: u,
          })
          if (!put.ok) throw new Error(`put ${put.status}`)
          return j.FileId
        },
        { origin: base, ct: CT, b64 },
      )

      await routUniverUser(page, "e2e-route-tenant-beta")
      const imp = await page.evaluate(
        async ({ origin, fid }) => {
          const r = await fetch(`${origin}/universer-api/exchange/2/import`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json;charset=UTF-8" },
            body: JSON.stringify({
              fileID: fid,
              outputType: 1,
              minSheetColumnCount: 1,
              minSheetRowCount: 1,
            }),
          })
          return r.status
        },
        { origin: base, fid: fileId },
      )
      expect(imp).toBe(404)
    })
})
