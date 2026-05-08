import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpencodeClient, type GlobalEvent } from "@opencode-ai/sdk/v2"
import { createSessionTransport } from "@/cli/cmd/run/stream.transport"
import type { FooterApi, FooterEvent, RunFilePart, StreamCommit } from "@/cli/cmd/run/types"

type EventStream = Awaited<ReturnType<OpencodeClient["event"]["subscribe"]>>["stream"]
type GlobalEventStream = Awaited<ReturnType<OpencodeClient["global"]["event"]>>["stream"]
type SdkEvent = EventStream extends AsyncGenerator<infer T, unknown, unknown> ? T : never
type SessionMessage = NonNullable<Awaited<ReturnType<OpencodeClient["session"]["messages"]>>["data"]>[number]
type SessionChild = NonNullable<Awaited<ReturnType<OpencodeClient["session"]["children"]>>["data"]>[number]
type SessionToolPart = Extract<SessionMessage["parts"][number], { type: "tool" }>
type SessionStatusMap = NonNullable<Awaited<ReturnType<OpencodeClient["session"]["status"]>>["data"]>
type TextPart = Extract<SessionMessage["parts"][number], { type: "text" }>

afterEach(() => {
  mock.restore()
})

function defer<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })

  return { promise, resolve, reject }
}

async function waitFor<T>(check: () => T | undefined, timeout = 1_000): Promise<T> {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = check()
    if (value !== undefined) {
      return value
    }

    await Bun.sleep(10)
  }

  throw new Error("timed out waiting for value")
}

function busy(sessionID = "session-1") {
  return {
    id: `evt-${sessionID}-busy`,
    type: "session.status",
    properties: {
      sessionID,
      status: {
        type: "busy",
      },
    },
  } satisfies SdkEvent
}

function idle(sessionID = "session-1") {
  return {
    id: `evt-${sessionID}-idle`,
    type: "session.status",
    properties: {
      sessionID,
      status: {
        type: "idle",
      },
    },
  } satisfies SdkEvent
}

function assistant(id: string) {
  return {
    id: `evt-${id}`,
    type: "message.updated",
    properties: {
      sessionID: "session-1",
      info: assistantMessage({
        sessionID: "session-1",
        id,
        parts: [],
      }).info,
    },
  } satisfies SdkEvent
}

function feed<T>() {
  const list: T[] = []
  let done = false
  let wake: (() => void) | undefined

  const wrapped = (async function* () {
    while (!done || list.length > 0) {
      if (list.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        continue
      }

      const next = list.shift()
      if (!next) {
        continue
      }

      yield next
    }
  })()

  return {
    stream: wrapped,
    push(value: T) {
      list.push(value)
      wake?.()
      wake = undefined
    },
    close() {
      done = true
      wake?.()
      wake = undefined
    },
  }
}

function eventFeed() {
  return feed<SdkEvent>()
}

function globalFeed() {
  return feed<GlobalEvent>()
}

function emptyStream(): EventStream {
  return (async function* (): AsyncGenerator<SdkEvent> {})()
}

function ok<T>(data: T) {
  return Promise.resolve({
    data,
    error: undefined,
    request: new Request("https://opencode.test"),
    response: new Response(),
  })
}

function sse(stream: EventStream) {
  return Promise.resolve({ stream })
}

function globalSse(stream: GlobalEventStream) {
  return Promise.resolve({ stream })
}

function wrapGlobalStream(stream: EventStream): GlobalEventStream {
  return (async function* () {
    for await (const event of stream) {
      yield globalEvent(event)
    }
  })()
}

function statusMap(busy: boolean): SessionStatusMap {
  if (busy) {
    return { "session-1": { type: "busy" } }
  }

  return {}
}

function assistantMessage(input: { sessionID: string; id: string; parts: SessionMessage["parts"] }): SessionMessage {
  return {
    info: {
      id: input.id,
      sessionID: input.sessionID,
      role: "assistant",
      time: {
        created: 1,
      },
      parentID: "msg-user-1",
      modelID: "gpt-5",
      providerID: "openai",
      mode: "chat",
      agent: "build",
      path: {
        cwd: "/tmp",
        root: "/tmp",
      },
      cost: 0,
      tokens: {
        input: 1,
        output: 1,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    },
    parts: input.parts,
  }
}

function runningTool(input: {
  sessionID: string
  messageID: string
  id: string
  callID: string
  tool: string
  body: Record<string, unknown>
  metadata?: Record<string, unknown>
}): SessionToolPart {
  return {
    id: input.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "tool",
    callID: input.callID,
    tool: input.tool,
    state: {
      status: "running",
      input: input.body,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      time: {
        start: 1,
      },
    },
  }
}

function completedTool(input: {
  sessionID: string
  messageID: string
  id: string
  callID: string
  tool: string
  body: Record<string, unknown>
  output?: string
  metadata?: Record<string, unknown>
}): SessionToolPart {
  return {
    id: input.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "tool",
    callID: input.callID,
    tool: input.tool,
    state: {
      status: "completed",
      input: input.body,
      output: input.output ?? "",
      title: input.tool,
      metadata: input.metadata ?? {},
      time: {
        start: 1,
        end: 2,
      },
    },
  }
}

function textPart(id: string, messageID: string, text: string, sessionID = "session-1"): TextPart {
  return {
    id,
    sessionID,
    messageID,
    type: "text",
    text,
  }
}

function textUpdated(part: TextPart): SdkEvent {
  return {
    id: `evt-${part.id}-updated`,
    type: "message.part.updated",
    properties: {
      sessionID: part.sessionID,
      part,
      time: 1,
    },
  }
}

function toolUpdated(part: SessionToolPart): SdkEvent {
  return {
    id: `evt-${part.id}-updated`,
    type: "message.part.updated",
    properties: {
      sessionID: part.sessionID,
      part,
      time: 1,
    },
  }
}

function textDelta(messageID: string, partID: string, delta: string): SdkEvent {
  return {
    id: `evt-${partID}-delta`,
    type: "message.part.delta",
    properties: {
      sessionID: "session-1",
      messageID,
      partID,
      field: "text",
      delta,
    },
  }
}

function child(id: string): SessionChild {
  return {
    id,
    slug: id,
    projectID: "project-1",
    directory: "/tmp",
    title: id,
    version: "1",
    time: {
      created: 1,
      updated: 1,
    },
  }
}

function globalEvent(payload: GlobalEvent["payload"]): GlobalEvent {
  return {
    directory: "/tmp",
    project: "project-1",
    payload,
  }
}

function footer(fn?: (commit: StreamCommit) => void) {
  const commits: StreamCommit[] = []
  const events: FooterEvent[] = []
  let closed = false

  const api: FooterApi = {
    get isClosed() {
      return closed
    },
    onPrompt: () => () => {},
    onClose: () => () => {},
    event(next) {
      events.push(next)
    },
    append(next) {
      commits.push(next)
      fn?.(next)
    },
    idle() {
      return Promise.resolve()
    },
    close() {
      closed = true
    },
    destroy() {
      closed = true
    },
  }

  return { api, commits, events }
}

function sdk(
  input: {
    stream?: EventStream
    globalStream?: GlobalEventStream
    subscribe?: OpencodeClient["event"]["subscribe"]
    globalEvent?: OpencodeClient["global"]["event"]
    promptAsync?: OpencodeClient["session"]["promptAsync"]
    status?: OpencodeClient["session"]["status"]
    messages?: OpencodeClient["session"]["messages"]
    children?: OpencodeClient["session"]["children"]
    permissions?: OpencodeClient["permission"]["list"]
    questions?: OpencodeClient["question"]["list"]
  } = {},
) {
  const client = new OpencodeClient()

  const subscribe: OpencodeClient["event"]["subscribe"] = input.subscribe ?? (() => sse(input.stream ?? emptyStream()))
  const globalEvent: OpencodeClient["global"]["event"] =
    input.globalEvent ?? (() => globalSse(input.globalStream ?? wrapGlobalStream(input.stream ?? emptyStream())))
  const promptAsync: OpencodeClient["session"]["promptAsync"] = input.promptAsync ?? (() => ok(undefined))
  const status: OpencodeClient["session"]["status"] = input.status ?? (() => ok({}))
  const messages: OpencodeClient["session"]["messages"] = input.messages ?? (() => ok([]))
  const children: OpencodeClient["session"]["children"] = input.children ?? (() => ok([]))
  const permissions: OpencodeClient["permission"]["list"] = input.permissions ?? (() => ok([]))
  const questions: OpencodeClient["question"]["list"] = input.questions ?? (() => ok([]))

  spyOn(client.event, "subscribe").mockImplementation(subscribe)
  spyOn(client.global, "event").mockImplementation(globalEvent)
  spyOn(client.session, "promptAsync").mockImplementation(promptAsync)
  spyOn(client.session, "status").mockImplementation(status)
  spyOn(client.session, "messages").mockImplementation(messages)
  spyOn(client.session, "children").mockImplementation(children)
  spyOn(client.permission, "list").mockImplementation(permissions)
  spyOn(client.question, "list").mockImplementation(questions)

  return client
}

describe("run stream transport", () => {
  test("bootstraps child tabs and resumed blocker input", async () => {
    const src = eventFeed()
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: sdk({
        stream: src.stream,
        messages: async ({ sessionID }) => {
          if (sessionID === "session-1") {
            return ok([
              assistantMessage({
                sessionID: "session-1",
                id: "msg-1",
                parts: [
                  runningTool({
                    sessionID: "session-1",
                    messageID: "msg-1",
                    id: "task-1",
                    callID: "call-1",
                    tool: "task",
                    body: {
                      description: "Explore run folder",
                      subagent_type: "explore",
                    },
                    metadata: {
                      sessionId: "child-1",
                    },
                  }),
                ],
              }),
            ])
          }

          return ok([
            assistantMessage({
              sessionID: "child-1",
              id: "msg-child-1",
              parts: [
                runningTool({
                  sessionID: "child-1",
                  messageID: "msg-child-1",
                  id: "edit-1",
                  callID: "call-edit-1",
                  tool: "edit",
                  body: {
                    filePath: "src/run/subagent-data.ts",
                    diff: "@@ -1 +1 @@",
                  },
                }),
              ],
            }),
          ])
        },
        children: async () => ok([child("child-1")]),
        permissions: async () =>
          ok([
            {
              id: "perm-1",
              sessionID: "child-1",
              permission: "edit",
              patterns: ["src/run/subagent-data.ts"],
              metadata: {},
              always: [],
              tool: {
                messageID: "msg-child-1",
                callID: "call-edit-1",
              },
            },
          ]),
      }),
      sessionID: "session-1",
      thinking: true,
      limits: () => ({}),
      footer: ui.api,
    })

    try {
      const boot = await waitFor(() => {
        const item = ui.events.findLast((event) => event.type === "stream.subagent")
        const state = item?.type === "stream.subagent" ? item.state : undefined
        return state?.tabs.some((tab) => tab.sessionID === "child-1") &&
          state.permissions.some((req) => req.id === "perm-1")
          ? state
          : undefined
      })

      expect(boot.tabs).toEqual([
        expect.objectContaining({
          sessionID: "child-1",
          label: "Explore",
          description: "Explore run folder",
          status: "running",
        }),
      ])
      expect(boot.permissions).toEqual([
        expect.objectContaining({
          id: "perm-1",
          sessionID: "child-1",
          metadata: {
            input: {
              filePath: "src/run/subagent-data.ts",
              diff: "@@ -1 +1 @@",
            },
          },
        }),
      ])

      transport.selectSubagent("child-1")

      const selected = await waitFor(() => {
        const item = ui.events.findLast((event) => event.type === "stream.subagent")
        const state = item?.type === "stream.subagent" ? item.state : undefined
        const detail = state?.details["child-1"]
        return detail?.commits.some(
          (commit) => commit.kind === "tool" && commit.tool === "edit" && commit.phase === "start",
        )
          ? state
          : undefined
      })

      expect(selected.details).toEqual({
        "child-1": {
          sessionID: "child-1",
          commits: [
            expect.objectContaining({
              kind: "tool",
              tool: "edit",
              phase: "start",
            }),
          ],
        },
      })

      expect(
        await waitFor(() => {
          const item = ui.events.findLast((event) => event.type === "stream.view")
          return item?.type === "stream.view" && item.view.type === "permission" && item.view.request.id === "perm-1"
            ? item
            : undefined
        }),
      ).toEqual({
        type: "stream.view",
        view: {
          type: "permission",
          request: expect.objectContaining({
            id: "perm-1",
            metadata: {
              input: {
                filePath: "src/run/subagent-data.ts",
                diff: "@@ -1 +1 @@",
              },
            },
          }),
        },
      })
    } finally {
      src.close()
      await transport.close()
    }
  })

  test("bootstraps child session output before selection", async () => {
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: sdk({
        messages: async ({ sessionID }) => {
          if (sessionID === "session-1") {
            return ok([
              assistantMessage({
                sessionID: "session-1",
                id: "msg-1",
                parts: [
                  completedTool({
                    sessionID: "session-1",
                    messageID: "msg-1",
                    id: "task-1",
                    callID: "call-1",
                    tool: "task",
                    body: {
                      description: "Explore run.ts",
                      subagent_type: "explore",
                    },
                    metadata: {
                      sessionId: "child-1",
                    },
                  }),
                ],
              }),
            ])
          }

          return sessionID === "child-1"
            ? ok([
                assistantMessage({
                  sessionID: "child-1",
                  id: "msg-child-1",
                  parts: [textPart("txt-child-1", "msg-child-1", "subagent summary", "child-1")],
                }),
              ])
            : ok([])
        },
        children: async () => ok([child("child-1")]),
      }),
      sessionID: "session-1",
      thinking: true,
      limits: () => ({}),
      footer: ui.api,
    })

    try {
      await waitFor(() => {
        const item = ui.events.findLast((event) => event.type === "stream.subagent")
        return item?.type === "stream.subagent" && item.state.tabs.some((tab) => tab.sessionID === "child-1")
          ? item
          : undefined
      })

      transport.selectSubagent("child-1")

      expect(
        await waitFor(() => {
          const item = ui.events.findLast((event) => event.type === "stream.subagent")
          const detail = item?.type === "stream.subagent" ? item.state.details["child-1"] : undefined
          return detail?.commits.some((commit) => commit.kind === "assistant" && commit.text === "subagent summary")
            ? detail
            : undefined
        }),
      ).toEqual({
        sessionID: "child-1",
        commits: [
          expect.objectContaining({
            kind: "assistant",
            text: "subagent summary",
          }),
        ],
      })
    } finally {
      await transport.close()
    }
  })

  test("does not block startup on child history bootstrap", async () => {
    const pending = defer<Awaited<ReturnType<typeof ok<SessionMessage[]>>>>()
    const ui = footer()
    let transport: Awaited<ReturnType<typeof createSessionTransport>> | undefined

    const task = createSessionTransport({
      sdk: sdk({
        messages: async ({ sessionID }) => {
          if (sessionID === "session-1") {
            return ok([
              assistantMessage({
                sessionID: "session-1",
                id: "msg-1",
                parts: [
                  runningTool({
                    sessionID: "session-1",
                    messageID: "msg-1",
                    id: "task-1",
                    callID: "call-1",
                    tool: "task",
                    body: {
                      description: "Explore run.ts",
                      subagent_type: "explore",
                    },
                    metadata: {
                      sessionId: "child-1",
                    },
                  }),
                ],
              }),
            ])
          }

          if (sessionID === "child-1") {
            return pending.promise
          }

          return ok([])
        },
        children: async () => ok([child("child-1")]),
      }),
      sessionID: "session-1",
      thinking: true,
      limits: () => ({}),
      footer: ui.api,
    }).then((item) => {
      transport = item
      return item
    })

    try {
      const state = await waitFor(() => {
        const item = ui.events.findLast((event) => event.type === "stream.subagent")
        return item?.type === "stream.subagent" && item.state.tabs.some((tab) => tab.sessionID === "child-1")
          ? item.state
          : undefined
      })

      await waitFor(() => transport)

      expect(state).toEqual({
        tabs: [expect.objectContaining({ sessionID: "child-1", status: "running" })],
        details: {},
        permissions: [],
        questions: [],
      })
    } finally {
      pending.resolve(ok([]))
      await task
      await transport?.close()
    }
  })

  test("streams selected subagent output from global events while it is running", async () => {
    const global = globalFeed()
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: sdk({
        globalStream: global.stream,
      }),
      sessionID: "session-1",
      thinking: true,
      limits: () => ({}),
      footer: ui.api,
    })

    try {
      global.push(globalEvent(assistant("msg-1")))
      global.push(
        globalEvent(
          toolUpdated(
            runningTool({
              sessionID: "session-1",
              messageID: "msg-1",
              id: "task-1",
              callID: "call-1",
              tool: "task",
              body: {
                description: "Explore run.ts",
                subagent_type: "explore",
              },
              metadata: {
                sessionId: "child-1",
              },
            }),
          ),
        ),
      )

      await waitFor(() => {
        const item = ui.events.findLast((event) => event.type === "stream.subagent")
        return item?.type === "stream.subagent" && item.state.tabs.some((tab) => tab.sessionID === "child-1")
          ? item
          : undefined
      })

      transport.selectSubagent("child-1")

      global.push(
        globalEvent({
          id: "evt-child-message",
          type: "message.updated",
          properties: {
            sessionID: "child-1",
            info: assistantMessage({
              sessionID: "child-1",
              id: "msg-child-1",
              parts: [],
            }).info,
          },
        }),
      )
      global.push(globalEvent(textUpdated(textPart("txt-child-1", "msg-child-1", "hello", "child-1"))))

      expect(
        await waitFor(() => {
          const item = ui.events.findLast((event) => event.type === "stream.subagent")
          const detail = item?.type === "stream.subagent" ? item.state.details["child-1"] : undefined
          return detail?.commits.some((commit) => commit.kind === "assistant" && commit.text === "hello")
            ? detail
            : undefined
        }),
      ).toEqual({
        sessionID: "child-1",
        commits: [
          expect.objectContaining({
            kind: "assistant",
            text: "hello",
          }),
        ],
      })

      global.push(globalEvent(textUpdated(textPart("txt-child-1", "msg-child-1", "hello world", "child-1"))))

      expect(
        await waitFor(() => {
          const item = ui.events.findLast((event) => event.type === "stream.subagent")
          const detail = item?.type === "stream.subagent" ? item.state.details["child-1"] : undefined
          return detail?.commits.some((commit) => commit.kind === "assistant" && commit.text === "hello world")
            ? detail
            : undefined
        }, 2_000),
      ).toEqual({
        sessionID: "child-1",
        commits: [
          expect.objectContaining({
            kind: "assistant",
            text: "hello world",
          }),
        ],
      })
    } finally {
      global.close()
      await transport.close()
    }
  })

  test("recovers pending questions from question.list when question.asked is missed", async () => {
    const src = eventFeed()
    const ui = footer()
    let questionCalls = 0
    const request = {
      id: "question-1",
      sessionID: "session-1",
      questions: [
        {
          question: "Which area should I inspect first?",
          header: "Area",
          options: [{ label: "CLI", description: "Look at the direct run flow." }],
          multiple: false,
        },
      ],
      tool: {
        messageID: "msg-1",
        callID: "call-question-1",
      },
    }
    const transport = await createSessionTransport({
      sdk: sdk({
        stream: src.stream,
        questions: async () => {
          questionCalls += 1
          return ok(questionCalls > 1 ? [request] : [])
        },
        promptAsync: async () => {
          queueMicrotask(() => {
            src.push(busy())
            src.push(assistant("msg-1"))
            src.push(
              toolUpdated(
                runningTool({
                  sessionID: "session-1",
                  messageID: "msg-1",
                  id: "question-tool-1",
                  callID: "call-question-1",
                  tool: "question",
                  body: {
                    questions: request.questions,
                  },
                }),
              ),
            )
          })
          return ok(undefined)
        },
      }),
      sessionID: "session-1",
      thinking: true,
      limits: () => ({}),
      footer: ui.api,
    })

    const ctrl = new AbortController()

    try {
      const run = transport.runPromptTurn({
        agent: undefined,
        model: undefined,
        variant: undefined,
        prompt: { text: "hello", parts: [] },
        files: [],
        includeFiles: false,
        signal: ctrl.signal,
      })

      const view = await waitFor(() => {
        const item = ui.events.findLast((event) => event.type === "stream.view")
        return item?.type === "stream.view" && item.view.type === "question" ? item.view : undefined
      })

      expect(view).toEqual({
        type: "question",
        request,
      })

      expect(ui.events).toContainEqual({
        type: "stream.patch",
        patch: {
          phase: "running",
          status: "awaiting answer",
        },
      })

      src.push(
        toolUpdated(
          completedTool({
            sessionID: "session-1",
            messageID: "msg-1",
            id: "question-tool-1",
            callID: "call-question-1",
            tool: "question",
            body: {
              questions: request.questions,
            },
            output: "User has answered your questions.",
            metadata: {
              answers: [["CLI"]],
            },
          }),
        ),
      )

      expect(
        await waitFor(() => {
          const item = ui.events.findLast((event) => event.type === "stream.view")
          return item?.type === "stream.view" && item.view.type === "prompt" ? item : undefined
        }),
      ).toEqual({
        type: "stream.view",
        view: { type: "prompt" },
      })

      ctrl.abort()
      await run
    } finally {
      src.close()
      await transport.close()
    }
  })

  test("does not resurrect questions if question.list resolves after tool completion", async () => {
    const src = eventFeed()
    const ui = footer()
    const started = defer()
    const request = {
      id: "question-race-1",
      sessionID: "session-1",
      questions: [
        {
          question: "Which area should I inspect first?",
          header: "Area",
          options: [{ label: "CLI", description: "Look at the direct run flow." }],
          multiple: false,
        },
      ],
      tool: {
        messageID: "msg-1",
        callID: "call-question-race-1",
      },
    }
    const pending = defer<Awaited<ReturnType<typeof ok<(typeof request)[]>>>>()
    let questionCalls = 0
    const transport = await createSessionTransport({
      sdk: sdk({
        stream: src.stream,
        questions: async () => {
          questionCalls += 1
          if (questionCalls === 1) {
            return ok([])
          }

          if (questionCalls === 2) {
            started.resolve()
            return pending.promise
          }

          return ok([])
        },
        promptAsync: async () => {
          queueMicrotask(() => {
            src.push(busy())
            src.push(assistant("msg-1"))
            src.push(
              toolUpdated(
                runningTool({
                  sessionID: "session-1",
                  messageID: "msg-1",
                  id: "question-race-tool-1",
                  callID: "call-question-race-1",
                  tool: "question",
                  body: {
                    questions: request.questions,
                  },
                }),
              ),
            )
          })
          return ok(undefined)
        },
      }),
      sessionID: "session-1",
      thinking: true,
      limits: () => ({}),
      footer: ui.api,
    })

    const ctrl = new AbortController()

    try {
      const run = transport.runPromptTurn({
        agent: undefined,
        model: undefined,
        variant: undefined,
        prompt: { text: "hello", parts: [] },
        files: [],
        includeFiles: false,
        signal: ctrl.signal,
      })

      await started.promise
      src.push(
        toolUpdated(
          completedTool({
            sessionID: "session-1",
            messageID: "msg-1",
            id: "question-race-tool-1",
            callID: "call-question-race-1",
            tool: "question",
            body: {
              questions: request.questions,
            },
            output: "User has answered your questions.",
            metadata: {
              answers: [["CLI"]],
            },
          }),
        ),
      )
      await waitFor(() => {
        const commit = ui.commits.findLast(
          (item) => item.kind === "tool" && item.partID === "question-race-tool-1" && item.toolState === "completed",
        )
        return commit ? true : undefined
      })
      pending.resolve(ok([request]))

      await Bun.sleep(50)

      expect(
        ui.events.some(
          (event) =>
            event.type === "stream.view" && event.view.type === "question" && event.view.request.id === request.id,
        ),
      ).toBe(false)

      ctrl.abort()
      await run
    } finally {
      src.close()
      await transport.close()
    }
  })

  test("respects the includeFiles flag when building prompt payloads", async () => {
    const src = eventFeed()
    const ui = footer()
    const seen: unknown[] = []
    const file: RunFilePart = {
      type: "file",
      url: "file:///tmp/a.ts",
      filename: "a.ts",
      mime: "text/plain",
    }

    const transport = await createSessionTransport({
      sdk: sdk({
        stream: src.stream,
        promptAsync: async (input) => {
          seen.push(input)
          queueMicrotask(() => {
            src.push(busy())
            src.push(idle())
          })
          return ok(undefined)
        },
      }),
      sessionID: "session-1",
      thinking: true,
      limits: () => ({}),
      footer: ui.api,
    })

    try {
      await transport.runPromptTurn({
        agent: undefined,
        model: undefined,
        variant: undefined,
        prompt: { text: "hello", parts: [] },
        files: [file],
        includeFiles: true,
      })

      await transport.runPromptTurn({
        agent: undefined,
        model: undefined,
        variant: undefined,
        prompt: { text: "again", parts: [] },
        files: [file],
        includeFiles: false,
      })

      expect(seen).toEqual([
        expect.objectContaining({
          parts: [file, { type: "text", text: "hello" }],
        }),
        expect.objectContaining({
          parts: [{ type: "text", text: "again" }],
        }),
      ])
    } finally {
      src.close()
      await transport.close()
    }
  })

  test("falls back to session status polling when idle events are missing", async () => {
    const src = eventFeed()
    const ui = footer()
    let busy = true
    const transport = await createSessionTransport({
      sdk: sdk({
        stream: src.stream,
        promptAsync: async () => {
          queueMicrotask(() => {
            src.push(assistant("msg-1"))
            busy = false
          })
          return ok(undefined)
        },
        status: async () => ok(statusMap(busy)),
      }),
      sessionID: "session-1",
      thinking: true,
      limits: () => ({}),
      footer: ui.api,
    })

    try {
      await Promise.race([
        transport.runPromptTurn({
          agent: undefined,
          model: undefined,
          variant: undefined,
          prompt: { text: "hello", parts: [] },
          files: [],
          includeFiles: false,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("turn timed out")), 1_000)),
      ])
    } finally {
      src.close()
      await transport.close()
    }
  })

  test("flushes interrupted output when the active turn aborts", async () => {
    const src = eventFeed()
    const seen = defer()
    const ui = footer((commit) => {
      if (commit.kind === "assistant" && commit.phase === "progress") {
        seen.resolve()
      }
    })
    const transport = await createSessionTransport({
      sdk: sdk({
        stream: src.stream,
        promptAsync: async () => {
          queueMicrotask(() => {
            src.push(busy())
            src.push(assistant("msg-1"))
            src.push(textUpdated(textPart("txt-1", "msg-1", "")))
            src.push(textDelta("msg-1", "txt-1", "unfinished"))
          })
          return ok(undefined)
        },
      }),
      sessionID: "session-1",
      thinking: true,
      limits: () => ({}),
      footer: ui.api,
    })

    const ctrl = new AbortController()

    try {
      const task = transport.runPromptTurn({
        agent: undefined,
        model: undefined,
        variant: undefined,
        prompt: { text: "hello", parts: [] },
        files: [],
        includeFiles: false,
        signal: ctrl.signal,
      })

      await seen.promise
      ctrl.abort()
      await task

      expect(ui.commits).toEqual([
        {
          kind: "assistant",
          text: "unfinished",
          phase: "progress",
          source: "assistant",
          messageID: "msg-1",
          partID: "txt-1",
        },
        {
          kind: "assistant",
          text: "",
          phase: "final",
          source: "assistant",
          messageID: "msg-1",
          partID: "txt-1",
          interrupted: true,
        },
      ])
    } finally {
      src.close()
      await transport.close()
    }
  })

  test("closes an active turn without rejecting it", async () => {
    const src = eventFeed()
    const ui = footer()
    const ready = defer()
    let aborted = false

    const transport = await createSessionTransport({
      sdk: sdk({
        stream: src.stream,
        promptAsync: async (_input, opt) => {
          ready.resolve()
          await new Promise<void>((resolve) => {
            const onAbort = () => {
              aborted = true
              opt?.signal?.removeEventListener("abort", onAbort)
              resolve()
            }

            opt?.signal?.addEventListener("abort", onAbort, { once: true })
          })
          return ok(undefined)
        },
      }),
      sessionID: "session-1",
      thinking: true,
      limits: () => ({}),
      footer: ui.api,
    })

    try {
      const task = transport.runPromptTurn({
        agent: undefined,
        model: undefined,
        variant: undefined,
        prompt: { text: "hello", parts: [] },
        files: [],
        includeFiles: false,
      })

      await ready.promise
      await transport.close()
      await task

      expect(aborted).toBe(true)
    } finally {
      src.close()
      await transport.close()
    }
  })

  test("rejects the active turn when the event stream faults", async () => {
    const ui = footer()
    const ready = defer()

    const transport = await createSessionTransport({
      sdk: sdk({
        globalEvent: () =>
          globalSse(
            (async function* (): AsyncGenerator<GlobalEvent> {
              await ready.promise
              yield globalEvent(busy())
              throw new Error("boom")
            })(),
          ),
        promptAsync: async () => {
          ready.resolve()
          return ok(undefined)
        },
        status: async () => ok({ "session-1": { type: "busy" } }),
      }),
      sessionID: "session-1",
      thinking: true,
      limits: () => ({}),
      footer: ui.api,
    })

    try {
      await expect(
        transport.runPromptTurn({
          agent: undefined,
          model: undefined,
          variant: undefined,
          prompt: { text: "hello", parts: [] },
          files: [],
          includeFiles: false,
        }),
      ).rejects.toThrow("boom")
    } finally {
      await transport.close()
    }
  })

  test("rejects the active turn when the backing instance is disposed", async () => {
    const ui = footer()
    const ready = defer()

    const transport = await createSessionTransport({
      sdk: sdk({
        globalEvent: () =>
          globalSse(
            (async function* (): AsyncGenerator<GlobalEvent> {
              await ready.promise
              yield globalEvent({
                id: "evt-disposed",
                type: "server.instance.disposed",
                properties: {
                  directory: "/tmp",
                },
              })
            })(),
          ),
        promptAsync: async () => {
          ready.resolve()
          return ok(undefined)
        },
        status: async () => ok({}),
      }),
      directory: "/tmp",
      sessionID: "session-1",
      thinking: true,
      limits: () => ({}),
      footer: ui.api,
    })

    try {
      await expect(
        transport.runPromptTurn({
          agent: undefined,
          model: undefined,
          variant: undefined,
          prompt: { text: "hello", parts: [] },
          files: [],
          includeFiles: false,
        }),
      ).rejects.toThrow("instance disposed")
    } finally {
      await transport.close()
    }
  })

  test("rejects concurrent turns", async () => {
    const src = eventFeed()
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: sdk({
        stream: src.stream,
      }),
      sessionID: "session-1",
      thinking: true,
      limits: () => ({}),
      footer: ui.api,
    })

    const ctrl = new AbortController()

    try {
      const task = transport.runPromptTurn({
        agent: undefined,
        model: undefined,
        variant: undefined,
        prompt: { text: "one", parts: [] },
        files: [],
        includeFiles: false,
        signal: ctrl.signal,
      })

      await expect(
        transport.runPromptTurn({
          agent: undefined,
          model: undefined,
          variant: undefined,
          prompt: { text: "two", parts: [] },
          files: [],
          includeFiles: false,
        }),
      ).rejects.toThrow("prompt already running")

      ctrl.abort()
      await task
    } finally {
      src.close()
      await transport.close()
    }
  })
})
