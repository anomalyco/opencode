import { describe, expect, test } from "bun:test"
import * as run from "./run.util"

describe("run CLI agent/model parsing", () => {
  test("parses agent only", () => {
    const parsed = run.parseAgentInput("claude")
    expect(parsed).toEqual({ agent: "claude" })
  })

  test("parses agent/model", () => {
    const parsed = run.parseAgentInput("claude/haiku")
    expect(parsed).toEqual({ agent: "claude", model: "haiku" })
  })

  test("ignores trailing slash", () => {
    const parsed = run.parseAgentInput("claude/")
    expect(parsed).toEqual({ agent: "claude/" })
  })
})

describe("run CLI plan/impl validation", () => {
  test("requires both plan and impl agents", () => {
    expect(() => run.validateModeFlags(run.collectModeFlags({ "plan-agent": "a" }), { command: false })).toThrow()
    expect(() => run.validateModeFlags(run.collectModeFlags({ "impl-agent": "b" }), { command: false })).toThrow()
  })

  test("rejects combining with --agent", () => {
    expect(() =>
      run.validateModeFlags(
        run.collectModeFlags({ "plan-agent": "a", "impl-agent": "b" }),
        { agent: "c", command: false },
      ),
    ).toThrow()
  })

  test("rejects command mode", () => {
    expect(() =>
      run.validateModeFlags(run.collectModeFlags({ "plan-agent": "a", "impl-agent": "b" }), { command: true }),
    ).toThrow()
  })
})
