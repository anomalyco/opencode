import { describe, expect, test } from "bun:test"
import type { CompactionUpdate, SessionNotification } from "@agentclientprotocol/sdk"
import type { OpenCodeEventEncoded } from "@opencode/protocol/groups/event"
import { Schema } from "effect"
import { durableEvent, enqueued, ephemeralEvent, startSession, turn, type InitializeOptions } from "./wire-fixture"

const summary = "Summary of the earlier conversation"
const decodeCompact = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))

describe("acp standard compaction updates over the wire", () => {
  test("streams a /compact turn's summary and completes it with the full summary", async () => {
    const compacted = await compactTurn(
      (sessionID, id) => [
        durableEvent("session.compaction.started", { sessionID, reason: "manual", recent: "", inputID: id }),
        ephemeralEvent("session.compaction.delta", { sessionID, text: "Summary of " }),
        ephemeralEvent("session.compaction.delta", { sessionID, text: "the earlier conversation" }),
        durableEvent("session.compaction.ended", { sessionID, reason: "manual", text: summary, recent: "" }),
      ],
      { compaction: {} },
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
  events: (sessionID: string, id: string) => OpenCodeEventEncoded[],
  capabilities: InitializeOptions,
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

function turnUpdates(updates: readonly SessionNotification[]) {
  return updates.filter(
    (item) => item.update.sessionUpdate !== "available_commands_update" && item.update.sessionUpdate !== "usage_update",
  )
}
