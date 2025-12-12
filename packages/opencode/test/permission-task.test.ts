import { describe, test, expect } from "bun:test"
import type { Agent } from "../src/agent/agent"
import { filterSubagents } from "../src/tool/task"
import { Wildcard } from "../src/util/wildcard"

describe("filterSubagents - permission.task filtering", () => {
  const mockAgents = [
    { name: "general", mode: "subagent" },
    { name: "code-reviewer", mode: "subagent" },
    { name: "orchestrator-fast", mode: "subagent" },
    { name: "orchestrator-slow", mode: "subagent" },
  ] as Agent.Info[]

  test("returns all agents when permissions config is empty", () => {
    const result = filterSubagents(mockAgents, {})
    expect(result).toHaveLength(4)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer", "orchestrator-fast", "orchestrator-slow"])
  })

  test("excludes agents with explicit deny", () => {
    const result = filterSubagents(mockAgents, { "code-reviewer": "deny" })
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["general", "orchestrator-fast", "orchestrator-slow"])
  })

  test("includes agents with explicit allow", () => {
    const result = filterSubagents(mockAgents, {
      "code-reviewer": "allow",
      general: "deny",
    })
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["code-reviewer", "orchestrator-fast", "orchestrator-slow"])
  })

  test("includes agents with ask permission (user approval is runtime behavior)", () => {
    const result = filterSubagents(mockAgents, {
      "code-reviewer": "ask",
      general: "deny",
    })
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["code-reviewer", "orchestrator-fast", "orchestrator-slow"])
  })

  test("includes agents with undefined permission (default allow)", () => {
    const result = filterSubagents(mockAgents, {
      general: "deny",
    })
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["code-reviewer", "orchestrator-fast", "orchestrator-slow"])
  })

  test("supports wildcard patterns with deny", () => {
    const result = filterSubagents(mockAgents, { "orchestrator-*": "deny" })
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer"])
  })

  test("supports wildcard patterns with allow", () => {
    const result = filterSubagents(mockAgents, {
      "*": "allow",
      "orchestrator-fast": "deny",
    })
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer", "orchestrator-slow"])
  })

  test("supports wildcard patterns with ask", () => {
    const result = filterSubagents(mockAgents, {
      "orchestrator-*": "ask",
    })
    expect(result).toHaveLength(4)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer", "orchestrator-fast", "orchestrator-slow"])
  })

  test("longer pattern takes precedence over shorter pattern", () => {
    const result = filterSubagents(mockAgents, {
      "orchestrator-*": "deny",
      "orchestrator-fast": "allow",
    })
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer", "orchestrator-fast"])
  })

  test("edge case: all agents denied", () => {
    const result = filterSubagents(mockAgents, { "*": "deny" })
    expect(result).toHaveLength(0)
    expect(result).toEqual([])
  })

  test("edge case: mixed patterns with multiple wildcards", () => {
    const result = filterSubagents(mockAgents, {
      "*": "ask",
      "orchestrator-*": "deny",
      "orchestrator-fast": "allow",
    })
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer", "orchestrator-fast"])
  })
})

describe("filterSubagents - visible property filtering", () => {
  test("excludes agents with visible: false", () => {
    const agents = [
      { name: "general", mode: "subagent", visible: false },
      { name: "code-reviewer", mode: "subagent", visible: true },
      { name: "orchestrator", mode: "subagent" },
    ] as Agent.Info[]

    const result = filterSubagents(agents, {})
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.name)).toEqual(["code-reviewer", "orchestrator"])
  })

  test("includes agents with visible: true", () => {
    const agents = [
      { name: "general", mode: "subagent", visible: true },
      { name: "code-reviewer", mode: "subagent", visible: true },
    ] as Agent.Info[]

    const result = filterSubagents(agents, {})
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer"])
  })

  test("includes agents with visible: undefined (default visible)", () => {
    const agents = [
      { name: "general", mode: "subagent" },
      { name: "code-reviewer", mode: "subagent", visible: undefined },
    ] as Agent.Info[]

    const result = filterSubagents(agents, {})
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer"])
  })

  test("visible: false takes precedence over permission allow", () => {
    const agents = [
      { name: "general", mode: "subagent", visible: false },
      { name: "code-reviewer", mode: "subagent", visible: true },
    ] as Agent.Info[]

    const result = filterSubagents(agents, { general: "allow", "code-reviewer": "allow" })
    expect(result).toHaveLength(1)
    expect(result.map((a) => a.name)).toEqual(["code-reviewer"])
  })

  test("visible: false combined with permission deny excludes agent", () => {
    const agents = [
      { name: "general", mode: "subagent", visible: false },
      { name: "code-reviewer", mode: "subagent", visible: true },
    ] as Agent.Info[]

    const result = filterSubagents(agents, { general: "deny", "code-reviewer": "deny" })
    expect(result).toHaveLength(0)
  })

  test("edge case: all agents have visible: false", () => {
    const agents = [
      { name: "general", mode: "subagent", visible: false },
      { name: "code-reviewer", mode: "subagent", visible: false },
    ] as Agent.Info[]

    const result = filterSubagents(agents, {})
    expect(result).toHaveLength(0)
    expect(result).toEqual([])
  })

  test("mixed visible states with permissions", () => {
    const agents = [
      { name: "general", mode: "subagent", visible: true },
      { name: "code-reviewer", mode: "subagent", visible: false },
      { name: "orchestrator-fast", mode: "subagent" },
      { name: "orchestrator-slow", mode: "subagent", visible: false },
    ] as Agent.Info[]

    const result = filterSubagents(agents, {
      "orchestrator-fast": "deny",
    })
    expect(result).toHaveLength(1)
    expect(result.map((a) => a.name)).toEqual(["general"])
  })
})

describe("Wildcard.all for permission.task", () => {
  test("returns undefined when no match", () => {
    expect(Wildcard.all("code-reviewer", {})).toBeUndefined()
  })

  test("returns deny for explicit deny", () => {
    expect(Wildcard.all("code-reviewer", { "code-reviewer": "deny" })).toBe("deny")
  })

  test("returns allow for explicit allow", () => {
    expect(Wildcard.all("code-reviewer", { "code-reviewer": "allow" })).toBe("allow")
  })

  test("returns ask for explicit ask", () => {
    expect(Wildcard.all("code-reviewer", { "code-reviewer": "ask" })).toBe("ask")
  })

  test("matches wildcard patterns with deny", () => {
    expect(Wildcard.all("orchestrator-fast", { "orchestrator-*": "deny" })).toBe("deny")
    expect(Wildcard.all("orchestrator-slow", { "orchestrator-*": "deny" })).toBe("deny")
    expect(Wildcard.all("general", { "orchestrator-*": "deny" })).toBeUndefined()
  })

  test("matches wildcard patterns with allow", () => {
    expect(Wildcard.all("orchestrator-fast", { "orchestrator-*": "allow" })).toBe("allow")
    expect(Wildcard.all("orchestrator-slow", { "orchestrator-*": "allow" })).toBe("allow")
  })

  test("matches wildcard patterns with ask", () => {
    expect(Wildcard.all("orchestrator-fast", { "orchestrator-*": "ask" })).toBe("ask")
    expect(Wildcard.all("code-reviewer", { "*": "ask" })).toBe("ask")
  })

  test("longer pattern takes precedence over shorter with mixed permissions", () => {
    expect(
      Wildcard.all("orchestrator-fast", {
        "orchestrator-*": "deny",
        "orchestrator-fast": "allow",
      }),
    ).toBe("allow")
    expect(
      Wildcard.all("orchestrator-slow", {
        "orchestrator-*": "deny",
        "orchestrator-fast": "allow",
      }),
    ).toBe("deny")
  })

  test("longer pattern takes precedence with ask permission", () => {
    expect(
      Wildcard.all("orchestrator-fast", {
        "orchestrator-*": "ask",
        "orchestrator-fast": "deny",
      }),
    ).toBe("deny")
    expect(
      Wildcard.all("orchestrator-slow", {
        "orchestrator-*": "ask",
        "orchestrator-fast": "deny",
      }),
    ).toBe("ask")
  })

  test("matches global wildcard", () => {
    expect(Wildcard.all("any-agent", { "*": "allow" })).toBe("allow")
    expect(Wildcard.all("any-agent", { "*": "deny" })).toBe("deny")
    expect(Wildcard.all("any-agent", { "*": "ask" })).toBe("ask")
  })
})
