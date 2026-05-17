import { Buffer } from "node:buffer"
import * as XLSX from "xlsx"
import { seedProjects } from "../actions"
import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { e2eEmitElapsed } from "../emit"
import { applyE2eWorkosSession } from "../workos-auth"
import type { BrowserContext, Page } from "@playwright/test"

function trace(since: number, msg: string) {
  e2eEmitElapsed(since, "e2e-univer-upload", msg)
}

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

/**
 * New browser context has empty localStorage; sheet should still appear from
 * `GET /universer-api/veritly/units` + root virtual path `univer-<unitId>.xlsx`.
 */
test("persisted sheet lists after new browser context (no localStorage)", async ({
  page,
  browser,
  project,
  gotoSession,
}) => {
  const since = Date.now()
  test.setTimeout(180_000)
  trace(since, "start (timeout 180s)")

  await test.step("gotoSession + prompt", async () => {
    trace(since, "gotoSession →")
    await gotoSession()
    trace(since, "prompt visible")
  })

  const name = "e2e-univer-fresh-context.xlsx"
  const buf = minimalXlsx()
  const b64 = Buffer.from(buf).toString("base64")

  await test.step("open file tree + all files tab", async () => {
    const toggle = page.getByRole("button", { name: "Toggle file tree" })
    await expect(toggle).toBeVisible()
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()

    const panel = page.locator("#file-tree-panel")
    await expect(panel).toBeVisible()

    const treeTabs = panel.locator('[data-component="tabs"][data-variant="pill"][data-scope="filetree"]')
    await treeTabs.getByRole("tab", { name: /^all files$/i }).click()
    trace(since, "file tree ready for drop")
  })

  await test.step("drop xlsx on file tree", async () => {
    const panel = page.locator("#file-tree-panel")
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
    trace(since, "drop dispatched")
  })

  await test.step("wait first context: file row + sheet tab", async () => {
    const panel = page.locator("#file-tree-panel")
    const item = panel.getByRole("button", { name, exact: true })
    trace(since, "waiting file button in tree…")
    await expect(item).toBeVisible({ timeout: 120_000 })
    trace(since, "file row visible, clicking")
    await item.click()

    await expect(page.getByRole("tab", { name })).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText("Loading spreadsheet…")).toBeHidden({ timeout: 120_000 })
    await expect(page.getByRole("tab", { name: "Sheet1" })).toBeVisible({ timeout: 120_000 })
    trace(since, "sheet loaded in first context")
  })

  const sessionUrl = page.url()
  trace(since, `sessionUrl ${sessionUrl}`)

  let ctx: BrowserContext | undefined
  let fresh: Page | undefined

  await test.step("new browser context: seed + workos + goto same session", async () => {
    trace(since, "browser.newContext()…")
    ctx = await browser.newContext()
    fresh = await ctx.newPage()
    trace(since, "fresh page, seedProjects…")
    await seedProjects(fresh, { projectId: project.id })
    await fresh.addInitScript(() => {
      localStorage.setItem(
        "opencode.global.dat:model",
        JSON.stringify({
          recent: [{ providerID: "openai", modelID: "llama3.2:1b" }],
          user: [],
          variant: {},
        }),
      )
    })
    trace(since, "applyE2eWorkosSession…")
    await applyE2eWorkosSession(fresh)
    trace(since, `fresh.goto(${sessionUrl})…`)
    await fresh.goto(sessionUrl)
    await expect(fresh.locator(promptSelector)).toBeVisible()
    trace(since, "fresh context: prompt visible")
  })

  if (!ctx || !fresh) throw new Error("newContext/newPage did not run")
  const page2 = fresh

  await test.step("fresh context: expect Imported Workbook from server list", async () => {
    const toggle2 = page2.getByRole("button", { name: "Toggle file tree" })
    await expect(toggle2).toBeVisible()
    if ((await toggle2.getAttribute("aria-expanded")) !== "true") await toggle2.click()

    const panel2 = page2.locator("#file-tree-panel")
    await expect(panel2).toBeVisible()
    const treeTabs2 = panel2.locator('[data-component="tabs"][data-variant="pill"][data-scope="filetree"]')
    await treeTabs2.getByRole("tab", { name: /^all files$/i }).click()

    const serverListed = panel2.getByRole("button", { name: "Imported Workbook.xlsx", exact: true }).first()
    trace(since, "waiting Imported Workbook.xlsx in fresh context…")
    await expect(serverListed).toBeVisible({ timeout: 120_000 })
    trace(since, "Imported Workbook visible, click")
    await serverListed.click()

    await expect(page2.getByText("Loading spreadsheet…")).toBeHidden({ timeout: 120_000 })
    await expect(page2.getByRole("tab", { name: "Sheet1" })).toBeVisible({ timeout: 120_000 })
    trace(since, "Sheet1 visible in fresh context — done")
  })

  await ctx.close()
  trace(since, "closed extra context")
})
