import { describe, expect, test } from "bun:test"
import type { Part as PartType } from "@opencode-ai/sdk/v2"
import { partDefaultOpen } from "./part-default-open"

describe("partDefaultOpen", () => {
  test("keeps edited files expanded when enabled", () => {
    expect(partDefaultOpen(tool("edit", { filediff: { additions: 1, deletions: 1 } }), false, true)).toBe(true)
  })

  test("collapses deletion-only edits when enabled", () => {
    expect(partDefaultOpen(tool("edit", { filediff: { additions: 0, deletions: 1_200 } }), false, true)).toBe(false)
  })

  test("collapses patches containing only deleted files when enabled", () => {
    expect(
      partDefaultOpen(
        tool("apply_patch", {
          files: [
            { filePath: "one.ts", type: "delete" },
            { filePath: "two.ts", type: "delete" },
          ],
        }),
        false,
        true,
      ),
    ).toBe(false)
  })

  test("collapses v2 patches containing only deleted files when enabled", () => {
    expect(
      partDefaultOpen(
        tool("patch", {
          files: [
            { file: "one.ts", status: "deleted" },
            { file: "two.ts", status: "deleted" },
          ],
        }),
        false,
        true,
      ),
    ).toBe(false)
  })

  test("keeps mixed patches expanded when enabled", () => {
    expect(
      partDefaultOpen(
        tool("apply_patch", {
          files: [
            { filePath: "one.ts", type: "delete" },
            { filePath: "two.ts", type: "update" },
          ],
        }),
        false,
        true,
      ),
    ).toBe(true)
  })

  test("keeps mixed v2 patches expanded when enabled", () => {
    expect(
      partDefaultOpen(
        tool("patch", {
          files: [
            { file: "one.ts", status: "deleted" },
            { file: "two.ts", status: "modified" },
          ],
        }),
        false,
        true,
      ),
    ).toBe(true)
  })

  test("preserves shell defaults", () => {
    expect(partDefaultOpen(tool("shell", {}), true, false)).toBe(true)
  })
})

function tool(name: string, metadata: Record<string, unknown>): PartType {
  return {
    id: `part_${name}`,
    sessionID: "session",
    messageID: "message",
    type: "tool",
    callID: `call_${name}`,
    tool: name,
    state: {
      status: "completed",
      input: {},
      output: "",
      title: name,
      metadata,
      time: { start: 0, end: 1 },
    },
  }
}
