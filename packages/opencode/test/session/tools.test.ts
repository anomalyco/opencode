import { describe, expect, it } from "bun:test"
import { mcpProgressToToolProgressReport } from "../../src/session/tools"

describe("SessionTools MCP progress", () => {
  it("maps MCP progress into a status report, not partial tool output", () => {
    expect(mcpProgressToToolProgressReport({ progress: 2, total: 4, message: "halfway" })).toEqual({
      report: {
        progress: 2,
        total: 4,
        message: "halfway",
        source: "mcp",
      },
      structured: {
        source: "mcp",
        progress: 2,
        total: 4,
        message: "halfway",
      },
    })
  })
})
