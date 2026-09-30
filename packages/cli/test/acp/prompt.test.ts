import { describe, expect, test } from "bun:test"
import {
  assistantMessage,
  delivered,
  durableEvent,
  makeSession,
  rpcError,
  secondModel,
  startWire,
  stepEnded,
  succeeded,
  textDelta,
  tokens,
  type WireOptions,
} from "./wire-fixture"

// Prompts whose text is "hold" are admitted and start streaming but only finish when interrupted.
const held = {
  onPrompt({ sessionID, id, body, send }) {
    send(delivered(sessionID, id))
    if (JSON.stringify(body).includes('"hold"')) {
      send(textDelta(sessionID, "msg_held", "working"))
      return
    }
    send(succeeded(sessionID))
  },
  onInterrupt({ sessionID, send }) {
    send(durableEvent("session.execution.interrupted", { sessionID, reason: "user" }))
    return true
  },
} satisfies WireOptions

describe("acp prompt turns over the wire", () => {
  test("streams an admitted turn and resolves with usage after its terminal event", async () => {
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(textDelta(sessionID, "msg_assistant", "hello"))
        send(stepEnded(sessionID, "msg_assistant"))
        send(succeeded(sessionID))
      },
    })
    await acp.initialize()
    const session = await acp.newSession()

    const response = await acp.prompt(session.sessionId, "hi")

    expect(acp.updates.map((item) => item.update.sessionUpdate)).toEqual([
      "available_commands_update",
      "agent_message_chunk",
      "usage_update",
    ])
    expect(acp.updates[1]).toEqual({
      sessionId: session.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg_assistant",
        content: { type: "text", text: "hello" },
      },
    })
    expect(response).toEqual({
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      _meta: {},
    })
    expect(acp.server.requests.find((request) => request.path.endsWith("/prompt"))?.body).toEqual({
      id: expect.stringMatching(/^msg_/),
      text: "hi",
      files: [],
      delivery: "steer",
    })
  })

  test("routes slash commands and compact through their session endpoints", async () => {
    await using acp = await startWire()
    await acp.initialize()
    const session = await acp.newSession()

    const command = await acp.prompt(session.sessionId, "/review now")
    const compact = await acp.prompt(session.sessionId, "/compact")

    expect([command, compact]).toEqual([
      { stopReason: "end_turn", _meta: {} },
      { stopReason: "end_turn", _meta: {} },
    ])
    expect(
      acp.server.requests.find((request) => request.path === `/api/session/${session.sessionId}/command`)?.body,
    ).toEqual({
      name: "review",
      text: "now",
      files: [],
      delivery: "steer",
    })
    expect(
      acp.server.requests.find((request) => request.path === `/api/session/${session.sessionId}/compact`)?.body,
    ).toEqual({
      id: expect.stringMatching(/^msg_/),
    })
    expect(acp.server.requests.some((request) => request.path.endsWith("/prompt"))).toBe(false)
  })

  test("submits assistant-only context as synthetic input before the visible prompt", async () => {
    await using acp = await startWire()
    await acp.initialize()
    const session = await acp.newSession()

    await acp.prompt(session.sessionId, [
      { type: "text", text: "visible" },
      { type: "text", text: "hidden context", annotations: { audience: ["assistant"] } },
      { type: "resource_link", uri: "file:///workspace/README.md", name: "README.md", mimeType: "text/markdown" },
    ])

    const submitted = acp.server.requests.filter(
      (request) => request.method === "POST" && request.path.startsWith("/api/session/"),
    )
    expect(submitted.map((request) => request.path)).toEqual([
      `/api/session/${session.sessionId}/synthetic`,
      `/api/session/${session.sessionId}/prompt`,
    ])
    expect(submitted[0]?.body).toEqual({
      text: "hidden context",
      description: "ACP embedded context",
      delivery: "steer",
      resume: false,
    })
    expect(submitted[1]?.body).toMatchObject({
      text: "visible",
      files: [{ uri: "file:///workspace/README.md", name: "README.md" }],
    })
  })

  test("returns turn usage and publishes current context usage with cumulative session cost", async () => {
    const assistantTokens = { input: 100, output: 40, reasoning: 7, cache: { read: 11, write: 13 } }
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(stepEnded(sessionID, "msg_assistant", { tokens: assistantTokens }))
        send(succeeded(sessionID))
      },
    })
    await acp.initialize()
    const session = await acp.newSession()
    await acp.request("session/set_config_option", {
      sessionId: session.sessionId,
      configId: "model",
      value: "test/second-model",
    })
    acp.server.sessions.set(
      session.sessionId,
      makeSession(session.sessionId, {
        model: { providerID: "test", id: secondModel.id },
        cost: 3.5,
        tokens: { input: 120, output: 50, reasoning: 8, cache: { read: 30, write: 4 } },
      }),
    )
    acp.server.messages.set(session.sessionId, [
      assistantMessage("msg_assistant", { model: { providerID: "test", id: secondModel.id }, tokens: assistantTokens }),
    ])

    const response = await acp.prompt(session.sessionId, "hello")

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
    expect(acp.updates.filter((item) => item.update.sessionUpdate === "usage_update")).toEqual([
      {
        sessionId: session.sessionId,
        update: { sessionUpdate: "usage_update", used: 171, size: 200_000, cost: { amount: 3.5, currency: "USD" } },
      },
    ])
  })

  test("does not fail a completed prompt when the usage refresh fails", async () => {
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(stepEnded(sessionID, "msg_usage_failure", { tokens: { ...tokens(), input: 3, output: 2 } }))
        send(succeeded(sessionID))
      },
      fetch(request) {
        if (request.method === "GET" && request.path === "/api/session/ses_1")
          return new Response(null, { status: 500 })
        return undefined
      },
    })
    await acp.initialize()
    const session = await acp.newSession()

    const response = await acp.prompt(session.sessionId, "hello")

    expect(response.stopReason).toBe("end_turn")
    expect(acp.updates.some((item) => item.update.sessionUpdate === "usage_update")).toBe(false)
  })

  test.each([
    { name: "end_turn for a normal stop", finish: "stop", stopReason: "end_turn" },
    { name: "max_tokens when the step hit the length limit", finish: "length", stopReason: "max_tokens" },
    { name: "refusal when the step was content filtered", finish: "content-filter", stopReason: "refusal" },
  ] as const)("maps the final step finish to $stopReason: $name", async (input) => {
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(stepEnded(sessionID, "msg_finish", { finish: input.finish }))
        send(succeeded(sessionID))
      },
    })
    await acp.initialize()
    const session = await acp.newSession()

    expect((await acp.prompt(session.sessionId, "hello")).stopReason).toBe(input.stopReason)
  })

  test("maps content-filter failures to refusal and server-side interruption to cancelled", async () => {
    await using acp = await startWire({
      onPrompt({ sessionID, id, body, send }) {
        send(delivered(sessionID, id))
        if (JSON.stringify(body).includes("filtered")) {
          send(
            durableEvent("session.execution.failed", {
              sessionID,
              error: { type: "provider.content-filter", message: "blocked" },
            }),
          )
          return
        }
        send(durableEvent("session.execution.interrupted", { sessionID, reason: "shutdown" }))
      },
    })
    await acp.initialize()
    const session = await acp.newSession()

    expect((await acp.prompt(session.sessionId, "filtered")).stopReason).toBe("refusal")
    expect((await acp.prompt(session.sessionId, "interrupted")).stopReason).toBe("cancelled")
  })

  test("maps provider auth failures to auth required and other failures to internal errors", async () => {
    await using acp = await startWire({
      onPrompt({ sessionID, id, body, send }) {
        send(delivered(sessionID, id))
        if (JSON.stringify(body).includes("assistant auth")) {
          send(textDelta(sessionID, "msg_auth", "partial"))
          send(stepEnded(sessionID, "msg_auth"))
          send(succeeded(sessionID))
          return
        }
        const error = JSON.stringify(body).includes("auth")
          ? { type: "provider.auth", message: "missing key" }
          : { type: "provider.rate-limit", message: "slow down" }
        send(durableEvent("session.execution.failed", { sessionID, error }))
      },
    })
    await acp.initialize()
    const session = await acp.newSession()
    acp.server.messages.set(session.sessionId, [
      assistantMessage("msg_auth", { error: { type: "provider.auth", message: "expired" } }),
    ])

    expect(await rpcError(acp.prompt(session.sessionId, "auth"))).toEqual({
      code: -32000,
      message: "Authentication required: provider authentication required",
      data: {},
    })
    expect(await rpcError(acp.prompt(session.sessionId, "assistant auth"))).toMatchObject({ code: -32000 })
    expect(await rpcError(acp.prompt(session.sessionId, "other"))).toEqual({
      code: -32603,
      message: "Internal error: slow down",
      data: { service: "session", errorName: "provider.rate-limit" },
    })
  })

  test("reports provider retries while pending and clears them when the next step starts", async () => {
    const at = Date.UTC(2026, 0, 1)
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(
          durableEvent("session.retry.scheduled", {
            sessionID,
            assistantMessageID: "msg_retry",
            attempt: 2,
            at,
            error: { type: "provider.rate-limit", message: "rate limited" },
          }),
        )
        send(
          durableEvent("session.step.started", {
            sessionID,
            assistantMessageID: "msg_retry",
            agent: "build",
            model: { providerID: "test", id: "test-model" },
            started: at,
          }),
        )
        send(stepEnded(sessionID, "msg_retry"))
        send(succeeded(sessionID))
      },
    })
    await acp.initialize()
    const session = await acp.newSession()

    const response = await acp.prompt(session.sessionId, "hello")

    expect(acp.updates.filter((item) => item.update.sessionUpdate === "session_info_update")).toEqual([
      {
        sessionId: session.sessionId,
        update: {
          sessionUpdate: "session_info_update",
          _meta: {
            "opencode/retry": {
              attempt: 2,
              nextRetryAt: new Date(at).toISOString(),
              error: { type: "provider.rate-limit", message: "rate limited" },
            },
          },
        },
      },
      {
        sessionId: session.sessionId,
        update: { sessionUpdate: "session_info_update", _meta: { "opencode/retry": null } },
      },
    ])
    expect(response._meta).toEqual({})
  })

  test("reports the pending retry on a turn cancelled during backoff", async () => {
    const at = Date.UTC(2026, 0, 1)
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(
          durableEvent("session.retry.scheduled", {
            sessionID,
            assistantMessageID: "msg_retry",
            attempt: 1,
            at,
            error: { type: "provider.rate-limit", message: "rate limited" },
          }),
        )
      },
      onInterrupt: held.onInterrupt,
    })
    await acp.initialize()
    const session = await acp.newSession()

    const prompt = acp.prompt(session.sessionId, "hello")
    await acp.waitForUpdate((item) => item.update.sessionUpdate === "session_info_update")
    await acp.notify("session/cancel", { sessionId: session.sessionId })

    expect(await prompt).toEqual({
      stopReason: "cancelled",
      _meta: {
        "opencode/retry": {
          attempt: 1,
          nextRetryAt: new Date(at).toISOString(),
          error: { type: "provider.rate-limit", message: "rate limited" },
        },
      },
    })
  })

  test("session/cancel before admission aborts the submission and returns cancelled", async () => {
    const aborted = Promise.withResolvers<void>()
    await using acp = await startWire({
      onPrompt({ signal }) {
        return new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted.resolve()
              resolve()
            },
            { once: true },
          )
        })
      },
    })
    await acp.initialize()
    const session = await acp.newSession()

    const prompt = acp.prompt(session.sessionId, "hello")
    await acp.until(() => acp.server.requests.some((request) => request.path.endsWith("/prompt")), "prompt submission")
    await acp.notify("session/cancel", { sessionId: session.sessionId })

    expect(await prompt).toMatchObject({ stopReason: "cancelled" })
    await aborted.promise
    expect(acp.server.requests.map((request) => request.path)).toContain(`/api/session/${session.sessionId}/interrupt`)
  })

  test("session/cancel mid-turn interrupts the session, returns cancelled, and keeps it usable", async () => {
    await using acp = await startWire(held)
    await acp.initialize()
    const session = await acp.newSession()

    const prompt = acp.prompt(session.sessionId, "hold")
    await acp.waitForUpdate((item) => item.update.sessionUpdate === "agent_message_chunk")
    await acp.notify("session/cancel", { sessionId: session.sessionId })

    expect(await prompt).toMatchObject({ stopReason: "cancelled" })
    expect(acp.server.requests.map((request) => request.path)).toContain(`/api/session/${session.sessionId}/interrupt`)
    expect((await acp.prompt(session.sessionId, "again")).stopReason).toBe("end_turn")
  })

  test("$/cancel_request on the prompt request cancels the turn like session/cancel", async () => {
    await using acp = await startWire(held)
    await acp.initialize()
    const session = await acp.newSession()

    const prompt = acp.send("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "hold" }],
    })
    await acp.waitForUpdate((item) => item.update.sessionUpdate === "agent_message_chunk")
    prompt.cancel()

    expect(await prompt.response).toMatchObject({ stopReason: "cancelled" })
    expect(acp.server.requests.map((request) => request.path)).toContain(`/api/session/${session.sessionId}/interrupt`)
    expect((await acp.prompt(session.sessionId, "again")).stopReason).toBe("end_turn")
  })

  test("session/close settles the active turn before responding and detaches only that session", async () => {
    await using acp = await startWire(held)
    await acp.initialize()
    const closing = await acp.newSession()
    const other = await acp.newSession()

    const order: string[] = []
    const prompt = acp.prompt(closing.sessionId, "hold").then((response) => {
      order.push("prompt")
      return response
    })
    await acp.waitForUpdate((item) => item.update.sessionUpdate === "agent_message_chunk")
    const close = await acp.request("session/close", { sessionId: closing.sessionId }).then((response) => {
      order.push("close")
      return response
    })

    expect(close).toEqual({})
    expect(await prompt).toMatchObject({ stopReason: "cancelled" })
    expect(order).toEqual(["prompt", "close"])
    expect(await rpcError(acp.prompt(closing.sessionId, "again"))).toEqual({
      code: -32602,
      message: `Invalid params: session not found: ${closing.sessionId}`,
      data: { sessionId: closing.sessionId },
    })
    expect((await acp.prompt(other.sessionId, "still here")).stopReason).toBe("end_turn")
  })

  test("rejects a second prompt while the session already has an active turn", async () => {
    await using acp = await startWire(held)
    await acp.initialize()
    const session = await acp.newSession()

    const first = acp.prompt(session.sessionId, "hold")
    await acp.until(() => acp.server.requests.some((request) => request.path.endsWith("/prompt")), "first prompt")

    expect(await rpcError(acp.prompt(session.sessionId, "second"))).toEqual({
      code: -32603,
      message: `Internal error: Session already has an active ACP prompt: ${session.sessionId}`,
      data: { service: "session" },
    })
    expect(acp.server.requests.filter((request) => request.path.endsWith("/prompt"))).toHaveLength(1)
    await acp.notify("session/cancel", { sessionId: session.sessionId })
    expect((await first).stopReason).toBe("cancelled")
  })

  test.todo(
    "reports usage summed across every step of the turn (https://github.com/anomalyco/opencode/issues/41660)",
    async () => {
      await using acp = await startWire({
        onPrompt({ sessionID, id, send }) {
          send(delivered(sessionID, id))
          send(
            stepEnded(sessionID, "msg_step_1", { finish: "tool-calls", tokens: { ...tokens(), input: 10, output: 5 } }),
          )
          send(stepEnded(sessionID, "msg_step_2", { tokens: { ...tokens(), input: 20, output: 7 } }))
          send(succeeded(sessionID))
        },
      })
      await acp.initialize()
      const session = await acp.newSession()
      acp.server.messages.set(session.sessionId, [
        assistantMessage("msg_step_2", { tokens: { ...tokens(), input: 20, output: 7 } }),
      ])

      const response = await acp.prompt(session.sessionId, "hello")

      expect(response.usage).toEqual({ inputTokens: 30, outputTokens: 12, totalTokens: 42 })
    },
  )
})
