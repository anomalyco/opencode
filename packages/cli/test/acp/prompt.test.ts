import { describe, expect, test } from "bun:test"
import type { StopReason } from "@agentclientprotocol/sdk"
import type { OpenCodeEvent } from "@opencode/client/promise"
import { Schema } from "effect"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { tmpdir } from "../fixture/tmpdir"
import {
  childCreated,
  delivered,
  durableEvent,
  failed,
  interrupted,
  makeSession,
  rpcError,
  startSession,
  stepEnded,
  succeeded,
  textDelta,
  tokens,
  toolCalled,
  toolFailed,
  toolStarted,
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
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(sessionID, id, textDelta(sessionID, "msg_assistant", "hello"), stepEnded(sessionID, "msg_assistant")),
    })

    const response = await acp.prompt(acp.sessionId, "hi")

    expect(response).toEqual({
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      _meta: {},
    })
    expect(acp.updates.filter((item) => item.update.sessionUpdate === "agent_message_chunk")).toEqual([
      {
        sessionId: acp.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg_assistant",
          content: { type: "text", text: "hello" },
        },
      },
    ])
    expect(acp.server.submissions).toEqual([
      {
        kind: "prompt",
        sessionID: acp.sessionId,
        id: expect.stringMatching(/^msg_/),
        text: "hi",
        files: [],
        delivery: "steer",
      },
    ])
  })

  test("routes slash commands and compact through their session endpoints", async () => {
    await using acp = await startSession()

    const command = await acp.prompt(acp.sessionId, "/review now")
    const compact = await acp.prompt(acp.sessionId, "/compact")

    expect([command.stopReason, compact.stopReason]).toEqual(["end_turn", "end_turn"])
    expect(acp.server.submissions).toEqual([
      { kind: "command", sessionID: acp.sessionId, name: "review", text: "now", files: [], delivery: "steer" },
      { kind: "compact", sessionID: acp.sessionId, id: expect.stringMatching(/^msg_/) },
    ])
  })

  test("submits assistant-only context as synthetic input before the visible prompt", async () => {
    await using dir = await tmpdir()
    const readme = pathToFileURL(path.join(dir.path, "README.md")).href
    await Bun.write(path.join(dir.path, "README.md"), "# readme\n")
    await using acp = await startSession()

    await acp.prompt(acp.sessionId, [
      { type: "text", text: "visible" },
      { type: "text", text: "hidden context", annotations: { audience: ["assistant"] } },
      { type: "resource_link", uri: readme, name: "README.md", mimeType: "text/markdown" },
    ])

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
        text: "visible",
        files: [{ uri: readme, name: "README.md" }],
      }),
    ])
  })

  test("attaches readable file links and references unreadable ones in place", async () => {
    await using dir = await tmpdir()
    const file = pathToFileURL(path.join(dir.path, "notes.md")).href
    const folder = pathToFileURL(path.join(dir.path, "src")).href
    const missing = pathToFileURL(path.join(dir.path, "missing.md")).href
    await Bun.write(path.join(dir.path, "notes.md"), "# notes\n")
    await mkdir(path.join(dir.path, "src"))
    await using acp = await startSession()

    const response = await acp.prompt(acp.sessionId, [
      { type: "text", text: "compare" },
      { type: "resource_link", uri: file, name: "notes.md" },
      { type: "resource_link", uri: missing, name: "missing.md" },
      { type: "resource_link", uri: folder, name: "src" },
      { type: "text", text: "please" },
    ])

    expect(response.stopReason).toBe("end_turn")
    expect(acp.server.submissions).toEqual([
      expect.objectContaining({
        kind: "prompt",
        text: `compare\n[missing.md](${missing})\nplease`,
        files: [
          { uri: file, name: "notes.md" },
          { uri: folder, name: "src" },
        ],
      }),
    ])
  })

  test("attaches local image links and references remote or unreadable ones in place", async () => {
    await using dir = await tmpdir()
    const local = pathToFileURL(path.join(dir.path, "local.png")).href
    const missing = pathToFileURL(path.join(dir.path, "missing.png")).href
    await Bun.write(path.join(dir.path, "local.png"), "png")
    await using acp = await startSession()

    const response = await acp.prompt(acp.sessionId, [
      { type: "text", text: "compare" },
      { type: "image", data: "", mimeType: "image/png", uri: "https://example.com/remote.png" },
      { type: "image", data: "", mimeType: "image/png", uri: local },
      { type: "image", data: "", mimeType: "image/png", uri: missing },
    ])

    expect(response.stopReason).toBe("end_turn")
    expect(acp.server.submissions).toEqual([
      expect.objectContaining({
        kind: "prompt",
        text: `compare\n[remote.png](https://example.com/remote.png)\n[missing.png](${missing})`,
        files: [{ uri: local, name: "local.png" }],
      }),
    ])
  })

  test("rejects an image with neither data nor uri as invalid params", async () => {
    await using acp = await startSession()

    expect(
      await rpcError(
        acp.prompt(acp.sessionId, [
          { type: "text", text: "look" },
          { type: "image", data: "", mimeType: "image/png" },
        ]),
      ),
    ).toMatchObject({ code: -32602, message: expect.stringContaining("image content has no data or uri") })
    expect(acp.server.submissions).toEqual([])
  })

  test("returns turn usage and publishes current context usage with cumulative session cost", async () => {
    const assistantTokens = { input: 100, output: 40, reasoning: 7, cache: { read: 11, write: 13 } }
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(sessionID, id, stepEnded(sessionID, "msg_assistant", { tokens: assistantTokens })),
    })
    await acp.request("session/set_config_option", {
      sessionId: acp.sessionId,
      configId: "model",
      value: "test/second-model",
    })
    acp.server.sessions.set(acp.sessionId, makeSession(acp.sessionId, { cost: 3.5 }))

    const response = await acp.prompt(acp.sessionId, "hello")

    expect(response).toEqual({
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
    expect(await acp.waitForUpdate((item) => item.update.sessionUpdate === "usage_update")).toEqual({
      sessionId: acp.sessionId,
      update: { sessionUpdate: "usage_update", used: 171, size: 200_000, cost: { amount: 3.5, currency: "USD" } },
    })
  })

  test("completes the prompt when reads after admission fail", async () => {
    const reads = { failing: false }
    await using acp = await startSession({
      fetch: (request) => (reads.failing && request.method === "GET" ? new Response(null, { status: 500 }) : undefined),
      onPrompt: ({ sessionID, id }) => {
        reads.failing = true
        return turn(sessionID, id, stepEnded(sessionID, "msg_assistant"))
      },
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
  })

  test.each<{ name: string; stopReason: StopReason; events: (sessionID: string) => OpenCodeEvent[] }>([
    { name: "a normal stop", stopReason: "end_turn", events: (id) => [stepEnded(id, "msg_1"), succeeded(id)] },
    {
      name: "a length-limited step",
      stopReason: "max_tokens",
      events: (id) => [stepEnded(id, "msg_1", { finish: "length" }), succeeded(id)],
    },
    {
      name: "a content-filtered step",
      stopReason: "refusal",
      events: (id) => [stepEnded(id, "msg_1", { finish: "content-filter" }), succeeded(id)],
    },
    {
      name: "a content-filter failure",
      stopReason: "refusal",
      events: (id) => [failed(id, { type: "provider.content-filter", message: "blocked" })],
    },
    {
      name: "a server-side interruption",
      stopReason: "cancelled",
      events: (id) => [durableEvent("session.execution.interrupted", { sessionID: id, reason: "shutdown" })],
    },
  ])("maps $name to $stopReason", async (input) => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => [delivered(sessionID, id), ...input.events(sessionID)],
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe(input.stopReason)
  })

  test("maps provider auth failures to auth required", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        failed(sessionID, { type: "provider.auth", message: "missing key" }),
      ],
    })

    expect(await rpcError(acp.prompt(acp.sessionId, "hello"))).toMatchObject({ code: -32000 })
  })

  test("maps an assistant step auth error to auth required", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          textDelta(sessionID, "msg_auth", "partial"),
          durableEvent("session.step.failed", {
            sessionID,
            assistantMessageID: "msg_auth",
            error: { type: "provider.auth", message: "expired" },
          }),
        ),
    })

    expect(await rpcError(acp.prompt(acp.sessionId, "hello"))).toMatchObject({ code: -32000 })
  })

  test("surfaces other execution failures as internal errors with the failure message", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        failed(sessionID, { type: "provider.rate-limit", message: "slow down" }),
      ],
    })

    expect(await rpcError(acp.prompt(acp.sessionId, "hello"))).toMatchObject({
      code: -32603,
      message: expect.stringContaining("slow down"),
    })
  })

  test("reports provider retries while pending and clears them when the next step starts", async () => {
    const at = Date.UTC(2026, 0, 1)
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          retryScheduled(sessionID, 2, at),
          durableEvent("session.step.started", {
            sessionID,
            assistantMessageID: "msg_retry",
            agent: "build",
            model: { providerID: "test", id: "test-model" },
            started: at,
          }),
          stepEnded(sessionID, "msg_retry"),
        ),
    })

    const response = await acp.prompt(acp.sessionId, "hello")

    expect(acp.updates.filter((item) => item.update.sessionUpdate === "session_info_update")).toEqual([
      {
        sessionId: acp.sessionId,
        update: { sessionUpdate: "session_info_update", _meta: { "opencode/retry": retryMeta(2, at) } },
      },
      {
        sessionId: acp.sessionId,
        update: { sessionUpdate: "session_info_update", _meta: { "opencode/retry": null } },
      },
    ])
    expect(response._meta).toEqual({})
  })

  test("reports the pending retry on a turn cancelled during backoff", async () => {
    const at = Date.UTC(2026, 0, 1)
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => [delivered(sessionID, id), retryScheduled(sessionID, 1, at)],
      onInterrupt: held.onInterrupt,
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await acp.waitForUpdate((item) => item.update.sessionUpdate === "session_info_update")
    await acp.notify("session/cancel", { sessionId: acp.sessionId })

    expect(await prompt).toEqual({ stopReason: "cancelled", _meta: { "opencode/retry": retryMeta(1, at) } })
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
    expect(acp.server.interrupts).toContain(acp.sessionId)
  })

  test("session/cancel before admission returns interrupts the session exactly once", async () => {
    await using acp = await startSession({
      onPrompt: ({ signal }) =>
        new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })),
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await acp.until(() => acp.server.submissions.length === 1, "prompt submission")
    await acp.notify("session/cancel", { sessionId: acp.sessionId })

    expect(await prompt).toEqual({ stopReason: "cancelled", _meta: {} })
    expect(acp.server.interrupts).toEqual([acp.sessionId])
  })

  test("session/cancel mid-turn interrupts the session once, returns cancelled, and keeps it usable", async () => {
    await using acp = await startSession(held)

    const prompt = acp.prompt(acp.sessionId, "hold")
    await admitted(acp, acp.sessionId)
    await acp.notify("session/cancel", { sessionId: acp.sessionId })

    expect(await prompt).toMatchObject({ stopReason: "cancelled" })
    expect(acp.server.interrupts).toEqual([acp.sessionId])
    expect((await acp.prompt(acp.sessionId, "again")).stopReason).toBe("end_turn")
  })

  test("session/cancel forwards the server's wind-down before resolving cancelled", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        toolStarted(sessionID, "call_sleep", "shell"),
        toolCalled(sessionID, "call_sleep", { command: "sleep 60" }),
        textDelta(sessionID, "msg_held", "working"),
      ],
      onInterrupt: ({ sessionID }) => [
        toolFailed(sessionID, "call_sleep", { error: { type: "aborted", message: "interrupted" } }),
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
    expect(receivedBeforeResponse(acp)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionUpdate: "tool_call_update", toolCallId: "call_sleep", status: "failed" }),
        expect.objectContaining({ sessionUpdate: "usage_update", used: 33 }),
      ]),
    )
    expect(acp.server.interrupts).toEqual([acp.sessionId])
  })

  test("stops waiting for a wind-down that never ends and fails the tools left running", async () => {
    await using acp = await startSession({
      cancelDrainTimeout: "50 millis",
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        toolStarted(sessionID, "call_stuck", "shell"),
        toolCalled(sessionID, "call_stuck", { command: "sleep 60" }),
        textDelta(sessionID, "msg_held", "working"),
      ],
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await admitted(acp, acp.sessionId)
    await acp.notify("session/cancel", { sessionId: acp.sessionId })

    expect(await prompt).toEqual({ stopReason: "cancelled", _meta: {} })
    expect(receivedBeforeResponse(acp)).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "tool_call_update",
        toolCallId: "call_stuck",
        status: "failed",
        rawOutput: expect.objectContaining({ error: "Cancelled" }),
      }),
    )
  })

  test("session/close interrupts a slash command still running after its prompt ended", async () => {
    await using acp = await startSession()

    expect((await acp.prompt(acp.sessionId, "/review now")).stopReason).toBe("end_turn")
    expect(acp.server.interrupts).toEqual([])
    await acp.request("session/close", { sessionId: acp.sessionId })

    expect(acp.server.interrupts).toEqual([acp.sessionId])
  })

  test("fails the prompt as server unavailable when the event stream ends mid-turn", async () => {
    await using acp = await startSession(held)

    const prompt = acp.prompt(acp.sessionId, "hold")
    await admitted(acp, acp.sessionId)
    acp.server.closeEvents()

    expect(await rpcError(prompt)).toMatchObject({ code: -32603, data: { errorName: "ServerUnavailable" } })
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
  })

  test("rejects a second prompt while the session already has an active turn", async () => {
    await using acp = await startSession(held)

    const first = acp.prompt(acp.sessionId, "hold")
    await acp.until(() => acp.server.submissions.length === 1, "first prompt")

    expect(await rpcError(acp.prompt(acp.sessionId, "second"))).toMatchObject({ code: -32603 })
    expect(acp.server.submissions).toHaveLength(1)
    await acp.notify("session/cancel", { sessionId: acp.sessionId })
    expect((await first).stopReason).toBe("cancelled")
  })

  test("reports usage summed across every step of the turn", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          stepEnded(sessionID, "msg_step_1", { finish: "tool-calls", tokens: { ...tokens(), input: 10, output: 5 } }),
          stepEnded(sessionID, "msg_step_2", { tokens: { ...tokens(), input: 20, output: 7 } }),
        ),
    })

    const response = await acp.prompt(acp.sessionId, "hello")

    expect(response.usage).toEqual({ inputTokens: 30, outputTokens: 12, totalTokens: 42 })
  })

  test("publishes the last step's context usage rather than the turn sum", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          stepEnded(sessionID, "msg_step_1", {
            finish: "tool-calls",
            tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 50 } },
          }),
          stepEnded(sessionID, "msg_step_2", {
            tokens: { input: 20, output: 5, reasoning: 3, cache: { read: 150, write: 0 } },
          }),
        ),
    })

    const response = await acp.prompt(acp.sessionId, "hello")

    expect(response.usage).toEqual({
      inputTokens: 120,
      outputTokens: 15,
      thoughtTokens: 3,
      cachedReadTokens: 150,
      cachedWriteTokens: 50,
      totalTokens: 338,
    })
    expect(await acp.waitForUpdate((item) => item.update.sessionUpdate === "usage_update")).toEqual({
      sessionId: acp.sessionId,
      update: { sessionUpdate: "usage_update", used: 178, size: 100_000, cost: { amount: 0, currency: "USD" } },
    })
  })

  test("counts a failed step's tokens and clears its error when the next step starts", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          durableEvent("session.step.failed", {
            sessionID,
            assistantMessageID: "msg_1",
            error: { type: "provider.stream", message: "stream interrupted" },
            cost: 0,
            tokens: { ...tokens(), input: 40, output: 4 },
          }),
          durableEvent("session.step.started", {
            sessionID,
            assistantMessageID: "msg_2",
            agent: "build",
            model: { providerID: "test", id: "test-model" },
            started: 0,
          }),
          stepEnded(sessionID, "msg_2", { tokens: { ...tokens(), input: 20, output: 7 } }),
        ),
    })

    const response = await acp.prompt(acp.sessionId, "hello")

    expect(response).toEqual({
      stopReason: "end_turn",
      usage: { inputTokens: 60, outputTokens: 11, totalTokens: 71 },
      _meta: {},
    })
    expect(await acp.waitForUpdate((item) => item.update.sessionUpdate === "usage_update")).toMatchObject({
      update: { used: 27 },
    })
  })

  test("excludes child session steps from the turn usage", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          childCreated("ses_child", sessionID, "Explore"),
          stepEnded("ses_child", "msg_child", { tokens: { ...tokens(), input: 500, output: 50 } }),
          succeeded("ses_child"),
          stepEnded(sessionID, "msg_root", { tokens: { ...tokens(), input: 20, output: 7 } }),
        ),
    })

    const response = await acp.prompt(acp.sessionId, "hello")

    expect(response.usage).toEqual({ inputTokens: 20, outputTokens: 7, totalTokens: 27 })
    expect(await acp.waitForUpdate((item) => item.update.sessionUpdate === "usage_update")).toMatchObject({
      update: { used: 27 },
    })
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

function retryScheduled(sessionID: string, attempt: number, at: number) {
  return durableEvent("session.retry.scheduled", {
    sessionID,
    assistantMessageID: "msg_retry",
    attempt,
    at,
    error: { type: "provider.rate-limit", message: "rate limited" },
  })
}

function retryMeta(attempt: number, at: number) {
  return {
    attempt,
    nextRetryAt: new Date(at).toISOString(),
    error: { type: "provider.rate-limit", message: "rate limited" },
  }
}
