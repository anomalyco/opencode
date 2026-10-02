import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { assistantMessage, makeSession, rpcError, startWire } from "./wire-fixture"

describe("acp session replay over the wire", () => {
  test("replays user, text, reasoning, and tool messages in order on session/load", async () => {
    await using acp = await startWire()
    acp.server.sessions.set("ses_replay", makeSession("ses_replay"))
    acp.server.messages.set("ses_replay", replayFixtureMessages())
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
    expect(updates[11]?.update).toMatchObject({ toolCallId: "call_streaming", status: "pending", rawInput: {} })
  })

  test("fails the load and detaches when a message page does not decode", async () => {
    await using acp = await startWire({
      fetch(request) {
        if (request.path !== "/api/session/ses_replay_failure/message") return undefined
        return Response.json({
          data: [
            // An errored tool without its error does not decode.
            replayToolMessage("call_first", { status: "error", input: {}, metadata: {} }),
            replayToolMessage("call_after", {
              status: "completed",
              input: { command: "printf done" },
              metadata: { exit: 0 },
              content: [{ type: "text", text: "done" }],
            }),
          ],
          cursor: {},
        })
      },
    })
    acp.server.sessions.set("ses_replay_failure", makeSession("ses_replay_failure"))
    await acp.initialize()

    expect(
      await rpcError(
        acp.request("session/load", { cwd: "/workspace", sessionId: "ses_replay_failure", mcpServers: [] }),
      ),
    ).toMatchObject({ code: -32603, data: { errorName: "ClientError" } })
    expect(acp.updates.filter((item) => item.update.sessionUpdate !== "available_commands_update")).toEqual([])
    expect(
      await rpcError(
        acp.request("session/set_config_option", { sessionId: "ses_replay_failure", configId: "mode", value: "plan" }),
      ),
    ).toMatchObject({ code: -32602, data: { sessionId: "ses_replay_failure" } })
  })
})

function replayToolMessage(id: string, state: Record<string, unknown>) {
  return {
    ...assistantMessage(`msg_${id}`),
    content: [{ type: "tool", id, name: "shell", time: { created: 1, completed: 2 }, state }],
  }
}

function replayFixtureMessages(): SessionMessageInfo[] {
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
      ],
    }),
  ]
}
