import { describe, expect, test } from "bun:test"
import type { CompactionUpdate, SessionNotification } from "@agentclientprotocol/sdk"
import { OpenCode, type OpenCodeEvent, type SessionMessageInfo } from "@opencode/client/promise"
import { Event } from "@opencode/schema/event"
import { SessionMessage } from "@opencode/schema/session-message"
import { Schema } from "effect"
import {
  assistantMessage,
  childCreated,
  delivered,
  durableEvent,
  enqueued,
  ephemeralEvent,
  interrupted,
  makeSession,
  startSession,
  startWire,
  stepEnded,
  succeeded,
  textDelta,
  turn,
  type InitializeOptions,
  type Wire,
} from "./wire-fixture"

const summary = "Summary of the earlier conversation"
const providerError = { type: "provider.error", message: "summary request failed", status: 500 }
const decodeCompact = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))
const standard: InitializeOptions = { compaction: {} }

describe("acp compaction markers over the wire", () => {
  test("marks a /compact turn without forwarding the summary text", async () => {
    const compacted = await compactTurn((sessionID, id) => [
      durableEvent("session.compaction.started", { sessionID, reason: "manual", recent: "", inputID: id }),
      ephemeralEvent("session.compaction.delta", { sessionID, text: summary }),
      durableEvent("session.compaction.ended", { sessionID, reason: "manual", text: summary, recent: "" }),
    ])
    await using acp = compacted.acp

    expect(turnUpdates(acp.updates)).toEqual([
      marker(acp.sessionId, { status: "started", messageId: compacted.id, reason: "manual" }),
      marker(acp.sessionId, { status: "completed", messageId: compacted.id, reason: "manual" }),
    ])
    expect(compacted.response.stopReason).toBe("end_turn")
  })

  test("marks a failed /compact turn with the full compaction error", async () => {
    const compacted = await compactTurn((sessionID, id) => [
      durableEvent("session.compaction.started", { sessionID, reason: "manual", recent: "", inputID: id }),
      durableEvent("session.compaction.failed", { sessionID, reason: "manual", inputID: id, error: providerError }),
    ])
    await using acp = compacted.acp

    expect(turnUpdates(acp.updates)).toEqual([
      marker(acp.sessionId, { status: "started", messageId: compacted.id, reason: "manual" }),
      marker(acp.sessionId, { status: "failed", messageId: compacted.id, reason: "manual", error: providerError }),
    ])
    expect(compacted.response.stopReason).toBe("end_turn")
  })

  test("marks an automatic compaction between steps with the ID its replayed message gets", async () => {
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
    using events = await watchEvents(acp.server.url)

    const response = await acp.prompt(acp.sessionId, "hello")

    const messageId = await events.messageID("session.compaction.started")
    expect(turnUpdates(acp.updates)).toEqual([
      chunk(acp.sessionId, "msg_before", "before"),
      marker(acp.sessionId, { status: "started", messageId, reason: "auto" }),
      marker(acp.sessionId, { status: "completed", messageId, reason: "auto" }),
      chunk(acp.sessionId, "msg_after", "after"),
    ])
    expect(response.stopReason).toBe("end_turn")

    const live = turnUpdates(acp.updates)
    acp.server.messages.set(acp.sessionId, [
      {
        id: messageId,
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary,
        recent: "",
        time: { created: 1 },
      },
    ])
    await acp.request("session/load", { cwd: "/workspace", sessionId: acp.sessionId, mcpServers: [] })

    expect(turnUpdates(acp.updates).slice(live.length)).toEqual([
      marker(acp.sessionId, { status: "completed", messageId, reason: "auto" }),
    ])
  })

  test("marks automatic compaction failures before and after the compaction starts", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          durableEvent("session.compaction.failed", {
            sessionID,
            reason: "auto",
            error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
          }),
          durableEvent("session.compaction.started", { sessionID, reason: "auto", recent: "" }),
          durableEvent("session.compaction.failed", { sessionID, reason: "auto", error: providerError }),
        ),
    })
    using events = await watchEvents(acp.server.url)

    await acp.prompt(acp.sessionId, "hello")

    const unstarted = await events.messageID("session.compaction.failed")
    const started = await events.messageID("session.compaction.started")
    expect(turnUpdates(acp.updates)).toEqual([
      marker(acp.sessionId, {
        status: "failed",
        messageId: unstarted,
        reason: "auto",
        error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
      }),
      marker(acp.sessionId, { status: "started", messageId: started, reason: "auto" }),
      marker(acp.sessionId, { status: "failed", messageId: started, reason: "auto", error: providerError }),
    ])
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
    using events = await watchEvents(acp.server.url)

    await acp.prompt(acp.sessionId, "hello")

    const messageId = await events.messageID("session.compaction.started")
    const child = { id: "ses_child", parentID: acp.sessionId, depth: 1, title: "Explore" }
    expect(turnUpdates(acp.updates).map((item) => item.update._meta)).toEqual([
      { "opencode/compaction": { status: "started", messageId, reason: "auto" }, "opencode/child-session": child },
      { "opencode/compaction": { status: "completed", messageId, reason: "auto" }, "opencode/child-session": child },
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
        error: providerError,
      }),
      marker("ses_compacted", { status: "completed", messageId: "msg_compaction", reason: "manual" }),
      chunk("ses_compacted", "msg_after", "after"),
    ])
  })
})

describe("acp standard compaction updates over the wire", () => {
  test("streams a /compact turn's summary and completes it with the full summary", async () => {
    const compacted = await compactTurn(
      (sessionID, id) => [
        durableEvent("session.compaction.started", { sessionID, reason: "manual", recent: "", inputID: id }),
        ephemeralEvent("session.compaction.delta", { sessionID, text: "Summary of " }),
        ephemeralEvent("session.compaction.delta", { sessionID, text: "the earlier conversation" }),
        durableEvent("session.compaction.ended", { sessionID, reason: "manual", text: summary, recent: "" }),
      ],
      standard,
    )
    await using acp = compacted.acp

    expect(turnUpdates(acp.updates)).toEqual([
      compaction(acp.sessionId, { compactionId: compacted.id, status: "in_progress" }),
      summaryChunk(acp.sessionId, compacted.id, "Summary of "),
      summaryChunk(acp.sessionId, compacted.id, "the earlier conversation"),
      compaction(acp.sessionId, {
        compactionId: compacted.id,
        status: "completed",
        summary: [{ type: "text", text: summary }],
      }),
    ])
    expect(compacted.response.stopReason).toBe("end_turn")
  })

  test("completes a compaction without a readable summary with a cleared summary", async () => {
    await using acp = await startSession({
      capabilities: standard,
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          durableEvent("session.compaction.started", { sessionID, reason: "auto", recent: "" }),
          durableEvent("session.compaction.ended", { sessionID, reason: "auto", text: "", recent: "" }),
          textDelta(sessionID, "msg_after", "after"),
          stepEnded(sessionID, "msg_after"),
        ),
    })
    using events = await watchEvents(acp.server.url)

    await acp.prompt(acp.sessionId, "hello")

    const compactionId = await events.messageID("session.compaction.started")
    expect(turnUpdates(acp.updates)).toEqual([
      compaction(acp.sessionId, { compactionId, status: "in_progress" }),
      compaction(acp.sessionId, { compactionId, status: "completed", summary: null }),
      chunk(acp.sessionId, "msg_after", "after"),
    ])
  })

  test("fails a compaction with its error and clears the partial summary", async () => {
    await using acp = await startSession({
      capabilities: standard,
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          durableEvent("session.compaction.started", { sessionID, reason: "auto", recent: "" }),
          ephemeralEvent("session.compaction.delta", { sessionID, text: "partial" }),
          durableEvent("session.compaction.failed", { sessionID, reason: "auto", error: providerError }),
        ),
    })
    using events = await watchEvents(acp.server.url)

    await acp.prompt(acp.sessionId, "hello")

    const compactionId = await events.messageID("session.compaction.started")
    expect(turnUpdates(acp.updates)).toEqual([
      compaction(acp.sessionId, { compactionId, status: "in_progress" }),
      summaryChunk(acp.sessionId, compactionId, "partial"),
      compaction(acp.sessionId, { compactionId, status: "failed", summary: null, error: providerError.message }),
    ])
  })

  test("opens a compaction that fails before it starts before settling it", async () => {
    await using acp = await startSession({
      capabilities: standard,
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          durableEvent("session.compaction.failed", {
            sessionID,
            reason: "auto",
            error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
          }),
        ),
    })
    using events = await watchEvents(acp.server.url)

    await acp.prompt(acp.sessionId, "hello")

    const compactionId = await events.messageID("session.compaction.failed")
    expect(turnUpdates(acp.updates)).toEqual([
      compaction(acp.sessionId, { compactionId, status: "in_progress" }),
      compaction(acp.sessionId, { compactionId, status: "failed", summary: null, error: "Nothing to compact yet" }),
    ])
  })

  test("reports a defect as a generic failure and keeps core's own failure messages", async () => {
    const limit = { type: "compaction.failed", message: "Compaction summary reached the output token limit" }
    const defect = { type: "compaction.failed", message: "Error: database is locked\n    at run (compaction.ts:1:1)" }
    await using acp = await startSession({
      capabilities: standard,
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          durableEvent("session.compaction.started", { sessionID, reason: "auto", recent: "" }),
          durableEvent("session.compaction.failed", { sessionID, reason: "auto", error: limit }),
          durableEvent("session.compaction.started", { sessionID, reason: "auto", recent: "" }),
          durableEvent("session.compaction.failed", { sessionID, reason: "auto", error: defect }),
        ),
    })
    using events = await watchEvents(acp.server.url)

    await acp.prompt(acp.sessionId, "hello")

    const first = await events.messageID("session.compaction.started")
    const second = await events.messageID("session.compaction.started")
    expect(turnUpdates(acp.updates)).toEqual([
      compaction(acp.sessionId, { compactionId: first, status: "in_progress" }),
      compaction(acp.sessionId, { compactionId: first, status: "failed", summary: null, error: limit.message }),
      compaction(acp.sessionId, { compactionId: second, status: "in_progress" }),
      compaction(acp.sessionId, { compactionId: second, status: "failed", summary: null, error: "Compaction failed" }),
    ])
  })

  test("drops summary chunks outside an open compaction", async () => {
    await using acp = await startSession({
      capabilities: standard,
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          ephemeralEvent("session.compaction.delta", { sessionID, text: "early" }),
          durableEvent("session.compaction.started", { sessionID, reason: "auto", recent: "" }),
          durableEvent("session.compaction.ended", { sessionID, reason: "auto", text: summary, recent: "" }),
          ephemeralEvent("session.compaction.delta", { sessionID, text: "late" }),
        ),
    })
    using events = await watchEvents(acp.server.url)

    await acp.prompt(acp.sessionId, "hello")

    const compactionId = await events.messageID("session.compaction.started")
    expect(turnUpdates(acp.updates)).toEqual([
      compaction(acp.sessionId, { compactionId, status: "in_progress" }),
      compaction(acp.sessionId, { compactionId, status: "completed", summary: [{ type: "text", text: summary }] }),
    ])
  })

  test("cancels a compaction the server interrupts during a cancelled turn's wind-down", async () => {
    await using acp = await startSession({
      capabilities: standard,
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        durableEvent("session.compaction.started", { sessionID, reason: "auto", recent: "" }),
      ],
      onInterrupt: ({ sessionID }) => [
        durableEvent("session.compaction.failed", {
          sessionID,
          reason: "auto",
          error: { type: "compaction.interrupted", message: "Compaction was interrupted" },
        }),
        interrupted(sessionID),
      ],
    })
    using events = await watchEvents(acp.server.url)

    const prompt = acp.prompt(acp.sessionId, "hello")
    await acp.waitForUpdate((item) => item.update.sessionUpdate === "compaction_update")
    await acp.notify("session/cancel", { sessionId: acp.sessionId })

    expect((await prompt).stopReason).toBe("cancelled")
    const compactionId = await events.messageID("session.compaction.started")
    expect(updatesBeforeResponse(acp)).toEqual([
      compaction(acp.sessionId, { compactionId, status: "in_progress" }).update,
      compaction(acp.sessionId, { compactionId, status: "cancelled", summary: null }).update,
    ])
  })

  test("cancels a compaction left open when the wind-down never reports it", async () => {
    const submitted: string[] = []
    await using acp = await startSession({
      capabilities: standard,
      cancelDrainTimeout: "50 millis",
      onPrompt: ({ sessionID, id }) => {
        submitted.push(id)
        return [
          delivered(sessionID, id),
          durableEvent("session.compaction.started", { sessionID, reason: "manual", recent: "", inputID: id }),
          ephemeralEvent("session.compaction.delta", { sessionID, text: "partial" }),
        ]
      },
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await acp.waitForUpdate((item) => item.update.sessionUpdate === "compaction_summary_chunk")
    await acp.notify("session/cancel", { sessionId: acp.sessionId })

    expect((await prompt).stopReason).toBe("cancelled")
    const compactionId = submitted[0]
    expect(updatesBeforeResponse(acp)).toEqual([
      compaction(acp.sessionId, { compactionId, status: "in_progress" }).update,
      summaryChunk(acp.sessionId, compactionId, "partial").update,
      compaction(acp.sessionId, { compactionId, status: "cancelled", summary: null }).update,
    ])
  })

  test("closes the marker of a compaction left open when the wind-down never reports it", async () => {
    const submitted: string[] = []
    await using acp = await startSession({
      cancelDrainTimeout: "50 millis",
      onPrompt: ({ sessionID, id }) => {
        submitted.push(id)
        return [
          delivered(sessionID, id),
          durableEvent("session.compaction.started", { sessionID, reason: "manual", recent: "", inputID: id }),
        ]
      },
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await acp.waitForUpdate((item) => item.update.sessionUpdate === "session_info_update")
    await acp.notify("session/cancel", { sessionId: acp.sessionId })

    expect((await prompt).stopReason).toBe("cancelled")
    const messageId = submitted[0]
    expect(updatesBeforeResponse(acp)).toEqual([
      marker(acp.sessionId, { status: "started", messageId, reason: "manual" }).update,
      marker(acp.sessionId, {
        status: "failed",
        messageId,
        reason: "manual",
        error: { type: "aborted", message: "Compaction cancelled" },
      }).update,
    ])
  })

  test("keeps child compactions projected onto the parent as markers", async () => {
    await using acp = await startSession({
      capabilities: standard,
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
    using events = await watchEvents(acp.server.url)

    await acp.prompt(acp.sessionId, "hello")

    const messageId = await events.messageID("session.compaction.started")
    const child = { id: "ses_child", parentID: acp.sessionId, depth: 1, title: "Explore" }
    expect(turnUpdates(acp.updates).map((item) => item.update._meta)).toEqual([
      { "opencode/compaction": { status: "started", messageId, reason: "auto" }, "opencode/child-session": child },
      { "opencode/compaction": { status: "completed", messageId, reason: "auto" }, "opencode/child-session": child },
    ])
  })

  test("sends child compactions as standard updates through child session updates", async () => {
    await using acp = await startSession({
      capabilities: { ...standard, childSessionUpdates: true },
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          childCreated("ses_child", sessionID, "Explore"),
          durableEvent("session.compaction.started", { sessionID: "ses_child", reason: "auto", recent: "" }),
          durableEvent("session.compaction.ended", {
            sessionID: "ses_child",
            reason: "auto",
            text: summary,
            recent: "",
          }),
          succeeded("ses_child"),
        ),
    })
    using events = await watchEvents(acp.server.url)

    await acp.prompt(acp.sessionId, "hello")

    const compactionId = await events.messageID("session.compaction.started")
    const child = { "opencode/child-session": { id: "ses_child", parentID: acp.sessionId, depth: 1, title: "Explore" } }
    expect(acp.childUpdates.flatMap((item) => (item.type === "update" ? [item.update] : []))).toEqual([
      { sessionUpdate: "compaction_update", compactionId, status: "in_progress", _meta: child },
      {
        sessionUpdate: "compaction_update",
        compactionId,
        status: "completed",
        summary: [{ type: "text", text: summary }],
        _meta: child,
      },
    ])
    expect(turnUpdates(acp.updates)).toEqual([])
  })

  test("replays settled compactions as terminal updates at their position on session/load", async () => {
    await using acp = await startWire()
    acp.server.sessions.set("ses_compacted", makeSession("ses_compacted"))
    acp.server.messages.set("ses_compacted", [
      ...compactedHistory().slice(0, 3),
      {
        id: "msg_compaction_cancelled",
        type: "compaction",
        status: "failed",
        reason: "manual",
        error: { type: "aborted", message: "Compaction cancelled" },
        time: { created: 3 },
      },
      {
        id: "msg_compaction_native",
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary: "",
        recent: "",
        time: { created: 3 },
      },
      ...compactedHistory().slice(3),
    ])
    await acp.initialize(standard)

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
      compaction("ses_compacted", {
        compactionId: "msg_compaction_failed",
        status: "failed",
        summary: null,
        error: providerError.message,
      }),
      compaction("ses_compacted", {
        compactionId: "msg_compaction",
        status: "completed",
        summary: [{ type: "text", text: summary }],
      }),
      compaction("ses_compacted", { compactionId: "msg_compaction_cancelled", status: "cancelled", summary: null }),
      compaction("ses_compacted", { compactionId: "msg_compaction_native", status: "completed", summary: null }),
      chunk("ses_compacted", "msg_after", "after"),
    ])
  })

  test("treats a null compaction capability as unsupported", async () => {
    const compacted = await compactTurn(
      (sessionID, id) => [
        durableEvent("session.compaction.started", { sessionID, reason: "manual", recent: "", inputID: id }),
        ephemeralEvent("session.compaction.delta", { sessionID, text: summary }),
        durableEvent("session.compaction.ended", { sessionID, reason: "manual", text: summary, recent: "" }),
      ],
      { compaction: null },
    )
    await using acp = compacted.acp

    expect(turnUpdates(acp.updates)).toEqual([
      marker(acp.sessionId, { status: "started", messageId: compacted.id, reason: "manual" }),
      marker(acp.sessionId, { status: "completed", messageId: compacted.id, reason: "manual" }),
    ])
  })
})

// Holds the compact response so the test can publish the turn's events while the request is in flight.
async function compactTurn(
  events: (sessionID: string, id: string) => OpenCodeEvent[],
  capabilities?: InitializeOptions,
) {
  const held = Promise.withResolvers<Response>()
  const acp = await startSession({
    capabilities,
    fetch: (request) => (request.path.endsWith("/compact") ? held.promise : undefined),
  })
  const response = acp.prompt(acp.sessionId, "/compact")
  const request = await acp.until(
    () => acp.server.requests.find((item) => item.path.endsWith("/compact")),
    "compact request",
  )
  const id = decodeCompact(request.body).id
  acp.server.send(...turn(acp.sessionId, id, ...events(acp.sessionId, id)))
  held.resolve(enqueued(acp.sessionId, id, "compaction", {}))
  return { acp, id, response: await response }
}

// Core derives an automatic compaction's message ID from the event ID the server stamps on publish.
async function watchEvents(url: string) {
  const controller = new AbortController()
  const stream = OpenCode.make({ baseUrl: url }).event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
  await stream.next()
  return {
    async messageID(type: OpenCodeEvent["type"]) {
      while (true) {
        const next = await stream.next()
        if (next.done) throw new Error(`event stream ended before ${type}`)
        if (next.value.type === type) return SessionMessage.ID.fromEvent(Event.ID.make(next.value.id))
      }
    },
    [Symbol.dispose]: () => controller.abort(),
  }
}

function marker(sessionId: string, value: Record<string, unknown>): SessionNotification {
  return { sessionId, update: { sessionUpdate: "session_info_update", _meta: { "opencode/compaction": value } } }
}

function compaction(sessionId: string, update: CompactionUpdate): SessionNotification {
  return { sessionId, update: { sessionUpdate: "compaction_update", ...update } }
}

function summaryChunk(sessionId: string, compactionId: string, text: string): SessionNotification {
  return {
    sessionId,
    update: { sessionUpdate: "compaction_summary_chunk", compactionId, content: { type: "text", text } },
  }
}

function chunk(sessionId: string, messageId: string, text: string): SessionNotification {
  return { sessionId, update: { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } } }
}

const isCancelledResponse = Schema.is(
  Schema.Struct({ result: Schema.Struct({ stopReason: Schema.Literal("cancelled") }) }),
)

// Session updates the client received before the cancelled prompt response.
function updatesBeforeResponse(acp: Wire) {
  const response = acp.received.findIndex(isCancelledResponse)
  expect(response).toBeGreaterThan(-1)
  const count = acp.received
    .slice(0, response)
    .filter((message) => "method" in message && message.method === "session/update").length
  return turnUpdates(acp.updates.slice(0, count)).map((item) => item.update)
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
      error: providerError,
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
