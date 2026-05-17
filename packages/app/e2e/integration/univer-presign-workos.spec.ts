import { Buffer } from "node:buffer"
import * as XLSX from "xlsx"
import { request } from "@playwright/test"
import { WORKOS_SESSION_COOKIE_NAME } from "@veritly/auth-shared"
import { test, expect } from "../fixtures"
import { e2eAppOrigin, mintE2eSealedSessionForTenantB, mintE2eSealedSessionFromWorkos } from "../workos-auth"

function minimalXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([["e2e"]])
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))
}

const CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

function sessionCookieForRequestContext(seal: string) {
  const host = new URL(e2eAppOrigin()).hostname
  return {
    name: WORKOS_SESSION_COOKIE_NAME,
    value: seal,
    domain: host,
    path: "/",
    expires: Math.floor(Date.now() / 1000) + 3600,
    httpOnly: true,
    secure: false,
    sameSite: "Lax" as const,
  }
}

test.describe("univer presign (WorkOS staging)", () => {
  test.describe.configure({ mode: "serial" })

  test("drop xlsx through UI completes import with real wos-session", async ({ page, gotoSession }) => {
    test.setTimeout(180_000)
    await gotoSession()

    const name = "e2e-univer-presign-workos.xlsx"
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

  test("presign-upload without session returns 401", async ({ request: api }) => {
    const res = await api.post("/universer-api/stream/file/presign-upload", {
      data: { size: 10, contentType: CT },
      headers: { "Content-Type": "application/json" },
    })
    expect(res.status()).toBe(401)
  })

  test("second WorkOS user cannot import first user's exchange fileId", async () => {
    test.setTimeout(120_000)
    if (!process.env.E2E_WORKOS_TENANT_B_EMAIL?.trim()) {
      test.skip()
      return
    }

    const base = process.env.PLAYWRIGHT_BASE_URL?.trim()
    if (!base) throw new Error("PLAYWRIGHT_BASE_URL is required")

    const sealA = await mintE2eSealedSessionFromWorkos()
    const sealB = await mintE2eSealedSessionForTenantB()

    const ctxA = await request.newContext({
      baseURL: base,
      storageState: {
        cookies: [sessionCookieForRequestContext(sealA)],
        origins: [],
      },
    })
    const ctxB = await request.newContext({
      baseURL: base,
      storageState: {
        cookies: [sessionCookieForRequestContext(sealB)],
        origins: [],
      },
    })

    const buf = minimalXlsx()
    const pr = await ctxA.post("/universer-api/stream/file/presign-upload", {
      data: { size: buf.byteLength, contentType: CT },
      headers: { "Content-Type": "application/json" },
    })
    expect(pr.status()).toBe(200)
    const j = (await pr.json()) as { FileId: string; uploadUrl: string; headers: Record<string, string> }
    const put = await fetch(j.uploadUrl, { method: "PUT", headers: j.headers, body: Buffer.from(buf) })
    expect(put.ok).toBe(true)

    const imp = await ctxB.post("/universer-api/exchange/2/import", {
      data: {
        fileID: j.FileId,
        outputType: 1,
        minSheetColumnCount: 1,
        minSheetRowCount: 1,
      },
      headers: { "Content-Type": "application/json;charset=UTF-8" },
    })
    expect(imp.status()).toBe(404)

    await ctxA.dispose()
    await ctxB.dispose()
  })
})
