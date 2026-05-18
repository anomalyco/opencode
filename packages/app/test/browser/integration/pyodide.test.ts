import { describe, expect, test } from "vitest"
import { useE2eStack } from "../support/use-e2e-stack"

import { pollOk } from "../support/wd-wait"
import { useAppBrowser } from "../support/use-app-browser"

describe("pyodide hook (webdriver)", () => {
  useE2eStack()
  const app = useAppBrowser()

  test(
    "Pyodide print output is captured as a string via executeAsyncScript",
    async () => {
      await app.page.goto(`${app.origin}/`)

      await pollOk(
        async () =>
          (await app.page.evaluate(
            () => typeof (window as Window & { __veritlyE2ePyodide?: { run?: unknown } }).__veritlyE2ePyodide?.run ===
              "function",
          )) === true,
        90_000,
      )

      const marker = `e2e_py_${Date.now()}`
      const userSnippet = [
        "import json",
        "from veritly_univer_sdk import RangeRect",
        "r = RangeRect(0, 0, 1, 1)",
        `print(json.dumps({"marker": ${JSON.stringify(marker)}, "startRow": r.startRow}))`,
      ].join("\n")

      type RunResult = { exitCode?: number; output?: string; error?: string }
      const run = (await app.page.evaluate(
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
        { code: userSnippet, timeoutMs: 180_000 },
      )) as RunResult

      if (run.error) throw new Error(run.error)
      expect(run.exitCode).toBe(0)
      const pythonStdout = run.output
      if (!pythonStdout) throw new Error("missing output")
      expect(pythonStdout).toContain(marker)
      expect(pythonStdout).toContain('"startRow": 0')
    },
    240_000,
  )
})
