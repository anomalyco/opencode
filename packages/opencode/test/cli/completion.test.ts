import { describe, expect, test } from "bun:test"
import { isShellCompletionInvocation } from "../../src/cli/completion"

describe("isShellCompletionInvocation", () => {
  test("matches the yargs completion command", () => {
    expect(isShellCompletionInvocation(["completion"])).toBe(true)
    expect(isShellCompletionInvocation(["--pure", "completion"])).toBe(true)
  })

  test("matches yargs completion probe calls", () => {
    expect(isShellCompletionInvocation(["--get-yargs-completions", "opencode"])).toBe(true)
  })

  test("ignores normal cli invocations", () => {
    expect(isShellCompletionInvocation([])).toBe(false)
    expect(isShellCompletionInvocation(["run", "fix this"])).toBe(false)
    expect(isShellCompletionInvocation(["./completion"])).toBe(false)
  })
})
