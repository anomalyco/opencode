import { describe, expect, test } from "bun:test"
import type { JsonValue, SessionMessageAssistantTool } from "@opencode-ai/client/promise"
import { currentContentDefaultOpen } from "./current-tool-state"

function tool(name: string, files: JsonValue[] = []): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: `tool_${name}`,
    name,
    state: {
      status: "completed",
      input: {},
      content: [{ type: "text", text: "done" }],
      metadata: { files },
    },
    time: { created: 1, completed: 2 },
  }
}

describe("current content default open", () => {
  test("uses the shell disclosure preference", () => {
    expect(currentContentDefaultOpen(tool("shell"), true, false)).toBe(true)
    expect(currentContentDefaultOpen(tool("execute"), false, true)).toBe(false)
  })

  test("uses the file-change disclosure preference", () => {
    expect(currentContentDefaultOpen(tool("edit"), false, true)).toBe(true)
    expect(currentContentDefaultOpen(tool("write"), false, false)).toBe(false)
    expect(currentContentDefaultOpen(tool("patch"), false, true)).toBe(true)
  })

  test("keeps deletion-only changes collapsed", () => {
    expect(
      currentContentDefaultOpen(
        tool("patch", [
          { file: "src/one.ts", patch: "", additions: 0, deletions: 1, status: "deleted" },
          { file: "src/two.ts", patch: "", additions: 0, deletions: 1, status: "deleted" },
        ]),
        false,
        true,
      ),
    ).toBe(false)
  })
})
