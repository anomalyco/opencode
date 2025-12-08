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

  test("parses repeatable order", () => {
    const parsed = parseAgentFlags(["name=one mode=plan", "name=two mode=impl"])
    expect(parsed.agents.map((a) => a.name)).toEqual(["one", "two"])
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
