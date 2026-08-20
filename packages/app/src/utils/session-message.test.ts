import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageUser } from "@opencode-ai/client/promise"
import { presentAssistantParts, presentUserParts } from "./session-message"

describe("session message presentation", () => {
  test("projects current user content for the DOM renderer", () => {
    const message = {
      id: "msg_user",
      type: "user",
      text: "inspect @src/client.ts",
      files: [
        {
          data: "ZXhwb3J0IHt9",
          mime: "text/plain",
          name: "client.ts",
          source: { type: "inline" },
          mention: { text: "@src/client.ts", start: 8, end: 22 },
        },
      ],
      agents: [{ name: "review", mention: { text: "@review", start: 0, end: 7 } }],
      time: { created: 1 },
    } satisfies SessionMessageUser

    const parts = presentUserParts("ses_1", message)

    expect(parts.map((part) => part.id)).toEqual(["msg_user:text:0", "msg_user:file:0", "msg_user:agent:0"])
    expect(parts[1]).toMatchObject({
      type: "file",
      source: {
        type: "file",
        path: "src/client.ts",
        text: { value: "@src/client.ts", start: 8, end: 22 },
      },
    })

    const plainMention = {
      ...message,
      text: "inspect src/client.ts",
      files: [
        {
          ...message.files[0],
          name: "client.ts",
          mention: { text: "src/client.ts", start: 8, end: 21 },
        },
      ],
    } satisfies SessionMessageUser
    expect(presentUserParts("ses_1", plainMention)[1]).toMatchObject({
      type: "file",
      source: { type: "file", path: "src/client.ts" },
    })
  })

  test("projects current assistant content for existing DOM tools", () => {
    const message = {
      id: "msg_assistant",
      type: "assistant",
      agent: "build",
      model: { id: "claude", providerID: "anthropic", variant: "high" },
      content: [
        { type: "reasoning", text: "Thinking", time: { created: 2, completed: 3 } },
        { type: "text", text: "Result" },
        {
          type: "tool",
          id: "call_1",
          name: "read",
          state: {
            status: "completed",
            input: { filePath: "note.txt" },
            metadata: { title: "note.txt" },
            content: [{ type: "text", text: "hello" }],
          },
          time: { created: 3, ran: 4, completed: 5 },
        },
      ],
      cost: 0.1,
      tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 1, write: 0 } },
      time: { created: 2, completed: 5 },
    } satisfies SessionMessageAssistant

    const parts = presentAssistantParts("ses_1", message)

    expect(parts.map((part) => part.id)).toEqual(["msg_assistant:reasoning:0", "msg_assistant:text:0", "call_1"])
    expect(parts[2]).toMatchObject({ type: "tool", tool: "read", state: { status: "completed", output: "hello" } })
  })

  test("adapts current edit fields only at the renderer boundary", () => {
    const message = {
      id: "msg_assistant",
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content: [
        {
          type: "tool",
          id: "call_edit",
          name: "edit",
          state: {
            status: "completed",
            input: { path: "/repo/README.md", oldString: "old", newString: "new" },
            content: [{ type: "text", text: "Edited file successfully" }],
            metadata: {
              files: [{ file: "README.md", patch: "@@ -1 +1 @@\n-old\n+new", additions: 1, deletions: 1 }],
            },
          },
          time: { created: 2, ran: 3, completed: 4 },
        },
      ],
      time: { created: 2, completed: 4 },
    } satisfies SessionMessageAssistant

    expect(presentAssistantParts("ses_1", message)).toEqual([
      expect.objectContaining({
        type: "tool",
        state: expect.objectContaining({
          input: expect.objectContaining({ path: "/repo/README.md", filePath: "/repo/README.md" }),
          metadata: expect.objectContaining({
            filediff: {
              file: "README.md",
              patch: "@@ -1 +1 @@\n-old\n+new",
              additions: 1,
              deletions: 1,
            },
          }),
        }),
      }),
    ])
  })
})
