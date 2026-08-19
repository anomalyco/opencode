import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageUser } from "@opencode-ai/client/promise"
import { toLegacyAssistantParts, toLegacyUserMessage, toLegacyUserParts } from "./legacy-message-values"

describe("current session message compatibility", () => {
  test("projects current user files, agents, and explicit presentation", () => {
    const message = {
      id: "msg_user",
      type: "user",
      text: "internal prompt text",
      files: [
        {
          data: "ZXhwb3J0IHt9",
          mime: "text/plain",
          name: "client.ts",
          source: { type: "inline" },
          mention: { text: "@src/client.ts", start: 8, end: 22 },
        },
        {
          data: "",
          mime: "image/png",
          name: "diagram.png",
          source: { type: "uri", uri: "https://example.test/diagram.png" },
        },
      ],
      agents: [{ name: "review", mention: { text: "@review", start: 0, end: 7 } }],
      time: { created: 1 },
    } satisfies SessionMessageUser
    const comments = [{ path: "src/client.ts", comment: "Check this", selection: { startLine: 4, endLine: 2 } }]

    const parts = toLegacyUserParts("ses_1", message, "inspect @src/client.ts", comments)

    expect(parts.map((part) => part.id)).toEqual([
      "msg_user:text:0",
      "msg_user:file:0",
      "msg_user:file:1",
      "msg_user:agent:0",
      "msg_user:comment:0",
    ])
    expect(parts[0]).toMatchObject({ type: "text", text: "inspect @src/client.ts" })
    expect(parts[1]).toMatchObject({
      type: "file",
      filename: "client.ts",
      url: "data:text/plain;base64,ZXhwb3J0IHt9",
      source: {
        type: "file",
        path: "src/client.ts",
        text: { value: "@src/client.ts", start: 8, end: 22 },
      },
    })
    expect(parts[2]).toMatchObject({ type: "file", url: "https://example.test/diagram.png" })
    expect(parts[3]).toMatchObject({
      type: "agent",
      name: "review",
      source: { value: "@review", start: 0, end: 7 },
    })
    expect(parts[4]).toMatchObject({
      type: "text",
      synthetic: true,
      text: "The user made the following comment regarding lines 2 through 4 of src/client.ts: Check this",
    })
    expect(toLegacyUserMessage("ses_1", message, "review", { id: "claude", providerID: "anthropic" })).toMatchObject({
      agent: "review",
      model: { modelID: "claude", providerID: "anthropic" },
    })

    const plainMention = {
      ...message,
      files: [
        {
          ...message.files[0],
          mention: { text: "src/client.ts", start: 8, end: 21 },
        },
      ],
    } satisfies SessionMessageUser
    expect(toLegacyUserParts("ses_1", plainMention)[1]).toMatchObject({
      type: "file",
      source: { type: "file", path: "src/client.ts" },
    })
  })

  test("assigns stable current assistant content IDs", () => {
    const message = {
      id: "msg_assistant",
      type: "assistant",
      agent: "build",
      model: { id: "claude", providerID: "anthropic" },
      content: [
        { type: "reasoning", text: "First" },
        { type: "reasoning", text: "Second" },
        { type: "text", text: "Result" },
        { type: "text", text: "More" },
        {
          type: "tool",
          id: "call_1",
          name: "read",
          state: { status: "completed", input: {}, content: [{ type: "text", text: "hello" }] },
          time: { created: 3 },
        },
      ],
      time: { created: 2, completed: 5 },
    } satisfies SessionMessageAssistant

    expect(toLegacyAssistantParts("ses_1", message).map((part) => part.id)).toEqual([
      "msg_assistant:reasoning:0",
      "msg_assistant:reasoning:1",
      "msg_assistant:text:0",
      "msg_assistant:text:1",
      "call_1",
    ])
  })

  test("normalizes edit fields and all current tool states", () => {
    const message = {
      id: "msg_tools",
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content: [
        {
          type: "tool",
          id: "call_streaming",
          name: "write",
          state: { status: "streaming", input: '{"path":"/repo/new.txt"}' },
          time: { created: 2 },
        },
        {
          type: "tool",
          id: "call_running",
          name: "edit",
          state: {
            status: "running",
            input: { path: "/repo/README.md" },
            metadata: {
              files: [{ file: "README.md", patch: "@@ -1 +1 @@", additions: 1, deletions: 1 }],
            },
          },
          time: { created: 3, ran: 4 },
        },
        {
          type: "tool",
          id: "call_error",
          name: "edit",
          state: {
            status: "error",
            input: { path: "/repo/error.txt" },
            error: { type: "ToolError", message: "edit failed" },
          },
          time: { created: 5, completed: 6 },
        },
        {
          type: "tool",
          id: "call_completed",
          name: "edit",
          state: {
            status: "completed",
            input: { path: "/repo/result.txt" },
            content: [
              { type: "text", text: "Edited file successfully" },
              { type: "file", uri: "file:///repo/result.txt", mime: "text/plain", name: "result.txt" },
            ],
          },
          time: { created: 7, ran: 8, completed: 9 },
        },
      ],
      time: { created: 1, completed: 9 },
    } satisfies SessionMessageAssistant

    const parts = toLegacyAssistantParts("ses_1", message)

    expect(parts[0]).toMatchObject({
      id: "call_streaming",
      state: {
        status: "pending",
        input: { path: "/repo/new.txt", filePath: "/repo/new.txt" },
        raw: '{"path":"/repo/new.txt"}',
      },
    })
    expect(parts[1]).toMatchObject({
      id: "call_running",
      state: {
        status: "running",
        input: { path: "/repo/README.md", filePath: "/repo/README.md" },
        metadata: {
          filediff: {
            file: "README.md",
            patch: "@@ -1 +1 @@",
            additions: 1,
            deletions: 1,
          },
        },
        time: { start: 4 },
      },
    })
    expect(parts[2]).toMatchObject({
      id: "call_error",
      state: {
        status: "error",
        input: { path: "/repo/error.txt", filePath: "/repo/error.txt" },
        error: "edit failed",
        time: { start: 5, end: 6 },
      },
    })
    expect(parts[3]).toMatchObject({
      id: "call_completed",
      state: {
        status: "completed",
        input: { path: "/repo/result.txt", filePath: "/repo/result.txt" },
        output: "Edited file successfully",
        time: { start: 8, end: 9 },
        attachments: [
          {
            id: "call_completed:file:1",
            sessionID: "ses_1",
            messageID: "msg_tools",
            type: "file",
            mime: "text/plain",
            filename: "result.txt",
            url: "file:///repo/result.txt",
          },
        ],
      },
    })
  })
})
