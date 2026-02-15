import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { Event } from "@opencode-ai/sdk/v2"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]
type RequestPermissionParams = Parameters<AgentSideConnection["requestPermission"]>[0]
type RequestPermissionResult = Awaited<ReturnType<AgentSideConnection["requestPermission"]>>

type GlobalEventEnvelope = {
  directory?: string
  payload?: Event
}

type EventController = {
  push: (event: GlobalEventEnvelope) => void
  close: () => void
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
      const value = await new Promise<GlobalEventEnvelope | undefined>((resolve) => {
        waiters.push(resolve)
        if (!signal) return
        signal.addEventListener("abort", () => resolve(undefined), { once: true })
      })
      if (!value) return
      yield value
    }
  }

  return { controller: { push, close } satisfies EventController, stream }
}

function createFakeAgent() {
  const permissionRequests: RequestPermissionParams[] = []
  const questionReplies: { requestID: string; answers: string[][] }[] = []
  const questionRejections: string[] = []

  const connection = {
    async sessionUpdate(_params: SessionUpdateParams) {
      return
    },
    async requestPermission(params: RequestPermissionParams): Promise<RequestPermissionResult> {
      permissionRequests.push(params)
      // Return the first option (skip Cancel which is always last)
      const firstOption = params.options.find((o: any) => o.optionId !== "cancel")
      const optionId = firstOption ? firstOption.optionId : "cancel"
      return { outcome: { outcome: "selected", optionId } } as RequestPermissionResult
    },
  } as unknown as AgentSideConnection

  const { controller, stream } = createEventStream()
  const calls = {
    eventSubscribe: 0,
    sessionCreate: 0,
  }

  const sdk = {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => {
        calls.eventSubscribe++
        return { stream: stream(opts?.signal) }
      },
    },
    session: {
      create: async (_params?: any) => {
        calls.sessionCreate++
        return {
          data: {
            id: `ses_${calls.sessionCreate}`,
            time: { created: new Date().toISOString() },
          },
        }
      },
      get: async (_params?: any) => {
        return {
          data: {
            id: "ses_1",
            time: { created: new Date().toISOString() },
          },
        }
      },
      messages: async () => {
        return { data: [] }
      },
      message: async () => {
        return {
          data: {
            info: {
              role: "assistant",
            },
          },
        }
      },
    },
    permission: {
      respond: async () => {
        return { data: true }
      },
    },
    question: {
      reply: async (params: { requestID: string; answers: string[][] }) => {
        questionReplies.push(params)
        return { data: true }
      },
      reject: async (params: { requestID: string }) => {
        questionRejections.push(params.requestID)
        return { data: true }
      },
    },
    config: {
      providers: async () => {
        return {
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
        }
      },
    },
    app: {
      agents: async () => {
        return {
          data: [
            {
              name: "build",
              description: "build",
              mode: "agent",
            },
          ],
        }
      },
    },
    command: {
      list: async () => {
        return { data: [] }
      },
    },
    mcp: {
      add: async () => {
        return { data: true }
      },
    },
  } as any

  const agent = new ACP.Agent(connection, {
    sdk,
    defaultModel: { providerID: "opencode", modelID: "big-pickle" },
  } as any)

  const stop = () => {
    controller.close()
    ;(agent as any).eventAbort.abort()
  }

  return {
    agent,
    controller,
    calls,
    stop,
    sdk,
    connection,
    permissionRequests,
    questionReplies,
    questionRejections,
  }
}

describe("acp.agent question handling", () => {
  test("question.asked event triggers requestPermission call", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, stop, permissionRequests } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"

        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "question.asked",
            properties: {
              id: "question_1",
              sessionID: sessionId,
              questions: [
                {
                  question: "What would you like to do?",
                  header: "Choose Action",
                  options: [
                    { label: "Option A", description: "Description A" },
                    { label: "Option B", description: "Description B" },
                  ],
                },
              ],
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))

        expect(permissionRequests.length).toBe(1)
        expect(permissionRequests[0].sessionId).toBe(sessionId)
        expect(permissionRequests[0].toolCall.toolCallId).toBe("question_1-0")
        expect(permissionRequests[0].toolCall.title).toBe("Choose Action: What would you like to do?")

        stop()
      },
    })
  })

  test("maps question options to permission options", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, stop, permissionRequests } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"

        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "question.asked",
            properties: {
              id: "question_1",
              sessionID: sessionId,
              questions: [
                {
                  question: "What would you like to do?",
                  header: "Action",
                  options: [
                    { label: "Option A", description: "Description A" },
                    { label: "Option B", description: "Description B" },
                  ],
                },
              ],
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))

        const options = permissionRequests[0].options

        expect(options.length).toBe(3)

        const hasOptionA = options.some((o: any) => o.name === "Option A" && o.description === "Description A")
        const hasOptionB = options.some((o: any) => o.name === "Option B" && o.description === "Description B")
        const hasCancel = options.some(
          (o: any) => o.optionId === "cancel" && o.kind === "reject_once" && o.name === "Cancel",
        )

        expect(hasOptionA).toBe(true)
        expect(hasOptionB).toBe(true)
        expect(hasCancel).toBe(true)

        stop()
      },
    })
  })

  test("user selection resolves the question promise", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, stop, connection, questionReplies } = createFakeAgent()

        connection.requestPermission = async (_params: RequestPermissionParams): Promise<RequestPermissionResult> => {
          return { outcome: { outcome: "selected", optionId: "option-a" } } as RequestPermissionResult
        }

        const cwd = "/tmp/opencode-acp-test"

        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "question.asked",
            properties: {
              id: "question_1",
              sessionID: sessionId,
              questions: [
                {
                  question: "Select an option",
                  header: "Select",
                  options: [{ label: "Option A", description: "First option" }],
                },
              ],
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))

        expect(questionReplies.length).toBe(1)
        expect(questionReplies[0].requestID).toBe("question_1")
        expect(questionReplies[0].answers).toEqual([["Option A"]])

        stop()
      },
    })
  })

  test("user cancellation rejects the question promise", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, stop, connection, questionRejections } = createFakeAgent()

        connection.requestPermission = async (_params: RequestPermissionParams): Promise<RequestPermissionResult> => {
          return { outcome: { outcome: "selected", optionId: "cancel" } } as RequestPermissionResult
        }

        const cwd = "/tmp/opencode-acp-test"

        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "question.asked",
            properties: {
              id: "question_1",
              sessionID: sessionId,
              questions: [
                {
                  question: "Select an option",
                  header: "Select",
                  options: [{ label: "Option A", description: "First option" }],
                },
              ],
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))

        expect(questionRejections.length).toBe(1)
        expect(questionRejections[0]).toBe("question_1")

        stop()
      },
    })
  })

  test("multiple questions triggers sequential requestPermission calls", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, stop, permissionRequests, questionReplies } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"

        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "question.asked",
            properties: {
              id: "question_1",
              sessionID: sessionId,
              questions: [
                {
                  question: "First question?",
                  header: "Q1",
                  options: [{ label: "First Option", description: "First" }],
                },
                {
                  question: "Second question?",
                  header: "Q2",
                  options: [{ label: "Second Option", description: "Second" }],
                },
              ],
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))

        // Should have 2 requestPermission calls (one per question)
        expect(permissionRequests.length).toBe(2)

        // First call for Q1
        expect(permissionRequests[0].toolCall.title).toBe("Q1: First question?")
        const options1 = permissionRequests[0].options
        expect(options1.some((o: any) => o.name === "First Option")).toBe(true)

        // Second call for Q2
        expect(permissionRequests[1].toolCall.title).toBe("Q2: Second question?")
        const options2 = permissionRequests[1].options
        expect(options2.some((o: any) => o.name === "Second Option")).toBe(true)

        // Verify answers collected after both responses
        expect(questionReplies.length).toBe(1)
        expect(questionReplies[0].answers.length).toBe(2)

        stop()
      },
    })
  })

  test("cancellation via dismissed outcome works", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, stop, connection, questionRejections } = createFakeAgent()

        connection.requestPermission = async (_params: RequestPermissionParams): Promise<RequestPermissionResult> => {
          return { outcome: { outcome: "dismissed" } } as unknown as RequestPermissionResult
        }

        const cwd = "/tmp/opencode-acp-test"

        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "question.asked",
            properties: {
              id: "question_1",
              sessionID: sessionId,
              questions: [
                {
                  question: "Select an option",
                  header: "Select",
                  options: [{ label: "Option A", description: "First option" }],
                },
              ],
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))

        expect(questionRejections.length).toBe(1)
        expect(questionRejections[0]).toBe("question_1")

        stop()
      },
    })
  })

  test("text-only questions are rejected in ACP mode", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, stop, questionRejections } = createFakeAgent()

        const cwd = "/tmp/opencode-acp-test"

        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "question.asked",
            properties: {
              id: "text_question_1",
              sessionID: sessionId,
              questions: [
                {
                  question: "Tell me about your biggest technical challenge",
                  header: "Open Question",
                  // No options = text-only question
                  options: [],
                },
              ],
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))

        // Should reject immediately without calling requestPermission
        expect(questionRejections.length).toBe(1)
        expect(questionRejections[0]).toBe("text_question_1")

        stop()
      },
    })
  })

  test("mixed questions with text-only are rejected entirely", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, stop, questionRejections } = createFakeAgent()

        const cwd = "/tmp/opencode-acp-test"

        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "question.asked",
            properties: {
              id: "mixed_question_1",
              sessionID: sessionId,
              questions: [
                {
                  question: "Select a language",
                  header: "Language",
                  options: [{ label: "TypeScript" }, { label: "Python" }],
                },
                {
                  question: "Tell me why you chose this language",
                  header: "Reason",
                  // Text-only question mixed with selectable one
                  options: [],
                },
              ],
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))

        // Should reject entire question set when any text-only question exists
        expect(questionRejections.length).toBe(1)
        expect(questionRejections[0]).toBe("mixed_question_1")

        stop()
      },
    })
  })
})
