import { describe, expect, test } from "bun:test"
import { timeoutOpt } from "../../bin/oc.ts"

// Regression test for: exec operations must disable Bun's native TCP timeout so that
// long-running `oc check` / `oc prompt` calls (Ralph loops, 22-commit analyses, etc.)
// are never killed mid-flight by Bun's default fetch timeout.
// See provider.ts:1324 for the same fix applied to LLM provider calls.
describe("oc.timeoutOpt", () => {
  test("exec path returns { timeout: false }", () => {
    expect(timeoutOpt("/session/abc/exec")).toEqual({ timeout: false })
    expect(timeoutOpt("/session/xyz_123/exec")).toEqual({ timeout: false })
  })

  test("tool path returns {}", () => {
    expect(timeoutOpt("/session/abc/tool")).toEqual({})
    expect(timeoutOpt("/session/abc/read")).toEqual({})
  })

  test("empty path returns {}", () => {
    expect(timeoutOpt("")).toEqual({})
  })

  test("path containing 'exec' as a substring of a different segment returns { timeout: false }", () => {
    // /exec substring match is intentional: any path segment with /exec triggers it
    // (e.g. /session/abc/exec-stream would also disable timeout — acceptable, conservative)
    expect(timeoutOpt("/session/abc/exec-stream")).toEqual({ timeout: false })
  })

  test("path with exec in query string does not match if not in path segment", () => {
    // /exec must appear in path — a query-string mention should NOT match
    // Note: the current implementation uses includes("/exec") so this documents the actual behaviour
    expect(timeoutOpt("/session/abc/tool?exec=1")).toEqual({})
  })
})
