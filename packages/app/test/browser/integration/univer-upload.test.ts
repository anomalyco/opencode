import { Buffer } from "node:buffer"
import { describe, expect, test } from "vitest"
import { useE2eStack } from "../support/use-e2e-stack"

import { By, waitVisible } from "../support/wd-wait"
import { promptSelector } from "../../../e2e/selectors"
import { openProjectSession, useAppBrowser } from "../support/use-app-browser"
import { dropXlsx, expandFileTree, minimalXlsx, noVisibleLoadingSpreadsheet, assertSpreadsheetImportOk } from "../support/xlsx-tree"

/** Playwright / poll waits only; Vitest test budget stays high for Docker stack. */
const wait = 5_000

describe("univer upload", () => {
  useE2eStack()
  const app = useAppBrowser()

  test(
    "drop xlsx on file tree completes univer-compat exchange import",
    async () => {
      await app.gotoSession()
      const name = "e2e-univer-upload.xlsx"
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
    60_000,
  )

  test(
    "after full reload spreadsheet reloads from compat (resolved unit id)",
    async () => {
      await app.gotoSession()
      const name = "e2e-univer-refresh.xlsx"
      const b64 = Buffer.from(minimalXlsx()).toString("base64")

      await expandFileTree(app.page)
      await dropXlsx(app.page, name, b64)

      const row = app.page.locator("#file-tree-panel").getByRole("button", { name })
      await row.waitFor({ state: "visible", timeout: wait })
      await row.click()

      await app.page.getByRole("tab", { name }).waitFor({ state: "visible", timeout: wait })
      await noVisibleLoadingSpreadsheet(app.page, wait)
      await assertSpreadsheetImportOk(app.page, wait)

      await app.page.reload()
      await waitVisible(app.page, By.css(promptSelector), wait)
      await app.page.getByRole("tab", { name }).waitFor({ state: "visible", timeout: wait })
      await noVisibleLoadingSpreadsheet(app.page, wait)
      await assertSpreadsheetImportOk(app.page, wait)
    },
    60_000,
  )

  test(
    "persisted sheet lists after new browser context (no localStorage)",
    async () => {
      const created = await app.sdk.session.create({})
      if (!created.data) throw new Error("session create failed")
      const sid = created.data.id
      // `gotoSession()` without id stays on `/:project/session` (no `/session/:id` segment);
      // `sessionIDFromUrl` only works after that segment exists (e.g. explicit create + navigate).
      await app.gotoSession(sid)
      const name = "e2e-univer-fresh-context.xlsx"
      const b64 = Buffer.from(minimalXlsx()).toString("base64")

      await expandFileTree(app.page)
      await dropXlsx(app.page, name, b64)

      const row = app.page.locator("#file-tree-panel").getByRole("button", { name })
      await row.waitFor({ state: "visible", timeout: wait })
      await row.click()
      await noVisibleLoadingSpreadsheet(app.page, wait)
      await assertSpreadsheetImportOk(app.page, wait)

      await app.page.context().clearCookies()
      await app.page.evaluate(() => localStorage.clear())
      await openProjectSession(app.page, app.origin, app.project.id, sid)

      await expandFileTree(app.page)

      const imported = app.page.locator("#file-tree-panel").getByRole("button", { name: "Imported Workbook.xlsx" })
      await imported.waitFor({ state: "visible", timeout: wait })
      await imported.click()
      await noVisibleLoadingSpreadsheet(app.page, wait)
      await assertSpreadsheetImportOk(app.page, wait)
    },
    60_000,
  )
})
