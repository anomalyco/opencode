import { describe, expect, test } from "bun:test"
import {
  formatUnknownRunAgentError,
  resolveRequestedRunAgent,
} from "../../../src/cli/cmd/run/agent-flag"

describe("resolveRequestedRunAgent", () => {
  const agents = [
    { name: "Sisyphus - ultraworker", mode: "primary" },
    { name: "sisyphus", mode: "primary" },
    { name: "explore", mode: "subagent" },
  ]

  test("matches exact registered names", () => {
    const result = resolveRequestedRunAgent("sisyphus", agents)
    expect(result).toEqual({ ok: true, name: "sisyphus" })
  })

  test("matches registered names case-insensitively", () => {
    const result = resolveRequestedRunAgent("sisyphus - ULTRAWORKER", agents)
    expect(result).toEqual({ ok: true, name: "Sisyphus - ultraworker" })
  })

  test("fails closed on unknown names", () => {
    const result = resolveRequestedRunAgent("not-an-agent", agents)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("not_found")
    expect(formatUnknownRunAgentError("not-an-agent", result)).toContain("Registered primary agents")
    expect(formatUnknownRunAgentError("not-an-agent", result)).not.toContain("Falling back")
  })

  test("rejects subagents", () => {
    const result = resolveRequestedRunAgent("explore", agents)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("subagent")
  })
})
