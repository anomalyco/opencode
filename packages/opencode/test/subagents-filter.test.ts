import { describe, test, expect } from "bun:test"
import type { Agent } from "../src/agent/agent"
import { filterSubagents } from "../src/tool/task"
import { Wildcard } from "../src/util/wildcard"

describe("filterSubagents", () => {
  const mockAgents = [
    { name: "general", mode: "subagent" },
    { name: "code-reviewer", mode: "subagent" },
    { name: "orchestrator-fast", mode: "subagent" },
    { name: "orchestrator-slow", mode: "subagent" },
  ] as Agent.Info[]

  test("returns all agents when subagents config is empty", () => {
    const result = filterSubagents(mockAgents, {})
    expect(result).toHaveLength(4)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer", "orchestrator-fast", "orchestrator-slow"])
  })

  test("excludes agents with explicit false", () => {
    const result = filterSubagents(mockAgents, { "code-reviewer": false })
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["general", "orchestrator-fast", "orchestrator-slow"])
  })

  test("includes agents with explicit true", () => {
    const result = filterSubagents(mockAgents, {
      "code-reviewer": true,
      general: false,
    })
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["code-reviewer", "orchestrator-fast", "orchestrator-slow"])
  })

  test("supports wildcard patterns to exclude", () => {
    const result = filterSubagents(mockAgents, { "orchestrator-*": false })
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer"])
  })

  test("supports wildcard patterns to include with specific exclusion", () => {
    const result = filterSubagents(mockAgents, {
      "*": true,
      "orchestrator-fast": false,
    })
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer", "orchestrator-slow"])
  })

  test("longer pattern takes precedence", () => {
    const result = filterSubagents(mockAgents, {
      "orchestrator-*": false,
      "orchestrator-fast": true,
    })
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer", "orchestrator-fast"])
  })
})

describe("Wildcard.all for subagents", () => {
  test("returns undefined when no match", () => {
    expect(Wildcard.all("code-reviewer", {})).toBeUndefined()
  })

  test("returns false for explicit false", () => {
    expect(Wildcard.all("code-reviewer", { "code-reviewer": false })).toBe(false)
  })

  test("returns true for explicit true", () => {
    expect(Wildcard.all("code-reviewer", { "code-reviewer": true })).toBe(true)
  })

  test("matches wildcard patterns", () => {
    expect(Wildcard.all("orchestrator-fast", { "orchestrator-*": false })).toBe(false)
    expect(Wildcard.all("orchestrator-slow", { "orchestrator-*": false })).toBe(false)
    expect(Wildcard.all("general", { "orchestrator-*": false })).toBeUndefined()
  })

  test("longer pattern takes precedence over shorter", () => {
    expect(
      Wildcard.all("orchestrator-fast", {
        "orchestrator-*": false,
        "orchestrator-fast": true,
      }),
    ).toBe(true)
    expect(
      Wildcard.all("orchestrator-slow", {
        "orchestrator-*": false,
        "orchestrator-fast": true,
      }),
    ).toBe(false)
  })
})
