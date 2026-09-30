import { describe, expect, test } from "bun:test"
import type { StopReason } from "@agentclientprotocol/sdk"
import type { OpenCodeEvent } from "@opencode/client/promise"
import {
  assistantMessage,
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
    acp.server.messages.set(acp.sessionId, [assistantMessage("msg_assistant")])

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
    await using acp = await startSession()

    await acp.prompt(acp.sessionId, [
      { type: "text", text: "visible" },
      { type: "text", text: "hidden context", annotations: { audience: ["assistant"] } },
      { type: "resource_link", uri: "file:///workspace/README.md", name: "README.md", mimeType: "text/markdown" },
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
        files: [{ uri: "file:///workspace/README.md", name: "README.md" }],
      }),
    ])
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
    acp.server.messages.set(acp.sessionId, [assistantMessage("msg_assistant", { tokens: assistantTokens })])

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
    acp.server.messages.set(acp.sessionId, [assistantMessage("msg_assistant")])

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
  })

  test.each<{ name: string; stopReason: StopReason; events: (sessionID: string) => OpenCodeEvent[] }>([
    { name: "a normal stop", stopReason: "end_turn", events: (id) => [stepEnded(id, "msg"), succeeded(id)] },
    {
      name: "a length-limited step",
      stopReason: "max_tokens",
      events: (id) => [stepEnded(id, "msg", { finish: "length" }), succeeded(id)],
    },
    {
      name: "a content-filtered step",
      stopReason: "refusal",
      events: (id) => [stepEnded(id, "msg", { finish: "content-filter" }), succeeded(id)],
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

  test("maps an assistant message auth error to auth required", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(sessionID, id, textDelta(sessionID, "msg_auth", "partial"), stepEnded(sessionID, "msg_auth")),
    })
    acp.server.messages.set(acp.sessionId, [
      assistantMessage("msg_auth", { error: { type: "provider.auth", message: "expired" } }),
    ])

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

  test("session/cancel mid-turn interrupts the session once, returns cancelled, and keeps it usable", async () => {
    await using acp = await startSession(held)

    const prompt = acp.prompt(acp.sessionId, "hold")
    await admitted(acp, acp.sessionId)
    await acp.notify("session/cancel", { sessionId: acp.sessionId })

    expect(await prompt).toMatchObject({ stopReason: "cancelled" })
    expect(acp.server.interrupts).toEqual([acp.sessionId])
    expect((await acp.prompt(acp.sessionId, "again")).stopReason).toBe("end_turn")
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

  test.todo(
    "reports usage summed across every step of the turn (https://github.com/anomalyco/opencode/issues/41660)",
    async () => {
      await using acp = await startSession({
        onPrompt: ({ sessionID, id }) =>
          turn(
            sessionID,
            id,
            stepEnded(sessionID, "msg_step_1", { finish: "tool-calls", tokens: { ...tokens(), input: 10, output: 5 } }),
            stepEnded(sessionID, "msg_step_2", { tokens: { ...tokens(), input: 20, output: 7 } }),
          ),
      })
      acp.server.messages.set(acp.sessionId, [
        assistantMessage("msg_step_2", { tokens: { ...tokens(), input: 20, output: 7 } }),
      ])

      const response = await acp.prompt(acp.sessionId, "hello")

      expect(response.usage).toEqual({ inputTokens: 30, outputTokens: 12, totalTokens: 42 })
    },
  )
})

// The server answered admission before streaming the chunk, and this request round-trips through the server after it,
// so the agent has observed admission before the test cancels.
async function admitted(acp: Wire, sessionId: string) {
  await acp.waitForUpdate((item) => item.update.sessionUpdate === "agent_message_chunk")
  await acp.request("session/set_mode", { sessionId, modeId: "build" })
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
