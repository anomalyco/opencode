import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"

describe("session routes emitter type safety", () => {
  const src = readFileSync(resolve(import.meta.dir, "../../src/server/routes/session.ts"), "utf-8")

  // Regression: the emitter fn returned `Promise<T> | undefined` with
  // `.catch(() => undefined as any)`. Callers had to use optional chaining
  // (`?.catch`) and the `as any` cast disabled type checking on the return.
  // The fix makes fn always return `Promise<void>` for consistent await.
  test("emitter fn always returns Promise<void>", () => {
    // Must not contain the old `as any` cast pattern
    expect(src).not.toContain("undefined as any")

    // The fn signature should declare Promise<void> return type
    const sig = src.match(/const fn = \(state:[^)]*\):\s*Promise<void>/)
    expect(sig).not.toBeNull()
  })

  test("emitter fn uses Promise.resolve for no-op path (not undefined)", () => {
    // The no-op branch must return Promise.resolve() not undefined
    expect(src).toContain("Promise.resolve()")
  })

  // Regression: emitter rejection handler was `() => {}` which silently
  // swallowed errors. External ToolPart updates could fail without any
  // indication. The fix logs the error via the route-level logger.
  test("emitter fn logs errors instead of silently swallowing", () => {
    // The rejection handler must reference log.warn (not be empty)
    expect(src).toMatch(/\.then\(\s*\(\) => \{\},\s*\(err\)/)
    expect(src).toContain('log.warn("external part update failed"')
  })

  // Regression: emit.fn() was called without `void` prefix in synchronous
  // callbacks (Bus subscriber, metadata callback). The returned Promise was
  // neither awaited nor voided, causing unhandled rejection if updatePart failed.
  test("fire-and-forget emit.fn calls use void prefix", () => {
    // The PartDelta subscriber must use `void emit.fn(`
    const delta = src.match(/Bus\.subscribe\(MessageV2\.Event\.PartDelta[\s\S]*?void emit\.fn\(/)
    expect(delta).not.toBeNull()

    // The metadata callback must use `void emit.fn(`
    const meta = src.match(/metadata\([^)]*\)\s*\{[^}]*void emit\.fn\(/)
    expect(meta).not.toBeNull()
  })
})
