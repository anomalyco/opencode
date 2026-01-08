import { describe, test, expect } from "bun:test"
import { Wildcard } from "../../src/util/wildcard"

describe("Task tool subagents filtering", () => {
  // These tests verify the filtering logic used in task.ts
  // The actual filtering is: agents.filter(a => !caller?.subagents?.length || caller.subagents.some(pattern => Wildcard.match(a.name, pattern)))

  const mockAgents = [
    { name: "general", description: "General purpose agent" },
    { name: "explore", description: "Codebase exploration" },
    { name: "code-reviewer", description: "Code review agent" },
    { name: "code-formatter", description: "Code formatting agent" },
    { name: "test-runner", description: "Test execution agent" },
    { name: "docs-generator", description: "Documentation generator" },
  ]

  const filterAgents = (agents: typeof mockAgents, subagents?: string[]) =>
    agents.filter((a) => !subagents?.length || subagents.some((pattern) => Wildcard.match(a.name, pattern)))

  test("returns all agents when subagents is undefined", () => {
    const result = filterAgents(mockAgents, undefined)
    expect(result).toHaveLength(6)
  })

  test("returns all agents when subagents is empty array", () => {
    const result = filterAgents(mockAgents, [])
    expect(result).toHaveLength(6)
  })

  test("filters to exact matches", () => {
    const result = filterAgents(mockAgents, ["general", "explore"])
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.name)).toEqual(["general", "explore"])
  })

  test("filters using wildcard patterns", () => {
    const result = filterAgents(mockAgents, ["code-*"])
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.name)).toEqual(["code-reviewer", "code-formatter"])
  })

  test("filters using mixed exact and wildcard patterns", () => {
    const result = filterAgents(mockAgents, ["general", "code-*"])
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer", "code-formatter"])
  })

  test("filters using global wildcard allows all", () => {
    const result = filterAgents(mockAgents, ["*"])
    expect(result).toHaveLength(6)
  })

  test("filters using suffix wildcard", () => {
    const result = filterAgents(mockAgents, ["*-runner", "*-generator"])
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.name)).toEqual(["test-runner", "docs-generator"])
  })

  test("returns empty when no patterns match", () => {
    const result = filterAgents(mockAgents, ["nonexistent", "also-nonexistent"])
    expect(result).toHaveLength(0)
  })

  test("handles single character wildcard", () => {
    // ? matches single character
    const result = filterAgents(mockAgents, ["code-?eviewer"])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("code-reviewer")
  })
})
