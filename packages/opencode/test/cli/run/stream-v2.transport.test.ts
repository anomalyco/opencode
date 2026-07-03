import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "node:url"
import { OpencodeClient, type V2Event } from "@opencode-ai/sdk/v2"
import { createSessionTransport } from "@/cli/cmd/run/stream-v2.transport"
import type { FooterApi, FooterEvent, StreamCommit } from "@/cli/cmd/run/types"
import { tmpdir } from "../../fixture/fixture"

type RunV2Event = V2Event

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
  return { id, created: 0, type: "server.connected", data: {} } satisfies RunV2Event
}

function durable(sessionID: string, seq = 0, version = 1) {
  return { aggregateID: sessionID, seq, version }
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

type SessionMessages = NonNullable<
  Awaited<ReturnType<OpencodeClient["v2"]["session"]["messages"]>>["data"]
>["data"][number][]

function sdk(input: {
  streams: ReturnType<typeof feed>[]
  active?: () => Record<string, { type: "running" }>
  messages?: Record<string, SessionMessages>
  sessions?: Array<{ id: string; parentID?: string; title?: string; agent?: string; time: { updated: number } }>
}) {
  const client = new OpencodeClient()
  let subscription = 0
  spyOn(client.v2.event, "subscribe").mockImplementation(
    () =>
      Promise.resolve({ stream: input.streams[subscription++]?.stream ?? feed().stream }) as ReturnType<
        typeof client.v2.event.subscribe
      >,
  )
  spyOn(client.v2.session, "messages").mockImplementation((request) =>
    ok({
      data: input.messages?.[request.sessionID] ?? [
        {
          id: "msg_old",
          type: "user" as const,
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
  spyOn(client.v2.session, "active").mockImplementation(() => ok({ data: input.active?.() ?? {}, watermarks: {} }))
  spyOn(client.v2.session, "switchAgent").mockImplementation(() => ok(undefined))
  spyOn(client.v2.session, "switchModel").mockImplementation(() => ok(undefined))
  // The generated methods have conditional return types for throwOnError; the
  // minimal shapes below are enough for family discovery and model fallback.
  spyOn(client.v2.session, "list").mockImplementation((request) => {
    const parentID = request?.parentID
    return ok({
      location: { directory: "/tmp", project: { id: "proj_1", directory: "/tmp" } },
      data:
        input.sessions?.filter((session) =>
          parentID === undefined
            ? true
            : parentID === null
              ? session.parentID === undefined
              : session.parentID === parentID,
        ) ?? [],
    }) as never
  })
  spyOn(client.v2.model, "default").mockImplementation(
    () =>
      ok({
        location: { directory: "/tmp", project: { id: "proj_1", directory: "/tmp" } },
        data: undefined,
      }) as never,
  )
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
      created: 0,
      type: "session.prompt.promoted",
      durable: durable("ses_1"),
      data: {
        sessionID: "ses_1",
        inputID: "msg_prompt",
      },
    })
    events.push({
      id: "evt_text",
      created: 0,
      type: "session.text.delta",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        textID: "txt_1",
        delta: "answer",
      },
    })
    events.push({
      id: "evt_settled",
      created: 0,
      type: "session.execution.settled",
      data: { sessionID: "ses_1", outcome: "success" },
    })
    await turn

    expect(ui.commits.map((item) => item.text)).toEqual(["previous prompt", "answer"])
    expect(ui.events).toContainEqual({ type: "stream.patch", patch: { phase: "idle", status: "" } })
    await transport.close()
  })

  test("sends local file and directory mentions as structured prompt files", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "note.ts")
    const directoryPath = path.join(tmp.path, "docs")
    await Bun.write(filePath, "export const answer = 42\n")
    await fs.mkdir(directoryPath)
    await Bun.write(path.join(directoryPath, "README.md"), "# hello\n")

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
    let request: Parameters<OpencodeClient["v2"]["session"]["prompt"]>[0] | undefined
    // The generated method has conditional return types for throwOnError; this mock represents the successful branch.
    // @ts-expect-error successful SDK response is valid for both modes at runtime
    spyOn(client.v2.session, "prompt").mockImplementation((input) => {
      request = input
      queueMicrotask(() => {
        events.push({
          id: "evt_prompted",
          created: 0,
          type: "session.prompt.promoted",
          durable: durable("ses_1"),
          data: {
            sessionID: "ses_1",
            inputID: "msg_prompt",
          },
        })
        events.push({
          id: "evt_settled",
          created: 0,
          type: "session.execution.settled",
          data: { sessionID: "ses_1", outcome: "success" },
        })
      })
      return ok({
        data: {
          admittedSeq: 1,
          id: input.id ?? "msg_prompt",
          sessionID: "ses_1",
          prompt: input.prompt ?? { text: "" },
          delivery: "steer" as const,
          timeCreated: 2,
        },
      })
    })

    await transport.runPromptTurn({
      agent: undefined,
      model: undefined,
      variant: undefined,
      prompt: {
        messageID: "msg_prompt",
        text: "Review @note.ts and @docs",
        parts: [
          {
            type: "file",
            url: pathToFileURL(filePath).href,
            mime: "text/plain",
            filename: "note.ts",
            source: { type: "file", path: "note.ts", text: { start: 7, end: 15, value: "@note.ts" } },
          },
          {
            type: "file",
            url: pathToFileURL(`${directoryPath}${path.sep}`).href,
            mime: "application/x-directory",
            filename: "docs",
            source: { type: "file", path: "docs/", text: { start: 20, end: 25, value: "@docs" } },
          },
        ],
      },
      files: [],
      includeFiles: true,
    })

    expect(request?.prompt?.text).toBe("Review @note.ts and @docs")
    expect(request?.prompt?.files).toEqual([
      {
        uri: pathToFileURL(filePath).href,
        name: "note.ts",
        source: { start: 7, end: 15, text: "@note.ts" },
      },
      {
        uri: pathToFileURL(`${directoryPath}${path.sep}`).href,
        name: "docs",
        source: { start: 20, end: 25, text: "@docs" },
      },
    ])
    await transport.close()
  })

  test("sends attached file mentions as structured prompt files without reading them", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({ streams: [events] })
    const ui = footer()
    const remoteRead = spyOn(client.file, "read")
    const remoteList = spyOn(client.file, "list")
    const transport = await createSessionTransport({
      sdk: client,
      directory: "/remote/project",
      sessionID: "ses_1",
      thinking: false,
      limits: () => ({}),
      footer: ui.api,
    })
    let request: Parameters<OpencodeClient["v2"]["session"]["prompt"]>[0] | undefined
    // The generated method has conditional return types for throwOnError; this mock represents the successful branch.
    // @ts-expect-error successful SDK response is valid for both modes at runtime
    spyOn(client.v2.session, "prompt").mockImplementation((input) => {
      request = input
      queueMicrotask(() => {
        events.push({
          id: "evt_prompted",
          created: 0,
          type: "session.prompt.promoted",
          durable: durable("ses_1"),
          data: {
            sessionID: "ses_1",
            inputID: "msg_prompt",
          },
        })
        events.push({
          id: "evt_settled",
          created: 0,
          type: "session.execution.settled",
          data: { sessionID: "ses_1", outcome: "success" },
        })
      })
      return ok({
        data: {
          admittedSeq: 1,
          id: input.id ?? "msg_prompt",
          sessionID: "ses_1",
          prompt: input.prompt ?? { text: "" },
          delivery: "steer" as const,
          timeCreated: 2,
        },
      })
    })

    await transport.runPromptTurn({
      agent: undefined,
      model: undefined,
      variant: undefined,
      prompt: {
        messageID: "msg_prompt",
        text: "Review @note.ts and @docs",
        parts: [
          {
            type: "file",
            url: "file:///remote/project/note.ts",
            mime: "text/plain",
            filename: "note.ts",
            source: { type: "file", path: "note.ts", text: { start: 7, end: 15, value: "@note.ts" } },
          },
          {
            type: "file",
            url: "file:///remote/project/docs",
            mime: "application/x-directory",
            filename: "docs",
            source: { type: "file", path: "docs", text: { start: 20, end: 25, value: "@docs" } },
          },
        ],
      },
      files: [],
      includeFiles: true,
    })

    expect(remoteRead).not.toHaveBeenCalled()
    expect(remoteList).not.toHaveBeenCalled()
    expect(request?.prompt?.text).toBe("Review @note.ts and @docs")
    expect(request?.prompt?.files).toEqual([
      {
        uri: "file:///remote/project/note.ts",
        name: "note.ts",
        source: { start: 7, end: 15, text: "@note.ts" },
      },
      {
        uri: "file:///remote/project/docs",
        name: "docs",
        source: { start: 20, end: 25, text: "@docs" },
      },
    ])
    await transport.close()
  })

  test("sends local media mentions as structured prompt files", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "diagram.png")
    await Bun.write(filePath, Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))

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
    let request: Parameters<OpencodeClient["v2"]["session"]["prompt"]>[0] | undefined
    // The generated method has conditional return types for throwOnError; this mock represents the successful branch.
    // @ts-expect-error successful SDK response is valid for both modes at runtime
    spyOn(client.v2.session, "prompt").mockImplementation((input) => {
      request = input
      queueMicrotask(() => {
        events.push({
          id: "evt_prompted",
          created: 0,
          type: "session.prompt.promoted",
          durable: durable("ses_1"),
          data: {
            sessionID: "ses_1",
            inputID: "msg_prompt",
          },
        })
        events.push({
          id: "evt_settled",
          created: 0,
          type: "session.execution.settled",
          data: { sessionID: "ses_1", outcome: "success" },
        })
      })
      return ok({
        data: {
          admittedSeq: 1,
          id: input.id ?? "msg_prompt",
          sessionID: "ses_1",
          prompt: input.prompt ?? { text: "" },
          delivery: "steer" as const,
          timeCreated: 2,
        },
      })
    })

    await transport.runPromptTurn({
      agent: undefined,
      model: undefined,
      variant: undefined,
      prompt: {
        messageID: "msg_prompt",
        text: "Review @diagram.png",
        parts: [
          {
            type: "file",
            url: pathToFileURL(filePath).href,
            mime: "text/plain",
            filename: "diagram.png",
            source: { type: "file", path: "diagram.png", text: { start: 7, end: 19, value: "@diagram.png" } },
          },
        ],
      },
      files: [],
      includeFiles: true,
    })

    expect(request?.prompt?.text).toBe("Review @diagram.png")
    expect(request?.prompt?.files).toEqual([
      {
        name: "diagram.png",
        uri: pathToFileURL(filePath).href,
        source: { start: 7, end: 19, text: "@diagram.png" },
      },
    ])
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
      created: 0,
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
      return ok({
        data: { admittedSeq: 1, id: messageID, sessionID: "ses_1", prompt, delivery: "steer" as const, timeCreated: 2 },
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
    projected = true
    running = false
    first.close()
    await turn

    expect(ui.events).toContainEqual({ type: "stream.patch", patch: { phase: "running", status: "reconnecting" } })
    expect(ui.events).toContainEqual({ type: "stream.patch", patch: { phase: "idle", status: "" } })
    await transport.close()
  })

  test("does not duplicate the optimistic user row when reconnect hydration recovers a missed prompt", async () => {
    const first = feed()
    const second = feed()
    first.push(connected("evt_connected_1"))
    second.push(connected("evt_connected_2"))
    let running = true
    let projected = false
    const client = sdk({
      streams: [first, second],
      active: () => {
        const active: Record<string, { type: "running" }> = {}
        if (running) active.ses_1 = { type: "running" }
        return active
      },
    })
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
    ui.commits.push({ kind: "user", source: "system", text: "hello", phase: "start", messageID: "msg_prompt" })
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
      return ok({
        data: { admittedSeq: 1, id: messageID, sessionID: "ses_1", prompt, delivery: "steer" as const, timeCreated: 2 },
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
    projected = true
    running = false
    first.close()
    await turn

    expect(ui.commits.filter((item) => item.kind === "user" && item.messageID === "msg_prompt")).toHaveLength(1)
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
      created: 0,
      type: "session.text.delta",
      data: {
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

  test("scopes repeated text and reasoning ids by assistant message", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({ streams: [events] })
    spyOn(client.v2.session, "messages").mockImplementation(() =>
      ok({
        data: [
          {
            id: "msg_b",
            type: "assistant",
            agent: "build",
            model: { providerID: "test", id: "model" },
            content: [
              { type: "reasoning", id: "reasoning-0", text: "second thought" },
              { type: "text", id: "text-0", text: "second answer" },
            ],
            time: { created: 4, completed: 5 },
          },
          {
            id: "msg_a",
            type: "assistant",
            agent: "build",
            model: { providerID: "test", id: "model" },
            content: [
              { type: "reasoning", id: "reasoning-0", text: "first thought" },
              { type: "text", id: "text-0", text: "first answer" },
            ],
            time: { created: 2, completed: 3 },
          },
        ],
        cursor: {},
      }),
    )

    const ui = footer()
    const transport = await createSessionTransport({
      sdk: client,
      sessionID: "ses_1",
      thinking: true,
      replay: true,
      limits: () => ({}),
      footer: ui.api,
    })

    expect(ui.commits.map((item) => item.text)).toEqual([
      "Thinking: first thought",
      "first answer",
      "Thinking: second thought",
      "second answer",
    ])
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
      created: 0,
      type: "session.reasoning.ended",
      durable: durable("ses_1"),
      data: {
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

  test("resolves an interrupted turn even when promotion never arrived", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({
      streams: [events],
      active: () => ({ ses_1: { type: "running" } }),
    })
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
      return ok({
        data: { admittedSeq: 1, id: messageID, sessionID: "ses_1", prompt, delivery: "steer" as const, timeCreated: 2 },
      })
    })
    const interrupted = spyOn(client.v2.session, "interrupt").mockImplementation(() => ok(undefined))

    const turn = transport.runPromptTurn({
      agent: undefined,
      model: undefined,
      variant: undefined,
      prompt: { messageID: "msg_prompt", text: "hello", parts: [] },
      files: [],
      includeFiles: true,
    })
    while (!admitted) await Bun.sleep(0)
    await transport.interruptActiveTurn()
    events.push({
      id: "evt_settled",
      created: 0,
      type: "session.execution.settled",
      data: { sessionID: "ses_1", outcome: "success" },
    })
    await turn

    expect(interrupted).toHaveBeenCalledWith({ sessionID: "ses_1" })
    await transport.close()
  })

  test("falls back to the default model when selecting a variant on a fresh session", async () => {
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
    // The generated method has conditional return types for throwOnError; the test only needs the nested model field.
    // @ts-expect-error minimal session shape is enough for this lookup
    spyOn(client.v2.session, "get").mockImplementation(() => ok({ data: { model: undefined } }))
    spyOn(client.v2.model, "default").mockImplementation(
      () =>
        ok({
          location: { directory: "/tmp", project: { id: "proj_1", directory: "/tmp" } },
          data: { id: "gpt-5", providerID: "openai" },
        }) as never,
    )
    const switched = spyOn(client.v2.session, "switchModel").mockImplementation(() => ok(undefined))
    let admitted = false
    // The generated method has conditional return types for throwOnError; this mock represents the successful branch.
    // @ts-expect-error successful SDK response is valid for both modes at runtime
    spyOn(client.v2.session, "prompt").mockImplementation((request) => {
      const messageID = request.id ?? "msg_prompt"
      const prompt = request.prompt ?? { text: "" }
      admitted = true
      return ok({
        data: { admittedSeq: 1, id: messageID, sessionID: "ses_1", prompt, delivery: "steer" as const, timeCreated: 2 },
      })
    })

    const turn = transport.runPromptTurn({
      agent: undefined,
      model: undefined,
      variant: "high",
      prompt: { messageID: "msg_prompt", text: "hello", parts: [] },
      files: [],
      includeFiles: true,
    })
    while (!admitted) await Bun.sleep(0)
    events.push({
      id: "evt_prompted",
      created: 0,
      type: "session.prompt.promoted",
      durable: durable("ses_1"),
      data: {
        sessionID: "ses_1",
        inputID: "msg_prompt",
      },
    })
    events.push({
      id: "evt_settled",
      created: 0,
      type: "session.execution.settled",
      data: { sessionID: "ses_1", outcome: "success" },
    })
    await turn

    expect(switched).toHaveBeenCalledWith(
      { sessionID: "ses_1", model: { providerID: "openai", id: "gpt-5", variant: "high" } },
      expect.objectContaining({ throwOnError: true }),
    )
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
      return ok({
        data: { admittedSeq: 1, id: messageID, sessionID: "ses_1", prompt, delivery: "steer" as const, timeCreated: 2 },
      })
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
      created: 0,
      type: "session.prompt.promoted",
      durable: durable("ses_1"),
      data: {
        sessionID: "ses_1",
        inputID: "msg_prompt",
      },
    })
    await Bun.sleep(0)
    controller.abort()
    events.push({
      id: "evt_settled",
      created: 0,
      type: "session.execution.settled",
      data: { sessionID: "ses_1", outcome: "success" },
    })
    await turn

    expect(interrupted).toHaveBeenCalledWith({ sessionID: "ses_1" })
    await transport.close()
  })

  test("runs a shell turn through v2.session.shell and renders live output", async () => {
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
    let request: Parameters<OpencodeClient["v2"]["session"]["shell"]>[0] | undefined
    spyOn(client.v2.session, "shell").mockImplementation((input) => {
      request = input
      queueMicrotask(() => {
        events.push({
          id: "evt_shell_start",
          created: 0,
          type: "session.shell.started",
          durable: durable("ses_1"),
          data: {
            sessionID: "ses_1",
            shell: {
              id: "sh_shell",
              status: "running",
              command: "ls",
              cwd: "/tmp",
              shell: "/bin/sh",
              file: "/tmp/opencode-shell",
              metadata: {},
              time: { started: 0 },
            },
          },
        })
        events.push({
          id: "evt_shell_end",
          created: 0,
          type: "session.shell.ended",
          durable: durable("ses_1", 1),
          data: {
            sessionID: "ses_1",
            shell: {
              id: "sh_shell",
              status: "exited",
              command: "ls",
              cwd: "/tmp",
              shell: "/bin/sh",
              file: "/tmp/opencode-shell",
              exit: 0,
              metadata: {},
              time: { started: 0, completed: 1 },
            },
            output: { output: "file.txt", cursor: 8, size: 8, truncated: false },
          },
        })
      })
      return ok(undefined) as never
    })

    await transport.runPromptTurn({
      agent: undefined,
      model: undefined,
      variant: undefined,
      prompt: { text: "ls", parts: [], mode: "shell" },
      files: [],
      includeFiles: true,
    })

    expect(request).toMatchObject({ sessionID: "ses_1", command: "ls" })
    expect(ui.commits.filter((item) => item.shell)).toMatchObject([
      { phase: "start", tool: "bash", toolState: "running", shell: { callID: "sh_shell", command: "ls" } },
      { phase: "progress", text: "file.txt", toolState: "completed", shell: { callID: "sh_shell", command: "ls" } },
    ])
    expect(ui.events).toContainEqual({ type: "stream.patch", patch: { phase: "running", status: "running shell" } })
    await transport.close()
  })

  test("aborts an active shell turn without interrupting the session", async () => {
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
    let started = false
    let aborted = false
    spyOn(client.v2.session, "shell").mockImplementation(
      (_input, options) =>
        new Promise((_, reject) => {
          started = true
          options?.signal?.addEventListener("abort", () => {
            aborted = true
            reject(new Error("aborted"))
          })
        }) as never,
    )
    const interrupted = spyOn(client.v2.session, "interrupt").mockImplementation(() => ok(undefined))

    const turn = transport.runPromptTurn({
      agent: undefined,
      model: undefined,
      variant: undefined,
      prompt: { text: "sleep 100", parts: [], mode: "shell" },
      files: [],
      includeFiles: true,
    })
    while (!started) await Bun.sleep(0)
    await transport.interruptActiveTurn()
    await turn

    expect(aborted).toBe(true)
    expect(interrupted).not.toHaveBeenCalled()
    await transport.close()
  })

  test("hydrates projected shell transcripts once and dedupes live redelivery", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({
      streams: [events],
      messages: {
        ses_1: [
          {
            id: "msg_shell",
            type: "shell" as const,
            shell: {
              id: "sh_1",
              status: "exited",
              command: "ls",
              cwd: "/tmp",
              shell: "/bin/sh",
              file: "/tmp/opencode-shell",
              exit: 0,
              metadata: {},
              time: { started: 0, completed: 1 },
            },
            output: { output: "file.txt", cursor: 8, size: 8, truncated: false },
            time: { created: 1, completed: 2 },
          },
        ],
      },
    })
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: client,
      sessionID: "ses_1",
      thinking: false,
      replay: true,
      limits: () => ({}),
      footer: ui.api,
    })
    events.push({
      id: "evt_shell_end",
      created: 0,
      type: "session.shell.ended",
      durable: durable("ses_1", 1),
      data: {
        sessionID: "ses_1",
        shell: {
          id: "sh_1",
          status: "exited",
          command: "ls",
          cwd: "/tmp",
          shell: "/bin/sh",
          file: "/tmp/opencode-shell",
          exit: 0,
          metadata: {},
          time: { started: 0, completed: 1 },
        },
        output: { output: "file.txt", cursor: 8, size: 8, truncated: false },
      },
    })
    await Bun.sleep(0)
    await Bun.sleep(0)

    expect(ui.commits.filter((item) => item.shell)).toMatchObject([
      { phase: "start", shell: { callID: "sh_1", command: "ls" } },
      { phase: "progress", text: "file.txt", toolState: "completed" },
    ])
    await transport.close()
  })

  test("routes command prompts through v2.session.command", async () => {
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
    let request: Parameters<OpencodeClient["v2"]["session"]["command"]>[0] | undefined
    spyOn(client.v2.session, "command").mockImplementation((input) => {
      request = input
      queueMicrotask(() => {
        events.push({
          id: "evt_prompted",
          created: 0,
          type: "session.prompt.promoted",
          durable: durable("ses_1"),
          data: {
            sessionID: "ses_1",
            inputID: "msg_cmd",
          },
        })
        events.push({
          id: "evt_settled",
          created: 0,
          type: "session.execution.settled",
          data: { sessionID: "ses_1", outcome: "success" },
        })
      })
      return ok({
        data: {
          admittedSeq: 1,
          id: input.id ?? "msg_cmd",
          sessionID: "ses_1",
          prompt: { text: "evaluated template" },
          delivery: "steer" as const,
          timeCreated: 2,
        },
      })
    })

    await transport.runPromptTurn({
      agent: "build",
      model: { providerID: "test", modelID: "model" },
      variant: undefined,
      prompt: {
        messageID: "msg_cmd",
        text: "/deploy prod",
        parts: [],
        command: { name: "deploy", arguments: "prod" },
      },
      files: [],
      includeFiles: true,
    })

    expect(request).toMatchObject({
      sessionID: "ses_1",
      id: "msg_cmd",
      command: "deploy",
      arguments: "prod",
      agent: "build",
      model: { providerID: "test", id: "model" },
      delivery: "steer",
    })
    // Selection rides the command payload; no separate client-side switch.
    expect(client.v2.session.switchAgent).not.toHaveBeenCalled()
    expect(client.v2.session.switchModel).not.toHaveBeenCalled()
    await transport.close()
  })

  test("routes skill prompts through v2.session.skill and settles without promotion", async () => {
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
    let request: Parameters<OpencodeClient["v2"]["session"]["skill"]>[0] | undefined
    const command = spyOn(client.v2.session, "command")
    const prompt = spyOn(client.v2.session, "prompt")
    spyOn(client.v2.session, "skill").mockImplementation((input) => {
      request = input
      queueMicrotask(() => {
        events.push({
          id: "evt_skill",
          created: 0,
          type: "session.skill.activated",
          durable: durable("ses_1"),
          data: {
            sessionID: "ses_1",
            name: input.skill ?? "tigerstyle",
            text: "skill instructions",
          },
        })
        events.push({
          id: "evt_settled",
          created: 0,
          type: "session.execution.settled",
          data: { sessionID: "ses_1", outcome: "success" },
        })
      })
      return ok(undefined) as never
    })

    await transport.runPromptTurn({
      agent: undefined,
      model: undefined,
      variant: undefined,
      prompt: {
        messageID: "msg_skill",
        text: "/tigerstyle",
        parts: [],
        command: { name: "tigerstyle", arguments: "", source: "skill" },
      },
      files: [],
      includeFiles: true,
    })

    expect(request).toMatchObject({ sessionID: "ses_1", id: "msg_skill", skill: "tigerstyle" })
    expect(command).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    expect(ui.commits).toContainEqual(
      expect.objectContaining({ kind: "system", text: '→ Skill "tigerstyle"', messageID: "msg_skill" }),
    )
    await transport.close()
  })

  test("does not resolve a skill turn before the matching activation is observed", async () => {
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
    let sent = false
    spyOn(client.v2.session, "skill").mockImplementation(() => {
      sent = true
      return ok(undefined) as never
    })

    let done = false
    const turn = transport
      .runPromptTurn({
        agent: undefined,
        model: undefined,
        variant: undefined,
        prompt: {
          messageID: "msg_skill",
          text: "/tigerstyle",
          parts: [],
          command: { name: "tigerstyle", arguments: "", source: "skill" },
        },
        files: [],
        includeFiles: true,
      })
      .then(() => {
        done = true
      })
    while (!sent) await Bun.sleep(0)
    events.push({
      id: "evt_unrelated_settled",
      created: 0,
      type: "session.execution.settled",
      data: { sessionID: "ses_1", outcome: "success" },
    })
    await Bun.sleep(0)
    await Bun.sleep(0)
    expect(done).toBe(false)

    events.push({
      id: "evt_skill",
      created: 0,
      type: "session.skill.activated",
      durable: durable("ses_1"),
      data: {
        sessionID: "ses_1",
        name: "tigerstyle",
        text: "skill instructions",
      },
    })
    events.push({
      id: "evt_skill_settled",
      created: 0,
      type: "session.execution.settled",
      data: { sessionID: "ses_1", outcome: "success" },
    })
    await turn

    expect(done).toBe(true)
    await transport.close()
  })

  test("hydrates skill activation messages once and dedupes live redelivery", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({
      streams: [events],
      messages: {
        ses_1: [
          {
            id: "msg_skill",
            type: "skill" as const,
            name: "tigerstyle",
            text: "skill instructions",
            time: { created: 2 },
          },
        ],
      },
    })
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: client,
      sessionID: "ses_1",
      thinking: false,
      replay: true,
      limits: () => ({}),
      footer: ui.api,
    })
    events.push({
      id: "evt_skill",
      created: 0,
      type: "session.skill.activated",
      durable: durable("ses_1"),
      data: {
        sessionID: "ses_1",
        name: "tigerstyle",
        text: "skill instructions",
      },
    })
    await Bun.sleep(0)
    await Bun.sleep(0)

    expect(ui.commits.filter((item) => item.text === '→ Skill "tigerstyle"')).toHaveLength(1)
    await transport.close()
  })

  test("discovers a live child session and tracks its tab and selected detail", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({
      streams: [events],
      messages: {
        ses_child: [
          {
            id: "msg_task",
            type: "user" as const,
            text: "task prompt",
            files: [],
            agents: [],
            time: { created: 1 },
          },
        ],
      },
    })
    spyOn(client.v2.session, "get").mockImplementation(() =>
      ok({
        data: {
          id: "ses_child",
          parentID: "ses_1",
          projectID: "proj_1",
          agent: "explore",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
          title: "Find files",
          location: { directory: "/tmp", project: { id: "proj_1", directory: "/tmp" } },
        },
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
    const states = () => ui.events.flatMap((event) => (event.type === "stream.subagent" ? [event.state] : []))
    transport.selectSubagent("ses_child")

    events.push({
      id: "evt_child_step",
      created: 0,
      type: "session.step.started",
      durable: durable("ses_child"),
      data: {
        sessionID: "ses_child",
        assistantMessageID: "msg_child_a",
        agent: "explore",
        model: { providerID: "test", id: "model" },
      },
    })
    while (!states().some((state) => state.details.ses_child?.commits.some((item) => item.text === "task prompt")))
      await Bun.sleep(0)
    expect(states().at(-1)?.tabs).toMatchObject([
      { sessionID: "ses_child", label: "Explore", title: "Find files", status: "running" },
    ])

    events.push({
      id: "evt_child_text",
      created: 0,
      type: "session.text.delta",
      data: {
        sessionID: "ses_child",
        assistantMessageID: "msg_child_a",
        textID: "txt_child",
        delta: "child answer",
      },
    })
    while (!states().some((state) => state.details.ses_child?.commits.some((item) => item.text === "child answer")))
      await Bun.sleep(0)

    events.push({
      id: "evt_child_settled",
      created: 0,
      type: "session.execution.settled",
      data: { sessionID: "ses_child", outcome: "success" },
    })
    while (!states().some((state) => state.tabs.some((tab) => tab.status === "completed"))) await Bun.sleep(0)
    await transport.close()
  })

  test("keeps child terminal state observed during discovery", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({ streams: [events] })
    let resolveGet: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      resolveGet = resolve
    })
    spyOn(client.v2.session, "get").mockImplementation(async () => {
      await gate
      return ok({
        data: {
          id: "ses_child",
          parentID: "ses_1",
          projectID: "proj_1",
          agent: "explore",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
          title: "Find files",
          location: { directory: "/tmp", project: { id: "proj_1", directory: "/tmp" } },
        },
      })
    })
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: client,
      sessionID: "ses_1",
      thinking: false,
      limits: () => ({}),
      footer: ui.api,
    })
    const states = () => ui.events.flatMap((event) => (event.type === "stream.subagent" ? [event.state] : []))

    // Both events arrive while session.get is still in flight.
    events.push({
      id: "evt_child_step",
      created: 0,
      type: "session.step.started",
      durable: durable("ses_child"),
      data: {
        sessionID: "ses_child",
        assistantMessageID: "msg_child_a",
        agent: "explore",
        model: { providerID: "test", id: "model" },
      },
    })
    events.push({
      id: "evt_child_settled",
      created: 0,
      type: "session.execution.settled",
      data: { sessionID: "ses_child", outcome: "interrupted" },
    })
    await Bun.sleep(0)
    resolveGet?.()
    while (!states().some((state) => state.tabs.some((tab) => tab.status === "cancelled"))) await Bun.sleep(0)
    await transport.close()
  })

  test("does not resurrect a settled child from stale discovery buffer", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({ streams: [events] })
    let resolveGet: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      resolveGet = resolve
    })
    spyOn(client.v2.session, "get").mockImplementation(async () => {
      await gate
      return ok({
        data: {
          id: "ses_child",
          parentID: "ses_1",
          projectID: "proj_1",
          agent: "explore",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
          title: "Find files",
          location: { directory: "/tmp", project: { id: "proj_1", directory: "/tmp" } },
        },
      })
    })
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: client,
      sessionID: "ses_1",
      thinking: false,
      limits: () => ({}),
      footer: ui.api,
    })
    const states = () => ui.events.flatMap((event) => (event.type === "stream.subagent" ? [event.state] : []))

    // Child event arrives first and gets buffered behind the gated session.get.
    events.push({
      id: "evt_child_step",
      created: 0,
      type: "session.step.started",
      durable: durable("ses_child"),
      data: {
        sessionID: "ses_child",
        assistantMessageID: "msg_child_a",
        agent: "explore",
        model: { providerID: "test", id: "model" },
      },
    })
    // Parent's background subagent tool.success adopts the child mid-discovery.
    events.push({
      id: "evt_parent_call",
      created: 0,
      type: "session.tool.called",
      durable: durable("ses_1"),
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_parent_a",
        callID: "call_sub",
        tool: "subagent",
        input: { agent: "explore", description: "Find things", prompt: "go", background: true },
        provider: { executed: true },
      },
    })
    events.push({
      id: "evt_parent_success",
      created: 0,
      type: "session.tool.success",
      durable: durable("ses_1", 1),
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_parent_a",
        callID: "call_sub",
        structured: { sessionID: "ses_child", status: "running", output: "" },
        content: [],
        provider: { executed: true },
      },
    })
    // The settled event arrives after adoption, so it applies directly.
    events.push({
      id: "evt_child_settled",
      created: 0,
      type: "session.execution.settled",
      data: { sessionID: "ses_child", outcome: "interrupted" },
    })
    while (!states().some((state) => state.tabs.some((tab) => tab.status === "cancelled"))) await Bun.sleep(0)

    // Resolving discovery must not replay the buffered step.started over the
    // terminal status.
    const before = states().length
    resolveGet?.()
    while (states().length === before) await Bun.sleep(0)
    await Bun.sleep(0)
    await Bun.sleep(0)
    expect(states().at(-1)?.tabs).toMatchObject([{ sessionID: "ses_child", status: "cancelled" }])
    await transport.close()
  })

  test("adopts historical children from the session family list", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({
      streams: [events],
      sessions: [
        { id: "ses_child_old", parentID: "ses_1", title: "Earlier subagent", agent: "explore", time: { updated: 9 } },
        { id: "ses_unrelated", title: "Different session", time: { updated: 5 } },
        { id: "ses_sibling", parentID: "ses_2", title: "Someone else's child", time: { updated: 4 } },
      ],
    })
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: client,
      sessionID: "ses_1",
      thinking: false,
      limits: () => ({}),
      footer: ui.api,
    })
    const states = ui.events.flatMap((event) => (event.type === "stream.subagent" ? [event.state] : []))
    expect(client.v2.session.list).toHaveBeenCalledWith(
      { parentID: "ses_1", limit: 100, order: "desc" },
      { throwOnError: true },
    )
    expect(states.at(-1)?.tabs).toMatchObject([
      {
        sessionID: "ses_child_old",
        label: "Explore",
        title: "Earlier subagent",
        status: "completed",
      },
    ])
    await transport.close()
  })

  test("hydrates completed subagent children from projected tool output", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({
      streams: [events],
      messages: {
        ses_1: [
          {
            id: "msg_parent",
            type: "assistant" as const,
            agent: "build",
            model: { providerID: "test", id: "model" },
            time: { created: 1, completed: 3 },
            content: [
              {
                type: "tool" as const,
                id: "call_sub",
                name: "subagent",
                state: {
                  status: "completed" as const,
                  input: { agent: "explore", description: "Find things", prompt: "go" },
                  content: [{ type: "text" as const, text: "done" }],
                  structured: { sessionID: "ses_child", status: "completed", output: "done" },
                },
                time: { created: 1, ran: 1, completed: 2 },
              },
            ],
          },
        ],
      },
    })
    const ui = footer()
    const transport = await createSessionTransport({
      sdk: client,
      sessionID: "ses_1",
      thinking: false,
      limits: () => ({}),
      footer: ui.api,
    })
    const states = ui.events.flatMap((event) => (event.type === "stream.subagent" ? [event.state] : []))
    expect(states.at(-1)?.tabs).toMatchObject([
      {
        sessionID: "ses_child",
        label: "Explore",
        description: "Find things",
        status: "completed",
        toolCalls: undefined,
      },
    ])
    await transport.close()
  })
})
