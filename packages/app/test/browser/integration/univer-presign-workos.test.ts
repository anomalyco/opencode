import { Buffer } from "node:buffer"
import { describe, expect, test } from "vitest"
import { useE2eStack } from "../support/use-e2e-stack"

import { WORKOS_SESSION_COOKIE_NAME } from "@veritly/auth-shared"
import { e2eAppOrigin, mintE2eSealedSessionForTenantB, mintE2eSealedSessionFromWorkos } from "../../../e2e/workos-auth"
import { useAppBrowser } from "../support/use-app-browser"
import { dropXlsx, expandFileTree, minimalXlsx, noVisibleLoadingSpreadsheet, assertSpreadsheetImportOk } from "../support/xlsx-tree"

const CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/** Playwright / poll waits; Vitest budget allows Docker stack. */
const wait = 5_000

describe("univer presign workos (webdriver)", () => {
  useE2eStack()
  const app = useAppBrowser()

  test(
    "drop xlsx through UI completes import with real wos-session",
    async () => {
      await app.gotoSession()
      const name = "e2e-univer-presign-workos.xlsx"
      const b64 = Buffer.from(minimalXlsx()).toString("base64")

      await expandFileTree(app.page)
      await dropXlsx(app.page, name, b64)

      const row = app.page.locator("#file-tree-panel").getByRole("button", { name })
      await row.waitFor({ state: "visible", timeout: wait })
      await row.click()

      await app.page.getByRole("tab", { name }).waitFor({ state: "visible", timeout: wait })
      await noVisibleLoadingSpreadsheet(app.page, wait)
      await assertSpreadsheetImportOk(app.page, wait)
    },
    180_000,
  )

  test("presign-upload without session returns 401", async () => {
    const base = e2eAppOrigin().replace(/\/$/, "")
    const res = await fetch(`${base}/universer-api/stream/file/presign-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size: 10, contentType: CT }),
    })
    expect(res.status).toBe(401)
  })

  test.skipIf(!process.env.E2E_WORKOS_TENANT_B_EMAIL?.trim())(
    "second WorkOS user cannot import first user's exchange fileId",
    async () => {
      const baseRaw = process.env.PLAYWRIGHT_BASE_URL?.trim()
      if (!baseRaw) throw new Error("PLAYWRIGHT_BASE_URL is required")

      const base = baseRaw.replace(/\/$/, "")

      const sealA = await mintE2eSealedSessionFromWorkos()
      const sealB = await mintE2eSealedSessionForTenantB()

      const cookie = `${WORKOS_SESSION_COOKIE_NAME}=${encodeURIComponent(sealA)}`
      const buf = minimalXlsx()
      const pr = await fetch(`${base}/universer-api/stream/file/presign-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ size: buf.byteLength, contentType: CT }),
      })
      expect(pr.status).toBe(200)
      const j = (await pr.json()) as { FileId: string; uploadUrl: string; headers: Record<string, string> }
      const put = await fetch(j.uploadUrl, { method: "PUT", headers: j.headers, body: Buffer.from(buf) })
      expect(put.ok).toBe(true)

      const cookieB = `${WORKOS_SESSION_COOKIE_NAME}=${encodeURIComponent(sealB)}`
      const imp = await fetch(`${base}/universer-api/exchange/2/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=UTF-8", Cookie: cookieB },
        body: JSON.stringify({
          fileID: j.FileId,
          outputType: 1,
          minSheetColumnCount: 1,
          minSheetRowCount: 1,
        }),
      })
      expect(imp.status).toBe(404)
    },
    180_000,
  )
})
