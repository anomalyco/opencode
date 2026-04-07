import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"

describe("bash shellEnv _server caching", () => {
  const src = readFileSync(resolve(import.meta.dir, "../../src/tool/bash.ts"), "utf-8")

  // Regression: _server was typed as `typeof import(...) | undefined` and
  // assigned with `_server ??= await import(...)`. The ??= across an await
  // boundary meant two concurrent shellEnv calls could both enter the import
  // path before either resolved — each awaited its own import.
  // The fix caches the Promise itself so concurrent callers share one import.
  test("_server is typed as Promise (not resolved module)", () => {
    // Must cache the promise, not the resolved module
    expect(src).toMatch(/let _server:\s*Promise<typeof import/)
  })

  test("_server assignment does not use await before ??=", () => {
    // The old pattern `_server ??= await import(...)` is racy.
    // The new pattern caches the promise: `_server ??= import(...)`
    // then awaits separately: `const server = await _server`
    expect(src).not.toMatch(/_server \?\?= await import/)
    expect(src).toContain("_server ??= import(")
  })
})
