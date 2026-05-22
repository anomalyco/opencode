import { Buffer } from "node:buffer"
import { describe, expect, test } from "vitest"
import type { Page } from "playwright"
import { useE2eStack } from "../support/use-e2e-stack"
import { useAppBrowser } from "../support/use-app-browser"
import { pollOk } from "../support/wd-wait"
import {
  assertSpreadsheetImportOk,
  dropXlsx,
  expandFileTree,
  minimalXlsx,
  noVisibleLoadingSpreadsheet,
} from "../support/xlsx-tree"

const wait = 5_000
const pyTimeout = 180_000

type RunResult = { exitCode?: number; output?: string; error?: string }

async function pollPyodideHook(page: Page, budgetMs: number) {
  await pollOk(
    async () =>
      (await page.evaluate(
        () =>
          typeof (window as Window & { __veritlyE2ePyodide?: { run?: unknown } }).__veritlyE2ePyodide?.run ===
          "function",
      )) === true,
    budgetMs,
  )
}

async function pollUniverBridge(page: Page, budgetMs: number) {
  await pollOk(
    async () =>
      (await page.evaluate(
        () =>
          typeof (window as Window & { __veritlyUniverBridge?: { call?: unknown } }).__veritlyUniverBridge?.call ===
          "function",
      )) === true,
    budgetMs,
  )
}

async function runPyodide(page: Page, code: string, timeoutMs: number): Promise<RunResult> {
  return page.evaluate(
    async (payload: { code: string; timeoutMs: number }) => {
      const hook = (window as Window & { __veritlyE2ePyodide?: { run: (c: string, t: number) => Promise<RunResult> } })
        .__veritlyE2ePyodide
      if (!hook || typeof hook.run !== "function") {
        return { error: "Pyodide e2e hook missing" }
      }
      try {
        return await hook.run(payload.code, payload.timeoutMs)
      } catch (e) {
        return { error: String(e) }
      }
    },
    { code, timeoutMs },
  ) as Promise<RunResult>
}

function expectPyodideOk(run: RunResult) {
  if (run.error) throw new Error(run.error)
  expect(run.exitCode).toBe(0)
  if (!run.output?.trim()) throw new Error("Pyodide produced empty output")
}

function parseLastJsonLine<T>(output: string): T {
  const lines = output.trim().split("\n").filter((l) => l.trim().startsWith("{"))
  if (lines.length === 0) throw new Error(`no JSON line in Pyodide output:\n${output}`)
  return JSON.parse(lines[lines.length - 1]!) as T
}

type AppBrowser = { page: Page; gotoSession: (sessionId?: string) => Promise<void> }

async function openSpreadsheet(app: AppBrowser) {
  await app.gotoSession()
  const page = app.page
  const name = "e2e-pyodide-bridge.xlsx"
  const b64 = Buffer.from(minimalXlsx()).toString("base64")
  await expandFileTree(page)
  await dropXlsx(page, name, b64)
  const row = page.locator("#file-tree-panel").getByRole("button", { name })
  await row.waitFor({ state: "visible", timeout: wait })
  await row.click()
  await page.getByRole("tab", { name }).waitFor({ state: "visible", timeout: wait })
  await noVisibleLoadingSpreadsheet(page, wait)
  await assertSpreadsheetImportOk(page, wait)
  await pollUniverBridge(page, 60_000)
  await pollPyodideHook(page, 90_000)
}

describe("pyodide ↔ univer bridge (webdriver)", () => {
  useE2eStack()
  const app = useAppBrowser()

  test(
    "Python UniverSDK connect uses __veritlyUniverBridge (get_active_document)",
    async () => {
      await openSpreadsheet(app)
      const run = await runPyodide(
        app.page,
        [
          "import json",
          "from veritly_univer_sdk import UniverSDK",
          "",
          "async def main():",
          "    sdk = UniverSDK()",
          "    await sdk.connect()",
          "    doc = await sdk.get_active_document()",
          "    print(json.dumps({\"unitId\": doc.unitId, \"sheetId\": doc.sheetId, \"sheetName\": doc.sheetName}))",
        ].join("\n"),
        pyTimeout,
      )
      expectPyodideOk(run)
      const parsed = parseLastJsonLine<{ unitId: string; sheetId: string; sheetName: string }>(run.output!)
      expect(parsed.unitId.length).toBeGreaterThan(0)
      expect(parsed.sheetId.length).toBeGreaterThan(0)
      expect(parsed.sheetName.length).toBeGreaterThan(0)
    },
    240_000,
  )

  test(
    "Python set_range + get_range round-trip through JS bridge",
    async () => {
      await openSpreadsheet(app)
      const marker = `py_bridge_${Date.now()}`
      const run = await runPyodide(
        app.page,
        [
          "import json",
          "from veritly_univer_sdk import RangeRect, UniverSDK",
          "",
          "async def main():",
          "    sdk = UniverSDK()",
          "    await sdk.connect()",
          "    doc = await sdk.get_active_document()",
          "    await sdk.set_range(",
          "        RangeRect(0, 0, 0, 0),",
          `        [[${JSON.stringify(marker)}]],`,
          "        sheet_id=doc.sheetId,",
          "    )",
          "    rows = await sdk.get_range(RangeRect(0, 0, 0, 0), sheet_id=doc.sheetId)",
          "    cell = rows[0][0] if rows and rows[0] else None",
          "    print(json.dumps({\"marker\": " + JSON.stringify(marker) + ", \"cell\": cell}))",
        ].join("\n"),
        pyTimeout,
      )
      expectPyodideOk(run)
      const parsed = parseLastJsonLine<{ marker: string; cell: unknown }>(run.output!)
      expect(parsed.marker).toBe(marker)
      const cell =
        parsed.cell === null || parsed.cell === undefined
          ? ""
          : typeof parsed.cell === "object" && parsed.cell !== null && "v" in (parsed.cell as object)
            ? String((parsed.cell as { v: unknown }).v)
            : String(parsed.cell)
      expect(cell).toBe(marker)
    },
    240_000,
  )

  test(
    "Python get_sheet reads cells written via bridge",
    async () => {
      await openSpreadsheet(app)
      const run = await runPyodide(
        app.page,
        [
          "import json",
          "from veritly_univer_sdk import RangeRect, UniverSDK",
          "",
          "async def main():",
          "    sdk = UniverSDK()",
          "    await sdk.connect()",
          "    doc = await sdk.get_active_document()",
          "    await sdk.set_range(RangeRect(0, 1, 0, 1), [[\"h1\", \"h2\"], [1, 2]], sheet_id=doc.sheetId)",
          "    block = await sdk.get_sheet(sheet_id=doc.sheetId, max_row=2, max_col=2)",
          "    print(json.dumps({\"r0c0\": block[0][0], \"r1c1\": block[1][1]}))",
        ].join("\n"),
        pyTimeout,
      )
      expectPyodideOk(run)
      const parsed = parseLastJsonLine<{ r0c0: unknown; r1c1: unknown }>(run.output!)
      const norm = (v: unknown) =>
        v === null || v === undefined
          ? ""
          : typeof v === "object" && v !== null && "v" in (v as object)
            ? String((v as { v: unknown }).v)
            : String(v)
      expect(norm(parsed.r0c0)).toBe("h1")
      expect(norm(parsed.r1c1)).toBe("2")
    },
    240_000,
  )

  test(
    "Python UniverSDK.connect fails when spreadsheet bridge is absent",
    async () => {
      await app.page.goto(`${app.origin}/`)
      await pollPyodideHook(app.page, 90_000)
      const run = await runPyodide(
        app.page,
        [
          "import json",
          "from veritly_univer_sdk import UniverSDK",
          "",
          "async def main():",
          "    sdk = UniverSDK()",
          "    try:",
          "        await sdk.connect()",
          "        print(json.dumps({\"connected\": True}))",
          "    except Exception as e:",
          "        print(json.dumps({\"connected\": False, \"error\": str(e)}))",
        ].join("\n"),
        pyTimeout,
      )
      expectPyodideOk(run)
      const parsed = parseLastJsonLine<{ connected: boolean; error?: string }>(run.output!)
      expect(parsed.connected).toBe(false)
      expect(parsed.error?.toLowerCase()).toContain("bridge")
    },
    240_000,
  )
})
