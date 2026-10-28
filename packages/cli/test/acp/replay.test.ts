import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "@opencode/schema/session-message"
import path from "node:path"
import { tmpdir } from "../fixture/tmpdir"
import { assistantMessage, fileDiff, makeSession, startWire } from "./wire-fixture"

describe("acp session replay over the wire", () => {
  test("replays user, text, reasoning, and tool messages in order on session/load", async () => {
    await using dir = await tmpdir()
    const edited = path.resolve(dir.path, "edited.ts")
    await Bun.write(edited, "one\r\nthree\r\n")
    await using acp = await startWire()
    acp.server.sessions.set("ses_replay", makeSession("ses_replay"))
    acp.server.messages.set("ses_replay", replayFixtureMessages(edited))
    await acp.initialize()

    await acp.request("session/load", { cwd: "/workspace", sessionId: "ses_replay", mcpServers: [] })

    const updates = acp.updates.filter((item) => item.update.sessionUpdate !== "available_commands_update")
    expect(updates.every((update) => update.sessionId === "ses_replay")).toBe(true)
    expect(updates.map((item) => item.update.sessionUpdate)).toEqual([
      "user_message_chunk",
      "user_message_chunk",
      "user_message_chunk",
      "agent_message_chunk",
      "agent_thought_chunk",
      "tool_call",
      "tool_call_update",
      "tool_call",
      "tool_call_update",
      "tool_call",
      "tool_call_update",
      "tool_call",
      "tool_call",
      "tool_call_update",
    ])
    expect(updates[1]?.update).toMatchObject({
      content: { type: "resource_link", uri: "file:///workspace/note.md", name: "note.md", mimeType: "text/markdown" },
    })
    expect(updates[2]?.update).toMatchObject({
      content: { type: "resource", resource: { mimeType: "text/plain", text: "hello" } },
    })
    expect(updates[4]?.update).toMatchObject({ messageId: "msg_assistant:reasoning:0" })
    expect(updates[6]?.update).toMatchObject({
      toolCallId: "call_done",
      status: "completed",
      content: [
        { type: "content", content: { type: "text", text: "done" } },
        { type: "content", content: { type: "image", mimeType: "image/png", data: "AAAA" } },
      ],
      rawOutput: { metadata: { exit: 0 } },
    })
    expect(updates[8]?.update).toMatchObject({
      toolCallId: "call_running",
      status: "in_progress",
      title: "pwd",
      locations: [{ path: "/workspace" }],
    })
    expect(updates[10]?.update).toMatchObject({
      toolCallId: "call_failed",
      status: "failed",
      content: [
        { type: "content", content: { type: "text", text: "partial" } },
        { type: "content", content: { type: "text", text: "failed hard" } },
      ],
    })
    expect(updates[5]?.update).toMatchObject({ name: "shell" })
    expect(updates[11]?.update).toMatchObject({ toolCallId: "call_streaming", status: "pending", rawInput: {} })
    expect(updates[13]?.update).toMatchObject({
      toolCallId: "call_edit",
      status: "completed",
      content: [
        { type: "content", content: { type: "text", text: "edited" } },
        { type: "diff", path: edited, oldText: "one\r\ntwo\r\n", newText: "one\r\nthree\r\n" },
      ],
    })
  })
})

function replayFixtureMessages(edited: string): Array<typeof SessionMessage.Info.Encoded> {
  return [
    {
      id: "msg_user",
      type: "user",
      text: "hello",
      time: { created: 1 },
      files: [
        { data: "", mime: "text/markdown", name: "note.md", source: { type: "uri", uri: "file:///workspace/note.md" } },
        { data: "aGVsbG8=", mime: "text/plain", name: "inline.txt", source: { type: "inline" } },
      ],
    },
    assistantMessage("msg_assistant", {
      time: { created: 2, completed: 3 },
      content: [
        { type: "text", text: "answer" },
        { type: "reasoning", text: "thinking" },
        {
          type: "tool",
          id: "call_done",
          name: "shell",
          time: { created: 2, completed: 3 },
          state: {
            status: "completed",
            input: { command: "printf done" },
            metadata: { exit: 0 },
            content: [
              { type: "text", text: "done" },
              { type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png", name: "image.png" },
            ],
          },
        },
        {
          type: "tool",
          id: "call_running",
          name: "shell",
          time: { created: 2, ran: 2 },
          state: { status: "running", input: { command: "pwd" }, metadata: {} },
        },
        {
          type: "tool",
          id: "call_failed",
          name: "read",
          time: { created: 2, completed: 3 },
          state: {
            status: "error",
            input: { path: "/workspace/missing.ts" },
            metadata: { bytes: 0 },
            content: [{ type: "text", text: "partial" }],
            error: { type: "tool.error", message: "failed hard" },
          },
        },
        {
          type: "tool",
          id: "call_streaming",
          name: "shell",
          time: { created: 2 },
          state: { status: "streaming", input: '{"command":' },
        },
        {
          type: "tool",
          id: "call_edit",
          name: "edit",
          time: { created: 2, completed: 3 },
          state: {
            status: "completed",
            input: { path: edited, oldString: "two", newString: "three" },
            metadata: { files: [fileDiff(edited, "one\r\ntwo\r\n", "one\r\nthree\r\n")] },
            content: [{ type: "text", text: "edited" }],
          },
        },
      ],
    }),
  ]
}
