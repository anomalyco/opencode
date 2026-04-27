import { describe, expect, test } from "bun:test"
import { matchAgentName } from "../../src/cli/cmd/agent-match"

describe("cli.agent-match", () => {
  test("matches exact agent names", () => {
    expect(matchAgentName("build", [{ name: "build" }, { name: "plan" }])).toBe("build")
  })

  test("matches names case-insensitively", () => {
    expect(matchAgentName("Build", [{ name: "build" }, { name: "plan" }])).toBe("build")
    expect(matchAgentName("PLAN", [{ name: "build" }, { name: "plan" }])).toBe("plan")
  })

  test("returns undefined when no match exists", () => {
    expect(matchAgentName("unknown", [{ name: "build" }, { name: "plan" }])).toBeUndefined()
  })
})
