import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../support/use-full-app-stack"

import { useAppWebDriver } from "../support/use-app-webdriver"

describe("pyodide hook (webdriver)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test(
    "Pyodide print output is captured as a string via executeAsyncScript",
    async () => {
      await app.driver.get(`${app.origin}/`)

      await app.driver.wait(
        async () =>
          (await app.driver.executeScript(`return typeof window.__veritlyE2ePyodide?.run === "function"`)) === true,
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
      const run = (await app.driver.executeAsyncScript(
        `
        const cb = arguments[arguments.length - 1];
        const payload = arguments[0];
        const hook = window.__veritlyE2ePyodide;
        if (!hook || typeof hook.run !== "function") {
          cb({ error: "Pyodide e2e hook missing" });
          return;
        }
        hook.run(payload.code, payload.timeoutMs).then(function (r) { cb(r); }).catch(function (e) {
          cb({ error: String(e) });
        });
      `,
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
