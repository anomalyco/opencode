import { describe, expect, test } from "bun:test"
import type { JsonValue, SessionMessageInfo } from "@opencode/client/promise"
import { createRoot } from "solid-js"
import { isServer } from "solid-js/web"
import { storyTool } from "../storybook/current-session-scenarios"
import { timelinePresets } from "./detail"
import { createReactiveTimelineProjection } from "./projection"
import { unwrapExecuteMessages } from "./unwrap-execute"
import { unwrapRuns } from "./unwrap-reactivity"

const detail = timelinePresets.find((item) => item.id === "detailed")!.value

const patch = (path: string) => `*** Begin Patch\n*** Update File: ${path}\n@@\n-a\n+b\n*** End Patch`

const change = (file: string, status: string, patch?: string): JsonValue =>
  patch ? { file, status, additions: 1, deletions: 1, patch } : { file, status }

const calls: JsonValue[] = [
  { tool: "patch", status: "completed", input: { patchText: patch("/repo/files/src/app.ts") } },
  { tool: "patch", status: "completed", input: { patchText: patch("/repo/files/src/app.ts") } },
  { tool: "shell", status: "completed", input: { command: "make" } },
  { tool: "Bun", status: "completed", input: { method: "write", path: "/repo/files/src/new.ts" } },
  { tool: "Bun", status: "completed", input: { method: "file", path: "/repo/files/old.txt" } },
  { tool: "Bun", status: "completed", input: { method: "file", path: "/repo/files/notes.md" } },
]

const files: JsonValue[] = [
  change("files/src/app.ts", "modified", "@@ -1 +1 @@\n-a\n+b\n"),
  change("files/src/app.ts", "modified", "@@ -2 +2 @@\n-c\n+d\n"),
  change("files/src/new.ts", "added", "@@ -0,0 +1 @@\n+x\n"),
  change("files/old.txt", "deleted"),
  change("files/stray.ts", "added"),
]

const session = (
  script = storyTool(
    "script",
    "execute",
    "completed",
    { code: "…" },
    { output: "ok", metadata: { toolCalls: calls, files } },
  ),
): SessionMessageInfo[] => [
  { id: "msg_u", type: "user", text: "go", time: { created: 1 } },
  {
    id: "msg_a",
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    time: { created: 2 },
    content: [{ type: "text", text: "Running." }, script],
  },
]

describe("unwrapped scripts", () => {
  test("draw each call as a part, with each change under the call that made it", () => {
    createRoot((dispose) => {
      const message = unwrapExecuteMessages(() => session())()[1]
      const content = message?.type === "assistant" ? message.content : []

      expect(
        content.map((part) =>
          part.type === "tool"
            ? [
                part.id,
                part.name,
                part.state.status,
                "metadata" in part.state
                  ? // SAFETY: the parts carry the fixture's changes as they were given.
                    (part.state.metadata?.files as { file: string }[] | undefined)?.map((file) => file.file)
                  : undefined,
              ]
            : [part.type],
        ),
      ).toEqual([
        ["text"],
        ["script:call:0", "patch", "completed", ["files/src/app.ts"]],
        ["script:call:1", "patch", "completed", ["files/src/app.ts"]],
        ["script:call:2", "shell", "completed", undefined],
        ["script:call:3", "patch", "completed", ["files/src/new.ts"]],
        // A delete has no diff, so it draws as the change; a Bun file that changed nothing reads the file.
        ["script:file:3:files/old.txt", "script-file", "completed", ["files/old.txt"]],
        ["script:call:5", "read", "completed", undefined],
        // What no call claimed follows the calls, then how the script ended.
        ["script:file:4:files/stray.ts", "script-file", "completed", ["files/stray.ts"]],
        ["script:result", "script-result", "completed", undefined],
      ])
      dispose()
    })
  })

  test("a backgrounded script stands as one row", () => {
    createRoot((dispose) => {
      const script = storyTool(
        "script",
        "execute",
        "completed",
        { code: "…" },
        { output: "Script cm_1 is still running", metadata: { jobID: "cm_1" } },
      )

      const message = unwrapExecuteMessages(() => session(script))()[1]

      expect(message?.type === "assistant" && message.content.map((part) => part.type === "tool" && part.name)).toEqual(
        [false, "script-background"],
      )
      dispose()
    })
  })
})

// Solid's server build does not track, so this runs with `bun test --conditions=browser`.
describe.skipIf(isServer)("unwrapped script reactivity", () => {
  test("the current timeline rebuilds only when a call starts or finishes", () => {
    expect(
      unwrapRuns(
        (messages, status) =>
          createReactiveTimelineProjection({
            sessionMessages: messages,
            status,
            reasoningMode: () => "full",
            timelineDetail: () => detail,
            unwrapExecute: true,
          }).rows,
      ),
    ).toEqual({ repeated: 0, added: 1, settled: 1 })
  })
})
