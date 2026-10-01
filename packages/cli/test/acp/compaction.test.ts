import { describe, expect, test } from "bun:test"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import { Schema } from "effect"
import {
  assistantMessage,
  childCreated,
  durableEvent,
  ephemeralEvent,
  makeSession,
  startSession,
  startWire,
  stepEnded,
  succeeded,
  textDelta,
  turn,
  type ServerRequest,
} from "./wire-fixture"

const summary = "Summary of the earlier conversation"
const decodeCompact = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))

describe("acp compaction markers over the wire", () => {
  test("marks a /compact turn without forwarding the summary text", async () => {
    await using acp = await compactTurn((sessionID, id) => [
      durableEvent("session.compaction.started", { sessionID, reason: "manual", recent: "", inputID: id }),
      ephemeralEvent("session.compaction.delta", { sessionID, text: summary }),
      durableEvent("session.compaction.ended", { sessionID, reason: "manual", text: summary, recent: "" }),
    ])

    expect(turnUpdates(acp.updates)).toEqual([
      marker(acp.sessionId, { status: "started", messageId: acp.id, reason: "manual" }),
      marker(acp.sessionId, { status: "completed", messageId: acp.id, reason: "manual" }),
    ])
    expect(acp.response.stopReason).toBe("end_turn")
  })

  test("marks a failed /compact turn with the compaction error", async () => {
    await using acp = await compactTurn((sessionID, id) => [
      durableEvent("session.compaction.started", { sessionID, reason: "manual", recent: "", inputID: id }),
      durableEvent("session.compaction.failed", {
        sessionID,
        reason: "manual",
        inputID: id,
        error: { type: "provider.error", message: "summary request failed" },
      }),
    ])

    expect(turnUpdates(acp.updates)).toEqual([
      marker(acp.sessionId, { status: "started", messageId: acp.id, reason: "manual" }),
      marker(acp.sessionId, {
        status: "failed",
        messageId: acp.id,
        reason: "manual",
        error: { type: "provider.error", message: "summary request failed" },
      }),
    ])
    expect(acp.response.stopReason).toBe("end_turn")
  })

  test("marks an automatic compaction between steps of a prompt turn", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          textDelta(sessionID, "msg_before", "before"),
          stepEnded(sessionID, "msg_before"),
          durableEvent("session.compaction.started", { sessionID, reason: "auto", recent: "" }),
          ephemeralEvent("session.compaction.delta", { sessionID, text: summary }),
          durableEvent("session.compaction.ended", { sessionID, reason: "auto", text: summary, recent: "" }),
          textDelta(sessionID, "msg_after", "after"),
          stepEnded(sessionID, "msg_after"),
        ),
    })

    const response = await acp.prompt(acp.sessionId, "hello")

    const updates = turnUpdates(acp.updates)
    const started = updates[1]?.update._meta?.["opencode/compaction"]
    expect(started).toEqual({ status: "started", messageId: expect.stringMatching(/^msg_/), reason: "auto" })
    expect(updates).toEqual([
      chunk(acp.sessionId, "msg_before", "before"),
      marker(acp.sessionId, { status: "started", messageId: messageID(started), reason: "auto" }),
      marker(acp.sessionId, { status: "completed", messageId: messageID(started), reason: "auto" }),
      chunk(acp.sessionId, "msg_after", "after"),
    ])
    expect(response.stopReason).toBe("end_turn")
  })

  test("projects child session compaction markers onto the parent turn", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          childCreated("ses_child", sessionID, "Explore"),
          durableEvent("session.compaction.started", { sessionID: "ses_child", reason: "auto", recent: "" }),
          ephemeralEvent("session.compaction.delta", { sessionID: "ses_child", text: summary }),
          durableEvent("session.compaction.ended", {
            sessionID: "ses_child",
            reason: "auto",
            text: summary,
            recent: "",
          }),
          succeeded("ses_child"),
        ),
    })

    await acp.prompt(acp.sessionId, "hello")

    const child = { id: "ses_child", parentID: acp.sessionId, depth: 1, title: "Explore" }
    expect(turnUpdates(acp.updates).map((item) => item.update._meta)).toEqual([
      {
        "opencode/compaction": { status: "started", messageId: expect.stringMatching(/^msg_/), reason: "auto" },
        "opencode/child-session": child,
      },
      {
        "opencode/compaction": { status: "completed", messageId: expect.stringMatching(/^msg_/), reason: "auto" },
        "opencode/child-session": child,
      },
    ])
  })

  test("replays settled compactions at their position on session/load", async () => {
    await using acp = await startWire()
    acp.server.sessions.set("ses_compacted", makeSession("ses_compacted"))
    acp.server.messages.set("ses_compacted", compactedHistory())
    await acp.initialize()

    await acp.request("session/load", { cwd: "/workspace", sessionId: "ses_compacted", mcpServers: [] })

    expect(turnUpdates(acp.updates)).toEqual([
      {
        sessionId: "ses_compacted",
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: "msg_user",
          content: { type: "text", text: "hello" },
        },
      },
      marker("ses_compacted", {
        status: "failed",
        messageId: "msg_compaction_failed",
        reason: "auto",
        error: { type: "provider.error", message: "summary request failed" },
      }),
      marker("ses_compacted", { status: "completed", messageId: "msg_compaction", reason: "manual" }),
      chunk("ses_compacted", "msg_after", "after"),
    ])
  })
})

// Holds the compact response so the test can publish the turn's events while the request is in flight.
async function compactTurn(events: (sessionID: string, id: string) => OpenCodeEvent[]) {
  const held = Promise.withResolvers<Response>()
  const acp = await startSession({ fetch: (request) => (request.path.endsWith("/compact") ? held.promise : undefined) })
  const response = acp.prompt(acp.sessionId, "/compact")
  const request = await acp.until(
    () => acp.server.requests.find((item) => item.path.endsWith("/compact")),
    "compact request",
  )
  const id = decodeCompact(request.body).id
  acp.server.send(...turn(acp.sessionId, id, ...events(acp.sessionId, id)))
  held.resolve(Response.json({ data: {} }))
  return Object.assign(acp, { id, response: await response })
}

function messageID(marker: unknown) {
  return Schema.decodeUnknownSync(Schema.Struct({ messageId: Schema.String }))(marker).messageId
}

function marker(sessionId: string, value: Record<string, unknown>): SessionNotification {
  return { sessionId, update: { sessionUpdate: "session_info_update", _meta: { "opencode/compaction": value } } }
}

function chunk(sessionId: string, messageId: string, text: string): SessionNotification {
  return { sessionId, update: { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } } }
}

function turnUpdates(updates: readonly SessionNotification[]) {
  return updates.filter(
    (item) => item.update.sessionUpdate !== "available_commands_update" && item.update.sessionUpdate !== "usage_update",
  )
}

function compactedHistory(): SessionMessageInfo[] {
  return [
    { id: "msg_user", type: "user", text: "hello", time: { created: 1 } },
    {
      id: "msg_compaction_failed",
      type: "compaction",
      status: "failed",
      reason: "auto",
      error: { type: "provider.error", message: "summary request failed" },
      time: { created: 2 },
    },
    {
      id: "msg_compaction",
      type: "compaction",
      status: "completed",
      reason: "manual",
      summary,
      recent: "",
      time: { created: 3 },
    },
    {
      id: "msg_compaction_running",
      type: "compaction",
      status: "running",
      reason: "auto",
      summary: "",
      recent: "",
      time: { created: 4 },
    },
    assistantMessage("msg_after", { time: { created: 5, completed: 6 }, content: [{ type: "text", text: "after" }] }),
  ]
}
