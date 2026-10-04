import { describe, expect, test } from "bun:test"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { OpenCodeEventEncoded } from "@opencode/protocol/groups/event"
import { Schema } from "effect"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { tmpdir } from "../fixture/tmpdir"
import {
  delivered,
  durableEvent,
  ephemeralEvent,
  failed,
  interrupted,
  makeSession,
  reasoningDelta,
  reviewCommand,
  rpcError,
  startSession,
  startWire,
  stepEnded,
  succeeded,
  textDelta,
  tokens,
  toolCalled,
  toolFailed,
  toolProgress,
  toolStarted,
  toolSucceeded,
  turn,
  type Wire,
  type WireOptions,
} from "./wire-fixture"

// A "hold" prompt is admitted and starts streaming, then only finishes when interrupted.
const held = {
  onPrompt: ({ sessionID, id, text }) =>
    text === "hold" ? [delivered(sessionID, id), textDelta(sessionID, "msg_held", "working")] : turn(sessionID, id),
  onInterrupt: ({ sessionID }) => [interrupted(sessionID)],
} satisfies WireOptions

describe("acp prompt turns over the wire", () => {
  test("streams an admitted turn and resolves with usage after its terminal event", async () => {
    const releaseAdmission = Promise.withResolvers<void>()
    await using acp = await startSession({ onPrompt: () => releaseAdmission.promise })
    await acp.request("session/set_config_option", {
      sessionId: acp.sessionId,
      configId: "model",
      value: "test/second-model",
    })
    acp.server.sessions.set(acp.sessionId, makeSession(acp.sessionId, { cost: 3.5 }))

    const prompt = acp.prompt(acp.sessionId, "hi")
    const settled = { value: false }
    void prompt.finally(() => {
      settled.value = true
    })
    const submitted = await acp.until(() => acp.server.prompts[0], "prompt submission")
    const sessionID = acp.sessionId
    acp.server.send(
      ...turn(
        sessionID,
        submitted.id,
        reasoningDelta(sessionID, "msg_assistant", "think-1"),
        reasoningDelta(sessionID, "msg_assistant", " continued"),
        textDelta(sessionID, "msg_assistant", "hello", 1),
        reasoningDelta(sessionID, "msg_assistant", "think-2", 1),
        toolStarted(sessionID, "call_ok", "shell"),
        toolCalled(sessionID, "call_ok", { command: "printf done", workdir: "sub" }),
        toolProgress(sessionID, "call_ok", { phase: 1 }),
        toolSucceeded(sessionID, "call_ok", { exit: 0 }, "done"),
        toolStarted(sessionID, "call_fail", "read"),
        toolCalled(sessionID, "call_fail", { path: "/workspace/missing.ts" }),
        toolFailed(sessionID, "call_fail", { error: { type: "tool.error", message: "not found" } }),
        stepEnded(sessionID, "msg_assistant", {
          tokens: { input: 100, output: 40, reasoning: 7, cache: { read: 11, write: 13 } },
        }),
      ),
    )
    await acp.until(() => turnUpdates(acp.updates).length === 11, "streamed updates")
    expect(settled.value).toBe(false)
    releaseAdmission.resolve()

    expect(await prompt).toEqual({
      stopReason: "end_turn",
      usage: {
        inputTokens: 100,
        outputTokens: 40,
        thoughtTokens: 7,
        cachedReadTokens: 11,
        cachedWriteTokens: 13,
        totalTokens: 171,
      },
      _meta: {},
    })
    expect(acp.server.submissions).toEqual([
      { kind: "prompt", sessionID, id: expect.stringMatching(/^msg_/), text: "hi", files: [], delivery: "steer" },
    ])
    expect(
      turnUpdates(acp.updates).map((item) => [
        item.update.sessionUpdate,
        "toolCallId" in item.update
          ? item.update.toolCallId
          : "messageId" in item.update
            ? item.update.messageId
            : undefined,
        "status" in item.update ? item.update.status : undefined,
      ]),
    ).toEqual([
      ["agent_thought_chunk", "msg_assistant:reasoning:0", undefined],
      ["agent_thought_chunk", "msg_assistant:reasoning:0", undefined],
      ["agent_message_chunk", "msg_assistant", undefined],
      ["agent_thought_chunk", "msg_assistant:reasoning:1", undefined],
      ["tool_call", "call_ok", "pending"],
      ["tool_call_update", "call_ok", "in_progress"],
      ["tool_call_update", "call_ok", "in_progress"],
      ["tool_call_update", "call_ok", "completed"],
      ["tool_call", "call_fail", "pending"],
      ["tool_call_update", "call_fail", "in_progress"],
      ["tool_call_update", "call_fail", "failed"],
    ])
    expect(turnUpdates(acp.updates)[2]?.update).toEqual({
      sessionUpdate: "agent_message_chunk",
      messageId: "msg_assistant",
      content: { type: "text", text: "hello" },
    })
    expect(turnUpdates(acp.updates)[5]?.update).toMatchObject({
      title: "printf done",
      kind: "execute",
      locations: [{ path: path.resolve("/workspace", "sub") }],
      rawInput: { command: "printf done", workdir: "sub" },
    })
    expect(turnUpdates(acp.updates)[7]?.update).toMatchObject({
      content: [{ type: "content", content: { type: "text", text: "done" } }],
      rawOutput: { metadata: { exit: 0 } },
    })
    expect(turnUpdates(acp.updates)[10]?.update).toMatchObject({
      content: [{ type: "content", content: { type: "text", text: "not found" } }],
      rawOutput: { error: "not found" },
    })
    expect(await acp.waitForUpdate((item) => item.update.sessionUpdate === "usage_update")).toEqual({
      sessionId: sessionID,
      update: { sessionUpdate: "usage_update", used: 171, size: 200_000, cost: { amount: 3.5, currency: "USD" } },
    })
  })

  test("routes slash commands and compact through their session endpoints", async () => {
    await using acp = await startWire()
    acp.server.catalog.commands = [reviewCommand, { name: "compact", description: "Server compact" }]
    await acp.initialize()
    const session = await acp.newSession()

    const command = await acp.prompt(session.sessionId, "/review now")
    const compact = await acp.prompt(session.sessionId, "/compact")

    expect([command.stopReason, compact.stopReason]).toEqual(["end_turn", "end_turn"])
    expect(acp.server.submissions).toEqual([
      { kind: "command", sessionID: session.sessionId, name: "review", text: "now", files: [], delivery: "steer" },
      { kind: "compact", sessionID: session.sessionId, id: expect.stringMatching(/^msg_/) },
    ])
    expect(
      (await acp.waitForUpdate((item) => item.update.sessionUpdate === "available_commands_update")).update,
    ).toEqual({
      sessionUpdate: "available_commands_update",
      availableCommands: [
        { name: "review", description: "Review changes" },
        { name: "compact", description: "Compact the session" },
      ],
    })
  })

  test("attaches readable file links and references unreadable ones in place", async () => {
    await using dir = await tmpdir()
    const file = pathToFileURL(path.join(dir.path, "notes.md")).href
    const folder = pathToFileURL(path.join(dir.path, "src")).href
    const missing = pathToFileURL(path.join(dir.path, "missing.md")).href
    const image = pathToFileURL(path.join(dir.path, "local.png")).href
    const missingImage = pathToFileURL(path.join(dir.path, "missing.png")).href
    await Bun.write(path.join(dir.path, "notes.md"), "# notes\n")
    await Bun.write(path.join(dir.path, "local.png"), "png")
    await mkdir(path.join(dir.path, "src"))
    await using acp = await startSession()

    const response = await acp.prompt(acp.sessionId, [
      { type: "text", text: "compare" },
      { type: "text", text: "hidden context", annotations: { audience: ["assistant"] } },
      { type: "resource_link", uri: file, name: "notes.md" },
      { type: "resource_link", uri: missing, name: "missing.md" },
      { type: "resource_link", uri: folder, name: "src" },
      { type: "image", data: "", mimeType: "image/png", uri: "https://example.com/remote.png" },
      { type: "image", data: "", mimeType: "image/png", uri: image },
      { type: "image", data: "", mimeType: "image/png", uri: missingImage },
      { type: "text", text: "please" },
    ])

    expect(response.stopReason).toBe("end_turn")
    expect(acp.server.submissions).toEqual([
      {
        kind: "synthetic",
        sessionID: acp.sessionId,
        text: "hidden context",
        description: "ACP embedded context",
        delivery: "steer",
        resume: false,
      },
      expect.objectContaining({
        kind: "prompt",
        text: `compare\n[missing.md](${missing})\n[remote.png](https://example.com/remote.png)\n[missing.png](${missingImage})\nplease`,
        files: [
          { uri: file, name: "notes.md" },
          { uri: folder, name: "src" },
          { uri: image, name: "local.png" },
        ],
      }),
    ])
    expect(
      await rpcError(
        acp.prompt(acp.sessionId, [
          { type: "text", text: "look" },
          { type: "image", data: "", mimeType: "image/png" },
        ]),
      ),
    ).toMatchObject({ code: -32602, message: expect.stringContaining("image content has no data or uri") })
    expect(acp.server.submissions).toHaveLength(2)
  })

  test.each<[string, (sessionID: string) => OpenCodeEventEncoded, object]>([
    [
      "an execution auth failure",
      (sessionID) => failed(sessionID, { type: "provider.auth", message: "missing key" }),
      { code: -32000 },
    ],
    [
      "a step auth failure",
      (sessionID) =>
        durableEvent("session.step.failed", {
          sessionID,
          assistantMessageID: "msg_auth",
          error: { type: "provider.auth", message: "expired" },
        }),
      { code: -32000 },
    ],
    [
      "another execution failure",
      (sessionID) => failed(sessionID, { type: "provider.rate-limit", message: "slow down" }),
      { code: -32603, message: expect.stringContaining("slow down") },
    ],
  ])("maps %s to an ACP error", async (_, failure, expected) => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        textDelta(sessionID, "msg_auth", "partial"),
        failure(sessionID),
        succeeded(sessionID),
      ],
    })

    expect(await rpcError(acp.prompt(acp.sessionId, "hello"))).toMatchObject(expected)
  })

  test("session/cancel before admission aborts the submission and returns cancelled", async () => {
    const aborted = Promise.withResolvers<void>()
    await using acp = await startSession({
      onPrompt: ({ signal }) =>
        new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted.resolve()
              resolve()
            },
            { once: true },
          )
        }),
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await acp.until(() => acp.server.submissions.length === 1, "prompt submission")
    await acp.notify("session/cancel", { sessionId: acp.sessionId })

    expect(await prompt).toEqual({ stopReason: "cancelled", _meta: {} })
    await aborted.promise
    expect(acp.server.interrupts).toEqual([acp.sessionId])
  })

  test("session/cancel forwards the server's wind-down before resolving cancelled", async () => {
    await using acp = await startSession({
      capabilities: { compaction: {} },
      onPrompt: ({ sessionID, id, text }) =>
        text === "again"
          ? turn(sessionID, id)
          : [
              delivered(sessionID, id),
              toolStarted(sessionID, "call_sleep", "shell"),
              toolCalled(sessionID, "call_sleep", { command: "sleep 60" }),
              durableEvent("session.compaction.started", { sessionID, reason: "manual", recent: "", inputID: id }),
              textDelta(sessionID, "msg_held", "working"),
            ],
      onInterrupt: ({ sessionID }) => [
        toolFailed(sessionID, "call_sleep", { error: { type: "aborted", message: "interrupted" } }),
        durableEvent("session.compaction.failed", {
          sessionID,
          reason: "manual",
          error: { type: "compaction.interrupted", message: "Compaction was interrupted" },
        }),
        durableEvent("session.step.failed", {
          sessionID,
          assistantMessageID: "msg_held",
          error: { type: "aborted", message: "interrupted" },
          cost: 0,
          tokens: { ...tokens(), input: 30, output: 3 },
        }),
        interrupted(sessionID),
      ],
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await admitted(acp, acp.sessionId)
    await acp.notify("session/cancel", { sessionId: acp.sessionId })

    expect(await prompt).toEqual({
      stopReason: "cancelled",
      usage: { inputTokens: 30, outputTokens: 3, totalTokens: 33 },
      _meta: {},
    })
    const before = receivedBeforeResponse(acp)
    expect(before).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionUpdate: "tool_call_update", toolCallId: "call_sleep", status: "failed" }),
        expect.objectContaining({ sessionUpdate: "usage_update", used: 33 }),
      ]),
    )
    expect(before.filter((update) => update.sessionUpdate === "compaction_update")).toMatchObject([
      { status: "in_progress" },
      { status: "cancelled", summary: null },
    ])
    expect(acp.server.interrupts).toEqual([acp.sessionId])
    expect((await acp.prompt(acp.sessionId, "again")).stopReason).toBe("end_turn")
  })

  test("stops waiting for a wind-down that never ends and fails the tools left running", async () => {
    await using acp = await startSession({
      capabilities: { compaction: {} },
      cancelDrainTimeout: "50 millis",
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        toolStarted(sessionID, "call_stuck", "shell"),
        toolCalled(sessionID, "call_stuck", { command: "sleep 60" }),
        durableEvent("session.compaction.started", { sessionID, reason: "manual", recent: "", inputID: id }),
        ephemeralEvent("session.compaction.delta", { sessionID, text: "partial" }),
        textDelta(sessionID, "msg_held", "working"),
      ],
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await admitted(acp, acp.sessionId)
    await acp.notify("session/cancel", { sessionId: acp.sessionId })

    expect(await prompt).toEqual({ stopReason: "cancelled", _meta: {} })
    const compactionId = acp.server.prompts[0]?.id
    const before = receivedBeforeResponse(acp)
    expect(before).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "tool_call_update",
        toolCallId: "call_stuck",
        status: "failed",
        rawOutput: expect.objectContaining({ error: "Cancelled" }),
      }),
    )
    expect(before.filter((update) => update.sessionUpdate.startsWith("compaction_"))).toEqual([
      { sessionUpdate: "compaction_update", compactionId, status: "in_progress" },
      { sessionUpdate: "compaction_summary_chunk", compactionId, content: { type: "text", text: "partial" } },
      { sessionUpdate: "compaction_update", compactionId, status: "cancelled", summary: null },
    ])
  })

  test("$/cancel_request on the prompt request cancels the turn like session/cancel", async () => {
    await using acp = await startSession(held)
    const controller = new AbortController()

    const prompt = acp.prompt(acp.sessionId, "hold", controller.signal)
    await admitted(acp, acp.sessionId)
    controller.abort()

    expect(await prompt).toMatchObject({ stopReason: "cancelled" })
    expect(acp.server.interrupts).toEqual([acp.sessionId])
    expect((await acp.prompt(acp.sessionId, "again")).stopReason).toBe("end_turn")
  })

  test("session/close settles the active turn before responding and detaches only that session", async () => {
    await using acp = await startSession(held)
    const other = await acp.newSession()

    const order: string[] = []
    const prompt = acp.prompt(acp.sessionId, "hold").then((response) => {
      order.push("prompt")
      return response
    })
    await admitted(acp, acp.sessionId)
    const close = await acp.request("session/close", { sessionId: acp.sessionId }).then((response) => {
      order.push("close")
      return response
    })

    expect(close).toEqual({})
    expect(await prompt).toMatchObject({ stopReason: "cancelled" })
    expect(order).toEqual(["prompt", "close"])
    expect(acp.server.interrupts).toEqual([acp.sessionId])
    expect(await rpcError(acp.prompt(acp.sessionId, "again"))).toMatchObject({
      code: -32602,
      data: { sessionId: acp.sessionId },
    })
    expect((await acp.prompt(other.sessionId, "still here")).stopReason).toBe("end_turn")

    expect((await acp.prompt(other.sessionId, "/review now")).stopReason).toBe("end_turn")
    await acp.request("session/close", { sessionId: other.sessionId })
    expect(acp.server.interrupts).toEqual([acp.sessionId, other.sessionId])
  })
})

// The server answered admission before streaming the chunk, and this request round-trips through the server after it,
// so the agent has observed admission before the test cancels.
async function admitted(acp: Wire, sessionId: string) {
  await acp.waitForUpdate((item) => item.update.sessionUpdate === "agent_message_chunk")
  await acp.request("session/set_mode", { sessionId, modeId: "build" })
}

const isCancelledResponse = Schema.is(
  Schema.Struct({ result: Schema.Struct({ stopReason: Schema.Literal("cancelled") }) }),
)

// Session updates the client received before the cancelled prompt response.
function receivedBeforeResponse(acp: Wire) {
  const response = acp.received.findIndex(isCancelledResponse)
  expect(response).toBeGreaterThan(-1)
  const count = acp.received
    .slice(0, response)
    .filter((message) => "method" in message && message.method === "session/update").length
  return acp.updates.slice(0, count).map((item) => item.update)
}

function turnUpdates(updates: readonly SessionNotification[]) {
  return updates.filter(
    (item) => item.update.sessionUpdate !== "available_commands_update" && item.update.sessionUpdate !== "usage_update",
  )
}
