import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import { AgentSideConnection, ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { Event } from "@opencode-ai/sdk/v2"
import type { RequestPermissionResponse } from "@agentclientprotocol/sdk"

type Envelope = {
  payload?: Event
}

function createEventStream() {
  const queue: Envelope[] = []
  const waiters: Array<(value: Envelope | undefined) => void> = []
  const state = { closed: false }

  const push = (event: Envelope) => {
    const waiter = waiters.shift()
    if (waiter) {
      waiter(event)
      return
    }
    queue.push(event)
  }

  const close = () => {
    state.closed = true
    for (const waiter of waiters.splice(0)) {
      waiter(undefined)
    }
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
      const value = await new Promise<Envelope | undefined>((resolve) => {
        waiters.push(resolve)
        if (!signal) return
        signal.addEventListener("abort", () => resolve(undefined), { once: true })
      })
      if (!value) return
      yield value
    }
  }

  return { push, close, stream }
}

async function waitFor(check: () => boolean, timeout = 500, interval = 10) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}

function createHarness() {
  const events = createEventStream()
  const questionReplies: any[] = []
  const questionRejects: any[] = []
  const extMethods: Array<{ method: string; params: Record<string, unknown> }> = []
  let mcpAuthStartCalls = 0
  let agentRef: ACP.Agent | undefined

  const sdk = {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => ({ stream: events.stream(opts?.signal) }),
    },
    session: {
      create: async () => ({
        data: {
          id: "ses_e2e",
          time: { created: new Date().toISOString() },
        },
      }),
      get: async () => ({
        data: {
          id: "ses_e2e",
          time: { created: new Date().toISOString() },
        },
      }),
      messages: async () => ({ data: [] }),
      message: async () => ({
        data: {
          info: { role: "assistant" },
          parts: [],
        },
      }),
      prompt: async () => ({
        data: {
          info: {
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        },
      }),
      abort: async () => ({ data: true }),
    },
    config: {
      providers: async () => ({
        data: {
          providers: [
            {
              id: "opencode",
              name: "opencode",
              models: {
                "big-pickle": { id: "big-pickle", name: "big-pickle" },
              },
            },
          ],
        },
      }),
    },
    app: {
      agents: async () => ({
        data: [
          {
            name: "build",
            description: "build",
            mode: "agent",
          },
        ],
      }),
    },
    command: {
      list: async () => ({ data: [] }),
    },
    mcp: {
      add: async () => ({ data: true }),
      status: async () => ({ data: {} }),
      auth: {
        start: async () => {
          mcpAuthStartCalls++
          return { data: { authorizationUrl: "https://example.com/connect" } }
        },
      },
    },
    question: {
      reply: async (params: any) => {
        questionReplies.push(params)
        return { data: true }
      },
      reject: async (params: any) => {
        questionRejects.push(params)
        return { data: true }
      },
    },
    permission: {
      reply: async () => ({ data: true }),
    },
  } as any

  const client = {
    async requestPermission(): Promise<RequestPermissionResponse> {
      return {
        outcome: {
          outcome: "selected" as const,
          optionId: "once",
        },
      }
    },
    async sessionUpdate() {},
    async extMethod(method: string, params: Record<string, unknown>) {
      extMethods.push({ method, params })
      if (method === "session/elicitation") {
        return { action: "accept", content: { q1: "balanced" } }
      }
      return {}
    },
  }

  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>()
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>()
  const clientConnection = new ClientSideConnection(
    () => client,
    ndJsonStream(clientToAgent.writable, agentToClient.readable),
  )
  new AgentSideConnection(
    (conn) => {
      agentRef = new ACP.Agent(conn, {
        sdk,
        defaultModel: { providerID: "opencode", modelID: "big-pickle" },
      } as any)
      return agentRef
    },
    ndJsonStream(agentToClient.writable, clientToAgent.readable),
  )

  const stop = () => {
    events.close()
    ;(agentRef as any)?.eventAbort?.abort()
  }

  return {
    clientConnection,
    sdk,
    pushEvent: events.push,
    stop,
    extMethods,
    questionReplies,
    questionRejects,
    getMcpAuthStartCalls: () => mcpAuthStartCalls,
    setElicitationSupport: (support: { form: boolean; url: boolean }) => {
      ;(agentRef as any).elicitationSupport = support
    },
  }
}

describe("acp protocol e2e", () => {
  test("returns -32042 with url elicitation payload over json-rpc prompt", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const h = createHarness()
        await h.clientConnection.initialize({
          protocolVersion: 1,
          clientCapabilities: {
            elicitation: {
              url: {},
            },
          },
          clientInfo: {
            name: "e2e-client",
            version: "1.0.0",
          },
        } as any)
        h.setElicitationSupport({ form: false, url: true })

        h.sdk.mcp.status = async () => ({
          data: {
            github: { status: "needs_auth" },
          },
        })

        const sessionId = await h.clientConnection
          .newSession({
            cwd: "/tmp/opencode-acp-test",
            mcpServers: [
              {
                name: "github",
                type: "http",
                url: "https://example.com/mcp",
                headers: [],
              },
            ],
          } as any)
          .then((x) => x.sessionId)

        let first: any
        let second: any
        try {
          await h.clientConnection.prompt({
            sessionId,
            prompt: [{ type: "text", text: "hello" }],
          } as any)
        } catch (error) {
          first = error
        }
        try {
          await h.clientConnection.prompt({
            sessionId,
            prompt: [{ type: "text", text: "hello again" }],
          } as any)
        } catch (error) {
          second = error
        }

        expect(first?.code).toBe(-32042)
        expect(first?.data?.elicitations?.[0]?.mode).toBe("url")
        expect(first?.data?.elicitations?.[0]?.url).toBe("https://example.com/connect")
        expect(second?.code).toBe(-32042)
        expect(second?.data?.elicitations?.[0]?.elicitationId).toBe(first?.data?.elicitations?.[0]?.elicitationId)
        expect(h.getMcpAuthStartCalls()).toBe(1)

        h.stop()
      },
    })
  })

  test("routes elicitation requests to client and maps accepted form replies back to sdk", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const h = createHarness()
        await h.clientConnection.initialize({
          protocolVersion: 1,
          clientCapabilities: {
            elicitation: {
              form: {},
            },
          },
          clientInfo: {
            name: "e2e-client",
            version: "1.0.0",
          },
        } as any)
        h.setElicitationSupport({ form: true, url: false })

        const sessionId = await h.clientConnection
          .newSession({
            cwd: "/tmp/opencode-acp-test",
            mcpServers: [],
          } as any)
          .then((x) => x.sessionId)

        h.pushEvent({
          payload: {
            type: "question.asked",
            properties: {
              id: "que_e2e_1",
              sessionID: sessionId,
              questions: [
                {
                  question: "Choose one strategy",
                  header: "Strategy",
                  options: [
                    { label: "conservative", description: "minimum risk" },
                    { label: "balanced", description: "recommended" },
                  ],
                  custom: false,
                },
              ],
            },
          } as any,
        })

        await waitFor(() => h.extMethods.length > 0)

        expect(h.extMethods.length).toBe(1)
        expect(h.extMethods[0]?.method).toBe("session/elicitation")
        expect(h.extMethods[0]?.params?.mode).toBe("form")
        expect(h.questionReplies.length).toBe(1)
        expect(h.questionReplies[0]?.requestID).toBe("que_e2e_1")
        expect(h.questionReplies[0]?.answers).toEqual([["balanced"]])
        expect(h.questionRejects.length).toBe(0)

        h.stop()
      },
    })
  })
})
