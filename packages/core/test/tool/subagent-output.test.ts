import { describe, expect, test } from "bun:test"
import { SubagentTool, backgroundResult } from "../../src/tool/plugin/subagent.js"

describe("SubagentTool", () => {
  test("description warns not to answer before subagent results", () => {
    expect(SubagentTool.description).toContain("Do not answer the user's original question")
    expect(SubagentTool.description).toContain("depends on what the subagent finds")
    expect(SubagentTool.description).toContain("briefly tell the user")
  })

  test("backgroundResult warns not to answer before subagent results", () => {
    const result = backgroundResult("session-123")
    expect(result.output).toContain("Do not answer the user's original question")
    expect(result.output).toContain("depends on what the subagent finds")
    expect(result.output).toContain("briefly tell the user")
  })
})
