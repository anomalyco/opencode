import { describe, expect, test } from "bun:test"
import { parseAgentFlags, validateAgentFlags } from "@/cli/cmd/session-init"

const fail = (msg: string): never => {
  throw new Error(msg)
}

describe("run CLI agent flag parsing", () => {
  test("parses key/value agent", () => {
    const parsed = parseAgentFlags('name=claude model=opus mode=plan')
    expect(parsed.agents).toEqual([{ name: "claude", model: "opus", mode: "plan" }])
  })

  test("parses bare agent/model", () => {
    const parsed = parseAgentFlags("claude/haiku")
    expect(parsed.agents).toEqual([{ name: "claude", model: "haiku" }])
  })

  test("parses plan-agent and agent order", () => {
    const parsed = parseAgentFlags("name=two mode=impl", "name=one")
    // plan-agent is first, then agent
    expect(parsed.agents.map((a) => a.name)).toEqual(["one", "two"])
    // plan-agent should have mode forced to "plan"
    expect(parsed.agents[0].mode).toEqual("plan")
  })

  test("rejects unknown key", () => {
    expect(() => parseAgentFlags("foo=bar")).toThrow(/Unknown agent key/)
  })
})

describe("run CLI agent validation", () => {
  test("rejects missing name", () => {
    expect(() => validateAgentFlags([{ name: "" } as any], 1, fail)).toThrow(/Agent name is required/)
  })

  test("rejects empty provided list", () => {
    expect(() => validateAgentFlags([], 1, fail)).toThrow(/Agent list is empty/)
  })
})
