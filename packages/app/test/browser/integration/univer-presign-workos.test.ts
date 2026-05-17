import { Buffer } from "node:buffer"
import * as XLSX from "xlsx"
import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../support/use-full-app-stack"

import { By } from "selenium-webdriver"
import { WORKOS_SESSION_COOKIE_NAME } from "@veritly/auth-shared"
import { fileTreeAllTabTriggerSelector, fileTreeToggleSelector } from "../../../e2e/selectors"
import { e2eAppOrigin, mintE2eSealedSessionForTenantB, mintE2eSealedSessionFromWorkos } from "../../../e2e/workos-auth"
import { waitVisible } from "../support/wd-wait"
import { useAppWebDriver } from "../support/use-app-webdriver"

function minimalXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([["e2e"]])
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))
}

async function expandFileTree(driver: import("selenium-webdriver").WebDriver) {
  const toggle = await waitVisible(driver, By.css(fileTreeToggleSelector))
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await driver.wait(async () => (await toggle.getAttribute("aria-expanded")) === "true", 10_000)
  await driver.wait(
    async () =>
      Number(
        await driver.executeScript(
          `return document.getElementById("file-tree-panel")?.getBoundingClientRect().width ?? 0`,
        ),
      ) > 100,
    15_000,
  )
  const panel = await waitVisible(driver, By.css("#file-tree-panel"))
  const allTab = await waitVisible(driver, By.css(fileTreeAllTabTriggerSelector))
  await allTab.click()
  return panel
}

async function dropXlsx(driver: import("selenium-webdriver").WebDriver, name: string, b64: string) {
  await driver.executeScript(
    `
    const payload = arguments[0];
    const panel = document.querySelector("#file-tree-panel");
    const tree = panel?.querySelector('[data-component="filetree"]');
    if (!(tree instanceof HTMLElement)) throw new Error("file tree droppable root missing");
    const raw = atob(payload.data);
    const u = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
    const file = new File([u], payload.filename, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const data = new DataTransfer();
    data.items.add(file);
    const ev = { bubbles: true, cancelable: true, dataTransfer: data };
    tree.dispatchEvent(new DragEvent("dragenter", ev));
    tree.dispatchEvent(new DragEvent("dragover", ev));
    tree.dispatchEvent(new DragEvent("drop", ev));
  `,
    { data: b64, filename: name },
  )
}

const CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

describe("univer presign workos (webdriver)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test(
    "drop xlsx through UI completes import with real wos-session",
    async () => {
      await app.gotoSession()
      const name = "e2e-univer-presign-workos.xlsx"
      const b64 = Buffer.from(minimalXlsx()).toString("base64")

      await expandFileTree(app.driver)
      await dropXlsx(app.driver, name, b64)

      const row = await waitVisible(app.driver, By.xpath(`//*[@id="file-tree-panel"]//button[normalize-space(.)="${name}"]`), 120_000)
      await row.click()

      await waitVisible(app.driver, By.xpath(`//button[@role="tab" and normalize-space(.)="${name}"]`), 120_000)
      await app.driver.wait(
        async () => {
          const els = await app.driver.findElements(By.xpath(`//*[contains(., "Loading spreadsheet…")]`))
          if (els.length === 0) return true
          for (const el of els) {
            if (await el.isDisplayed()) return false
          }
          return true
        },
        120_000,
      )
      await waitVisible(app.driver, By.xpath(`//button[@role="tab" and normalize-space(.)="Sheet1"]`), 120_000)
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
    120_000,
  )
})
