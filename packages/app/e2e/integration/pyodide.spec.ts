import { test, expect } from "../fixtures"

/**
 * TypeScript-only Playwright test: no Python test runner.
 *
 * Pyodide runs inside the browser; `page.evaluate` returns a serializable value
 * to Node — here we treat combined stdout/stderr as one string (same idea as
 * grabbing printed output, but without a dedicated DOM node in this app).
 *
 * Full stack: `bun run test:e2e:local`. Quick loop: `bun run test:e2e:pyodide`.
 */
test("Pyodide print output is captured as a string via page.evaluate", async ({ page }) => {
  test.setTimeout(240_000)

  await page.goto("/", { waitUntil: "load" })

  await page.waitForFunction(() => typeof window.__veritlyE2ePyodide?.run === "function", {
    timeout: 90_000,
  })

  const marker = `e2e_py_${Date.now()}`
  const userSnippet = [
    "import json",
    "from veritly_univer_sdk import RangeRect",
    "r = RangeRect(0, 0, 1, 1)",
    `print(json.dumps({"marker": ${JSON.stringify(marker)}, "startRow": r.startRow}))`,
  ].join("\n")

  const run = await page.evaluate(
    async (payload: { code: string; timeoutMs: number }) => {
      const hook = window.__veritlyE2ePyodide
      if (!hook?.run) throw new Error("Pyodide e2e hook missing")
      return hook.run(payload.code, payload.timeoutMs)
    },
    { code: userSnippet, timeoutMs: 180_000 },
  )

  expect(run.exitCode).toBe(0)

  const pythonStdout = run.output
  expect(pythonStdout).toContain(marker)
  expect(pythonStdout).toContain('"startRow": 0')
})
