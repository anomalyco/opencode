import { describe, expect, it } from "bun:test"
import { mcpProgressToToolProgress } from "../../src/session/tools"

describe("SessionTools MCP progress", () => {
  it("maps MCP progress into standard running tool progress", () => {
    expect(mcpProgressToToolProgress({ progress: 2, total: 4, message: "halfway" })).toEqual({
      structured: {
        source: "mcp",
        progress: 2,
        total: 4,
        message: "halfway",
      },
      content: [{ type: "text", text: "halfway" }],
    })
  })

  it("keeps progress display bounded when no message is provided", () => {
    expect(mcpProgressToToolProgress({ progress: 2 })).toEqual({
      structured: {
        source: "mcp",
        progress: 2,
      },
      content: [],
    })
  })
})
