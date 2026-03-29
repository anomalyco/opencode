import { describe, expect, test } from "bun:test"
import { LLM } from "../../src/session/llm"
import type { Permission } from "../../src/permission"

describe("LLM.preapprovedWorkflowTools", () => {
  test("returns all tools when ruleset is empty", () => {
    const tools = ["read_file", "write_file", "run_command"]
    const result = LLM.preapprovedWorkflowTools(tools, [])
    expect(result).toEqual(tools)
  })

  test("excludes tools with explicit ask rule", () => {
    const tools = ["read_file", "run_command", "write_file"]
    const ruleset: Permission.Ruleset = [{ permission: "run_command", pattern: "*", action: "ask" }]
    const result = LLM.preapprovedWorkflowTools(tools, ruleset)
    expect(result).not.toContain("run_command")
    expect(result).toContain("read_file")
    expect(result).toContain("write_file")
  })

  test("excludes tools matched by wildcard ask rule", () => {
    const tools = ["read_file", "write_file", "run_command"]
    const ruleset: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "ask" }]
    const result = LLM.preapprovedWorkflowTools(tools, ruleset)
    expect(result).toEqual([])
  })

  test("allows tools with allow rule overriding ask", () => {
    const tools = ["run_command"]
    const ruleset: Permission.Ruleset = [
      { permission: "*", pattern: "*", action: "ask" },
      { permission: "run_command", pattern: "*", action: "allow" },
    ]
    const result = LLM.preapprovedWorkflowTools(tools, ruleset)
    expect(result).toContain("run_command")
  })

  test("preapproves tools with only deny rules (deny is handled by resolveTools, not here)", () => {
    const tools = ["read_file"]
    const ruleset: Permission.Ruleset = [{ permission: "read_file", pattern: "*", action: "deny" }]
    const result = LLM.preapprovedWorkflowTools(tools, ruleset)
    expect(result).toContain("read_file")
  })
})
