import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpencodeClient, type V2Event } from "@opencode-ai/sdk/v2"
import { createSessionTransport } from "@/cli/cmd/run/stream-v2.transport"
import type { FooterApi, FooterEvent, StreamCommit } from "@/cli/cmd/run/types"

type ExecutionSettledEvent = {
  id: string
  type: "session.next.execution.settled"
  data: {
    timestamp: number | string
    sessionID: string
    outcome: "success" | "failure" | "interrupted"
    error?: { message?: string; _tag?: string; type?: string } & Record<string, unknown>
  }
}

type RunV2Event = V2Event | ExecutionSettledEvent

function feed() {
  const values: RunV2Event[] = []
  let closed = false
  let wake: (() => void) | undefined
  const stream = (async function* (): AsyncGenerator<RunV2Event, void, unknown> {
    while (!closed || values.length > 0) {
      if (values.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        continue
      }
      const value = values.shift()
      if (value) yield value
    }
  })()
  return {
    stream,
    push(value: RunV2Event) {
      values.push(value)
      wake?.()
      wake = undefined
    },
    close() {
      closed = true
      wake?.()
      wake = undefined
    },
  }
}

function ok<T>(data: T) {
  return Promise.resolve({
    data,
    error: undefined,
    request: new Request("https://opencode.test"),
    response: new Response(),
  })
}

function connected(id = "evt_connected") {
  return { id, type: "server.connected", data: {} } satisfies RunV2Event
}

function footer() {
  const commits: StreamCommit[] = []
  const events: FooterEvent[] = []
  let closed = false
  const api: FooterApi = {
    get isClosed() {
      return closed
    },
    onPrompt: () => () => {},
    onQueuedRemove: () => () => {},
    onClose: () => () => {},
    event(value) {
      events.push(value)
    },
    append(value) {
      commits.push(value)
    },
    idle: () => Promise.resolve(),
    close() {
      closed = true
    },
    destroy() {
      closed = true
    },
  }
  return { api, commits, events }
}

function sdk(input: { streams: ReturnType<typeof feed>[]; active?: () => Record<string, { type: "running" }> }) {
  const client = new OpencodeClient()
  let subscription = 0
  spyOn(client.v2.event, "subscribe").mockImplementation(
    () => Promise.resolve({ stream: input.streams[subscription++]?.stream ?? feed().stream }) as ReturnType<typeof client.v2.event.subscribe>,
  )
  spyOn(client.v2.session, "messages").mockImplementation(() =>
    ok({
      data: [
        {
          id: "msg_old",
          type: "user",
          text: "previous prompt",
          files: [],
          agents: [],
          time: { created: 1 },
        },
      ],
      cursor: {},
    }),
  )
  spyOn(client.v2.session.permission, "list").mockImplementation(() => ok({ data: [] }))
  spyOn(client.v2.session.question, "list").mockImplementation(() => ok({ data: [] }))
  spyOn(client.v2.session, "active").mockImplementation(() => ok({ data: input.active?.() ?? {} }))
  spyOn(client.v2.session, "switchAgent").mockImplementation(() => ok(undefined))
  spyOn(client.v2.session, "switchModel").mockImplementation(() => ok(undefined))
  return client
}

afterEach(() => {
  mock.restore()
})

describe("V2 mini transport", () => {
  test("hydrates projection, reduces live output, and completes on settlement", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({ streams: [events] })
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: client,
      sessionID: "ses_1",
      thinking: true,
      replay: true,
      limits: () => ({}),
      footer: ui.api,
    })
    expect(ui.commits.map((item) => item.text)).toEqual(["previous prompt"])

    let admitted = false
    // The generated method has conditional return types for throwOnError; this mock represents the successful branch.
    // @ts-expect-error successful SDK response is valid for both modes at runtime
    spyOn(client.v2.session, "prompt").mockImplementation((request) => {
      const messageID = request.id ?? "msg_prompt"
      const prompt = request.prompt ?? { text: "" }
      admitted = true
      return ok({
        data: {
          admittedSeq: 1,
          id: messageID,
          sessionID: "ses_1",
          prompt,
          delivery: "steer" as const,
          timeCreated: 2,
        },
      })
    })

    const turn = transport.runPromptTurn({
      agent: undefined,
      model: undefined,
      variant: undefined,
      prompt: { messageID: "msg_prompt", text: "hello", parts: [] },
      files: [],
      includeFiles: true,
    })
    while (!admitted) await Bun.sleep(0)
    events.push({
        id: "evt_prompted",
        type: "session.next.prompted",
        data: {
          timestamp: 2,
          sessionID: "ses_1",
          messageID: "msg_prompt",
          prompt: { text: "hello" },
          delivery: "steer",
        },
      })
      events.push({
        id: "evt_text",
        type: "session.next.text.delta",
        data: {
          timestamp: 3,
          sessionID: "ses_1",
          assistantMessageID: "msg_assistant",
          textID: "txt_1",
          delta: "answer",
        },
      })
      events.push({
        id: "evt_settled",
        type: "session.next.execution.settled",
        data: { timestamp: 4, sessionID: "ses_1", outcome: "success" },
      })
    await turn

    expect(ui.commits.map((item) => item.text)).toEqual(["previous prompt", "answer"])
    expect(ui.events).toContainEqual({ type: "stream.patch", patch: { phase: "idle", status: "" } })
    await transport.close()
  })

  test("shows V2 blockers and replies through the runtime-owned session API", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({ streams: [events] })
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: client,
      sessionID: "ses_1",
      thinking: false,
      limits: () => ({}),
      footer: ui.api,
    })
    events.push({
      id: "evt_permission",
      type: "permission.v2.asked",
      data: { id: "per_1", sessionID: "ses_1", action: "read", resources: ["/tmp/file"] },
    })

    await Bun.sleep(0)
    expect(ui.events).toContainEqual({
      type: "stream.view",
      view: {
        type: "permission",
        request: {
          id: "per_1",
          sessionID: "ses_1",
          permission: "read",
          patterns: ["/tmp/file"],
          metadata: {},
          always: [],
          tool: undefined,
        },
      },
    })
    await transport.close()
  })

  test("rebootstraps after disconnect and completes a promoted turn from idle active state", async () => {
    const first = feed()
    const second = feed()
    first.push(connected("evt_connected_1"))
    second.push(connected("evt_connected_2"))
    let running = true
    const client = sdk({
      streams: [first, second],
      active: () => {
        const active: Record<string, { type: "running" }> = {}
        if (running) active.ses_1 = { type: "running" }
        return active
      },
    })
    let projected = false
    spyOn(client.v2.session, "messages").mockImplementation(() =>
      ok({
        data: projected
          ? [
              {
                id: "msg_prompt",
                type: "user",
                text: "hello",
                files: [],
                agents: [],
                time: { created: 2 },
              },
            ]
          : [],
        cursor: {},
      }),
    )
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: client,
      sessionID: "ses_1",
      thinking: false,
      limits: () => ({}),
      footer: ui.api,
    })
    let admitted = false
    // The generated method has conditional return types for throwOnError; this mock represents the successful branch.
    // @ts-expect-error successful SDK response is valid for both modes at runtime
    spyOn(client.v2.session, "prompt").mockImplementation((request) => {
      const messageID = request.id ?? "msg_prompt"
      const prompt = request.prompt ?? { text: "" }
      admitted = true
      return ok({ data: { admittedSeq: 1, id: messageID, sessionID: "ses_1", prompt, delivery: "steer" as const, timeCreated: 2 } })
    })

    const turn = transport.runPromptTurn({
      agent: undefined,
      model: undefined,
      variant: undefined,
      prompt: { messageID: "msg_prompt", text: "hello", parts: [] },
      files: [],
      includeFiles: true,
    })
    while (!admitted) await Bun.sleep(0)
    projected = true
    running = false
    first.close()
    await turn

    expect(ui.events).toContainEqual({ type: "stream.patch", patch: { phase: "running", status: "reconnecting" } })
    expect(ui.events).toContainEqual({ type: "stream.patch", patch: { phase: "idle", status: "" } })
    await transport.close()
  })

  test("reconciles buffered deltas already present in a resize snapshot", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({ streams: [events] })
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: client,
      sessionID: "ses_1",
      thinking: false,
      replay: true,
      limits: () => ({}),
      footer: ui.api,
    })
    spyOn(client.v2.session, "messages").mockImplementation(() =>
      ok({
        data: [
          {
            id: "msg_assistant",
            type: "assistant",
            agent: "build",
            model: { providerID: "test", id: "model" },
            content: [{ type: "text", id: "txt_1", text: "the answer" }],
            time: { created: 2, completed: 3 },
          },
        ],
        cursor: {},
      }),
    )
    let reset!: () => void
    const resetting = new Promise<void>((resolve) => {
      reset = resolve
    })
    const replay = transport.replayOnResize({ localRows: () => [], reset: () => resetting })
    events.push({
      id: "evt_text",
      type: "session.next.text.delta",
      data: {
        timestamp: 3,
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        textID: "txt_1",
        delta: "answer",
      },
    })
    await Bun.sleep(0)
    reset()
    await replay

    expect(ui.commits.filter((item) => item.text === "the answer")).toHaveLength(1)
    expect(ui.commits.some((item) => item.text === "answer")).toBe(false)
    await transport.close()
  })

  test("renders full reasoning when only the ended event is observed", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({ streams: [events] })
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: client,
      sessionID: "ses_1",
      thinking: true,
      limits: () => ({}),
      footer: ui.api,
    })
    events.push({
      id: "evt_reasoning",
      type: "session.next.reasoning.ended",
      data: {
        timestamp: 3,
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        reasoningID: "reasoning_1",
        text: "considering",
      },
    })
    await Bun.sleep(0)

    expect(ui.commits.at(-1)?.text).toBe("Thinking: considering")
    await transport.close()
  })

  test("interrupts the current Session when an active turn is aborted", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({ streams: [events] })
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: client,
      sessionID: "ses_1",
      thinking: false,
      limits: () => ({}),
      footer: ui.api,
    })
    let admitted = false
    // The generated method has conditional return types for throwOnError; this mock represents the successful branch.
    // @ts-expect-error successful SDK response is valid for both modes at runtime
    spyOn(client.v2.session, "prompt").mockImplementation((request) => {
      const messageID = request.id ?? "msg_prompt"
      const prompt = request.prompt ?? { text: "" }
      admitted = true
      return ok({ data: { admittedSeq: 1, id: messageID, sessionID: "ses_1", prompt, delivery: "steer" as const, timeCreated: 2 } })
    })
    const interrupted = spyOn(client.v2.session, "interrupt").mockImplementation(() => ok(undefined))
    const controller = new AbortController()
    const turn = transport.runPromptTurn({
      agent: undefined,
      model: undefined,
      variant: undefined,
      prompt: { messageID: "msg_prompt", text: "hello", parts: [] },
      files: [],
      includeFiles: true,
      signal: controller.signal,
    })
    while (!admitted) await Bun.sleep(0)
    events.push({
      id: "evt_prompted",
      type: "session.next.prompted",
      data: {
        timestamp: 2,
        sessionID: "ses_1",
        messageID: "msg_prompt",
        prompt: { text: "hello" },
        delivery: "steer",
      },
    })
    await Bun.sleep(0)
    controller.abort()
    events.push({
      id: "evt_settled",
      type: "session.next.execution.settled",
      data: { timestamp: 3, sessionID: "ses_1", outcome: "interrupted" },
    })
    await turn

    expect(interrupted).toHaveBeenCalledWith({ sessionID: "ses_1" })
    await transport.close()
  })
})
