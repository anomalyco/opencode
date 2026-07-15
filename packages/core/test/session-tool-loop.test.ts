import { describe, expect, test } from "bun:test"
import { ToolLoop } from "@opencode-ai/core/session/tool-loop"

const empty = (tool: string, ...values: ReadonlyArray<unknown>): ToolLoop.Observation => ({
  type: "tool",
  tool,
  outcome: { type: "success", values },
})

describe("ToolLoop", () => {
  test("detects consecutive empty results from the same tool", () => {
    expect(
      ToolLoop.detect([
        empty("gumps_mcp_resource_list", ""),
        empty("gumps_mcp_resource_list", {
          resources: [],
          total: 0,
          prefix: "m3",
          success: true,
          hasMore: false,
        }),
        empty("gumps_mcp_resource_list", "No matching resources found."),
      ]),
    ).toEqual({ tool: "gumps_mcp_resource_list", count: 3, outcome: "empty" })
    expect(ToolLoop.detect([empty("search", []), empty("search", [])], 2)).toEqual({
      tool: "search",
      count: 2,
      outcome: "empty",
    })
  })

  test("resets when another tool or meaningful output makes progress", () => {
    expect(
      ToolLoop.detect([
        empty("search", []),
        empty("search", []),
        empty("read", []),
        empty("search", []),
        empty("search", []),
      ]),
    ).toBeUndefined()

    expect(
      ToolLoop.detect([
        empty("search", []),
        empty("search", []),
        empty("search", [{ id: "found" }]),
        empty("search", []),
        empty("search", []),
      ]),
    ).toBeUndefined()

    expect(ToolLoop.detect([empty("write", ""), empty("write", ""), empty("write", "")])).toBeUndefined()
  })

  test("treats files, cursors, and new user input as progress", () => {
    expect(
      ToolLoop.detect([
        empty("search", []),
        empty("search", []),
        { type: "tool", tool: "search", outcome: { type: "success", values: [[]], files: 1 } },
      ]),
    ).toBeUndefined()
    expect(
      ToolLoop.detect([empty("search", []), empty("search", []), empty("search", { nextCursor: "page-2" })]),
    ).toBeUndefined()
    expect(
      ToolLoop.detect([empty("search", []), empty("search", []), { type: "reset" }, empty("search", [])]),
    ).toBeUndefined()
  })

  test("detects only the same repeated error", () => {
    const failed = (message: string): ToolLoop.Observation => ({
      type: "tool",
      tool: "lookup",
      outcome: { type: "error", message },
    })
    expect(ToolLoop.detect([failed("offline"), failed("offline"), failed("offline")])).toEqual({
      tool: "lookup",
      count: 3,
      outcome: "error",
    })
    expect(ToolLoop.detect([failed("offline"), failed("timeout"), failed("offline")])).toBeUndefined()
  })
})
