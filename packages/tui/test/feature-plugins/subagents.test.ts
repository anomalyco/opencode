import { describe, expect, test } from "bun:test"
import { formatSubagentDuration, isSubagentActive, subagentLabel } from "../../src/feature-plugins/sidebar/subagents"

describe("subagent sidebar", () => {
  test("formats a live working duration with seconds", () => {
    expect(formatSubagentDuration(999)).toBe("0s")
    expect(formatSubagentDuration(32 * 60_000 + 14_000)).toBe("32m 14s")
    expect(formatSubagentDuration(3_600_000 + 2 * 60_000 + 5_000)).toBe("1h 2m 05s")
  })

  test("uses the agent name and falls back to the generated session title", () => {
    expect(subagentLabel({ agent: "code-architect", title: "Inspect the project" } as never)).toBe("Code Architect")
    expect(subagentLabel({ title: "Inspect the project (@bug_finder subagent)" } as never)).toBe("Bug Finder")
    expect(subagentLabel({ title: "Inspect the project" } as never)).toBe("Subagent")
  })

  test("only keeps running and retrying subagents visible", () => {
    expect(isSubagentActive({ type: "busy" })).toBe(true)
    expect(isSubagentActive({ type: "retry", attempt: 1, message: "retry", next: 0 })).toBe(true)
    expect(isSubagentActive({ type: "idle" })).toBe(false)
    expect(isSubagentActive(undefined)).toBe(false)
  })
})
