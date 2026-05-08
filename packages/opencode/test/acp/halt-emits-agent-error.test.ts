import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import { llmErrorPayloadFromSDK } from "../../src/acp/agent-error"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { ApiError, ContextOverflowError, Event, ProviderAuthError } from "@opencode-ai/sdk/v2"
import { WithInstance } from "../../src/project/with-instance"
import { tmpdir } from "../fixture/fixture"

type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]
type RequestPermissionParams = Parameters<AgentSideConnection["requestPermission"]>[0]
type RequestPermissionResult = Awaited<ReturnType<AgentSideConnection["requestPermission"]>>

type GlobalEventEnvelope = {
  directory?: string
  payload?: Event
}

function createEventStream() {
  const queue: GlobalEventEnvelope[] = []
  const waiters: Array<(value: GlobalEventEnvelope | undefined) => void> = []
  const state = { closed: false }

  const push = (event: GlobalEventEnvelope) => {
    const waiter = waiters.shift()
    if (waiter) {
      waiter(event)
      return
    }
    queue.push(event)
  }

  const close = () => {
    state.closed = true
    for (const waiter of waiters.splice(0)) waiter(undefined)
  }

  const stream = async function* (signal?: AbortSignal) {
    while (true) {
      if (signal?.aborted) return
      const next = queue.shift()
      if (next) {
        yield next
        continue
      }
      if (state.closed) return
      const value = await new Promise<GlobalEventEnvelope | undefined>((resolve) => {
        waiters.push(resolve)
        if (!signal) return
        signal.addEventListener("abort", () => resolve(undefined), { once: true })
      })
      if (!value) return
      yield value
    }
  }

  return { controller: { push, close }, stream }
}

function createFakeAgent() {
  const sessionUpdates: SessionUpdateParams[] = []
  const connection = {
    async sessionUpdate(params: SessionUpdateParams) {
      sessionUpdates.push(params)
    },
    async requestPermission(_params: RequestPermissionParams): Promise<RequestPermissionResult> {
      return { outcome: { outcome: "selected", optionId: "once" } } as RequestPermissionResult
    },
  } as unknown as AgentSideConnection

  const { controller, stream } = createEventStream()
  let sessionCount = 0

  const sdk = {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => ({ stream: stream(opts?.signal) }),
    },
    session: {
      create: async () => {
        sessionCount++
        return { data: { id: `ses_${sessionCount}`, time: { created: new Date().toISOString() } } }
      },
      get: async () => ({ data: { id: "ses_1", time: { created: new Date().toISOString() } } }),
      messages: async () => ({ data: [] }),
      message: async () => ({
        data: { info: { role: "assistant" }, parts: [{ id: "part_1", type: "text", text: "" }] },
      }),
    },
    permission: { respond: async () => ({ data: true }) },
    config: {
      providers: async () => ({
        data: {
          providers: [
            {
              id: "opencode",
              name: "opencode",
              models: { "big-pickle": { id: "big-pickle", name: "big-pickle" } },
            },
          ],
        },
      }),
    },
    app: { agents: async () => ({ data: [{ name: "build", description: "build", mode: "agent" }] }) },
    command: { list: async () => ({ data: [] }) },
    mcp: { add: async () => ({ data: true }) },
  } as any

  const agent = new ACP.Agent(connection, {
    sdk,
    defaultModel: { providerID: "opencode", modelID: "big-pickle" },
  } as any)

  const stop = () => {
    controller.close()
    ;(agent as any).eventAbort.abort()
  }

  return { agent, controller, sessionUpdates, stop }
}

describe("llmErrorPayloadFromSDK", () => {
  test("APIError with x-llm-error-type=budget header → typed budget payload", () => {
    const error: ApiError = {
      name: "APIError",
      data: {
        message: "Weekly budget exhausted",
        statusCode: 402,
        isRetryable: false,
        responseHeaders: {
          "x-llm-error-type": "budget",
          "x-llm-error-retryable": "false",
          "x-llm-error-reset-at": "1746748800000",
        },
      },
    }
    const payload = llmErrorPayloadFromSDK(error)
    expect(payload.type).toBe("budget")
    expect(payload.retryable).toBe(false)
    expect(payload.reset_at_epoch_ms).toBe(1746748800000)
    expect(payload.message).toBe("Weekly budget exhausted")
  })

  test("APIError with x-llm-error-type=rate_limit + retry-after → retry_after_seconds", () => {
    const error: ApiError = {
      name: "APIError",
      data: {
        message: "Rate limited",
        statusCode: 429,
        isRetryable: true,
        responseHeaders: {
          "x-llm-error-type": "rate_limit",
          "x-llm-error-retryable": "true",
          "retry-after": "30",
        },
      },
    }
    const payload = llmErrorPayloadFromSDK(error)
    expect(payload.type).toBe("rate_limit")
    expect(payload.retryable).toBe(true)
    expect(payload.retry_after_seconds).toBe(30)
  })

  test("APIError without classification headers, status 503 → provider_unavailable", () => {
    const error: ApiError = {
      name: "APIError",
      data: { message: "service unavailable", statusCode: 503, isRetryable: true },
    }
    const payload = llmErrorPayloadFromSDK(error)
    expect(payload.type).toBe("provider_unavailable")
    expect(payload.retryable).toBe(true)
  })

  test("APIError without classification headers, status 401 → auth", () => {
    const error: ApiError = {
      name: "APIError",
      data: { message: "unauthorized", statusCode: 401, isRetryable: false },
    }
    const payload = llmErrorPayloadFromSDK(error)
    expect(payload.type).toBe("auth")
    expect(payload.retryable).toBe(false)
  })

  test("ContextOverflowError → context_overflow non-retriable", () => {
    const error: ContextOverflowError = {
      name: "ContextOverflowError",
      data: { message: "exceeded context window" },
    }
    const payload = llmErrorPayloadFromSDK(error)
    expect(payload.type).toBe("context_overflow")
    expect(payload.retryable).toBe(false)
  })

  test("ProviderAuthError → auth non-retriable", () => {
    const error: ProviderAuthError = {
      name: "ProviderAuthError",
      data: { providerID: "openai", message: "missing api key" },
    }
    const payload = llmErrorPayloadFromSDK(error)
    expect(payload.type).toBe("auth")
    expect(payload.retryable).toBe(false)
  })

  test("explicit x-llm-error-retryable header overrides type-derived retryable", () => {
    // unknown is normally retryable; header forces non-retriable
    const error: ApiError = {
      name: "APIError",
      data: {
        message: "weird error",
        statusCode: 500,
        isRetryable: true,
        responseHeaders: { "x-llm-error-retryable": "false" },
      },
    }
    const payload = llmErrorPayloadFromSDK(error)
    expect(payload.retryable).toBe(false)
  })
})

describe("acp.agent session.error handling", () => {
  test("emits agent_error session/update for APIError carrying X-Llm-Error-* headers", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            id: "evt_err_1",
            type: "session.error",
            properties: {
              sessionID: sessionId,
              error: {
                name: "APIError",
                data: {
                  message: "Weekly budget exhausted",
                  statusCode: 402,
                  isRetryable: false,
                  responseHeaders: {
                    "x-llm-error-type": "budget",
                    "x-llm-error-retryable": "false",
                    "x-llm-error-reset-at": "1746748800000",
                  },
                },
              },
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))

        const errorUpdates = sessionUpdates.filter(
          (u) => u.sessionId === sessionId && (u.update as any).sessionUpdate === "agent_error",
        )
        expect(errorUpdates.length).toBe(1)
        const update = errorUpdates[0].update as any
        expect(update.error.type).toBe("budget")
        expect(update.error.retryable).toBe(false)
        expect(update.error.reset_at_epoch_ms).toBe(1746748800000)
        expect(update.stopReason).toBe("error")

        stop()
      },
    })
  })

  test("does NOT emit agent_error for ContextOverflowError (compaction handles it)", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            id: "evt_err_2",
            type: "session.error",
            properties: {
              sessionID: sessionId,
              error: {
                name: "ContextOverflowError",
                data: { message: "context window exceeded" },
              },
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))

        const errorUpdates = sessionUpdates.filter(
          (u) => u.sessionId === sessionId && (u.update as any).sessionUpdate === "agent_error",
        )
        expect(errorUpdates.length).toBe(0)

        stop()
      },
    })
  })

  test("ignores session.error for unknown sessions (no emit)", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { controller, sessionUpdates, stop } = createFakeAgent()

        controller.push({
          directory: "/tmp/opencode-acp-test",
          payload: {
            id: "evt_err_3",
            type: "session.error",
            properties: {
              sessionID: "ses_does_not_exist",
              error: {
                name: "APIError",
                data: { message: "boom", statusCode: 500, isRetryable: true },
              },
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))

        expect(sessionUpdates.length).toBe(0)
        stop()
      },
    })
  })
})
