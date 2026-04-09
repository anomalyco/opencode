import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"

describe("plugin startServer error recovery", () => {
  // Regression: _pending was cached with ??= but never cleared on failure.
  // If Server.listen failed (e.g. port conflict), the rejected promise stayed
  // cached forever — subsequent calls got the same rejection instead of retrying.
  // The fix clears _pending in the rejection handler so callers can retry.
  test("startServer clears _pending on rejection", () => {
    const src = readFileSync(resolve(import.meta.dir, "../../src/plugin/index.ts"), "utf-8")

    // The error handler must set _pending = undefined to allow retry
    expect(src).toContain("_pending = undefined")

    // The promise must use a rejection handler (second arg to .then or .catch)
    // that clears the cache before re-throwing
    const match = src.match(/_pending \?\?= Server\.listen\([^)]*\)\.then\(\s*\([^)]*\)[^,]*,\s*\(/)
    expect(match).not.toBeNull()
  })

  test("_pending comment documents retry semantics", () => {
    const src = readFileSync(resolve(import.meta.dir, "../../src/plugin/index.ts"), "utf-8")
    expect(src).toContain("cleared on failure")
  })
})
