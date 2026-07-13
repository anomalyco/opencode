import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "node:url"
import {
  OpenCode,
  type EventSubscribeOutput,
  type MessageListOutput,
  type OpenCodeClient,
} from "@opencode-ai/client/promise"
import { createSessionTransport } from "@opencode-ai/cli/mini/stream-v2.transport"
import type { FooterApi, FooterEvent, StreamCommit } from "@opencode-ai/cli/mini/types"
import { tmpdir } from "../../fixture/fixture"

type RunV2Event = EventSubscribeOutput

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
  return Promise.resolve(data)
}

function connected(id = "evt_connected") {
  return { id, type: "server.connected", data: {} } satisfies RunV2Event
}

function durable(sessionID: string, seq?: number): { aggregateID: string; seq: number; version: 1 }
function durable<const Version extends 1 | 2>(
  sessionID: string,
  seq: number,
  version: Version,
): { aggregateID: string; seq: number; version: Version }
function durable(sessionID: string, seq = 0, version: 1 | 2 = 1) {
  return { aggregateID: sessionID, seq, version }
}

function promptAdmission(input: Parameters<OpenCodeClient["session"]["prompt"]>[0], sessionID = "ses_1") {
  return {
    admittedSeq: 1,
    id: input.id ?? "msg_prompt",
    sessionID,
    type: "user" as const,
    data: {
      text: input.text,
      files: input.files,
      agents: input.agents,
      metadata: input.metadata,
    },
    delivery: input.delivery ?? ("steer" as const),
    timeCreated: 2,
  }
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

type SessionMessages = MessageListOutput["data"]

function sdk(input: {
  streams: ReturnType<typeof feed>[]
  active?: () => Record<string, { type: "running" }>
  messages?: Record<string, SessionMessages>
  sessions?: Array<{ id: string; parentID?: string; title?: string; agent?: string; time: { updated: number } }>
}) {
  const client = OpenCode.make({ baseUrl: "https://opencode.test" })
  let subscription = 0
  spyOn(client.event, "subscribe").mockImplementation(() => input.streams[subscription++]?.stream ?? feed().stream)
  spyOn(client.message, "list").mockImplementation((request) =>
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
  spyOn(client.permission, "list").mockImplementation(() => ok([]))
  spyOn(client.question, "list").mockImplementation(() => ok([]))
  spyOn(client.session, "active").mockImplementation(() => ok(input.active?.() ?? {}))
  spyOn(client.session, "switchAgent").mockImplementation(() => ok(undefined))
  spyOn(client.session, "switchModel").mockImplementation(() => ok(undefined))
  // The generated methods have conditional return types for throwOnError; the
  // minimal shapes below are enough for family discovery and model fallback.
  spyOn(client.session, "list").mockImplementation((request) => {
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
  spyOn(client.model, "default").mockImplementation(
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
    spyOn(client.session, "prompt").mockImplementation((request) => {
      admitted = true
      return ok({ data: promptAdmission(request) }) as never
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
      type: "session.input.promoted",
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
        ordinal: 0,
        delta: "answer",
      },
    })
    events.push({
      id: "evt_settled",
      created: 0,
      type: "session.execution.succeeded",
      durable: durable("ses_1"),
      data: { sessionID: "ses_1" },
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
    let request: Parameters<OpenCodeClient["session"]["prompt"]>[0] | undefined
    spyOn(client.session, "prompt").mockImplementation((input) => {
      request = input
      queueMicrotask(() => {
        events.push({
          id: "evt_prompted",
          created: 0,
          type: "session.input.promoted",
          durable: durable("ses_1"),
          data: {
            sessionID: "ses_1",
            inputID: "msg_prompt",
          },
        })
        events.push({
          id: "evt_settled",
          created: 0,
          type: "session.execution.succeeded",
          durable: durable("ses_1"),
          data: { sessionID: "ses_1" },
        })
      })
      return ok({ data: promptAdmission(input) }) as never
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

    expect(request?.text).toBe("Review @note.ts and @docs")
    expect(request?.files).toEqual([
      {
        uri: pathToFileURL(filePath).href,
        name: "note.ts",
        mention: { start: 7, end: 15, text: "@note.ts" },
      },
      {
        uri: pathToFileURL(`${directoryPath}${path.sep}`).href,
        name: "docs",
        mention: { start: 20, end: 25, text: "@docs" },
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
    let request: Parameters<OpenCodeClient["session"]["prompt"]>[0] | undefined
    // The generated method has conditional return types for throwOnError; this mock represents the successful branch.
    // @ts-expect-error successful SDK response is valid for both modes at runtime
    spyOn(client.session, "prompt").mockImplementation((input) => {
      request = input
      queueMicrotask(() => {
        events.push({
          id: "evt_prompted",
          created: 0,
          type: "session.input.promoted",
          durable: durable("ses_1"),
          data: {
            sessionID: "ses_1",
            inputID: "msg_prompt",
          },
        })
        events.push({
          id: "evt_settled",
          created: 0,
          type: "session.execution.succeeded",
          durable: durable("ses_1"),
          data: { sessionID: "ses_1" },
        })
      })
      return ok({ data: promptAdmission(input) })
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
    expect(request?.text).toBe("Review @note.ts and @docs")
    expect(request?.files).toEqual([
      {
        uri: "file:///remote/project/note.ts",
        name: "note.ts",
        mention: { start: 7, end: 15, text: "@note.ts" },
      },
      {
        uri: "file:///remote/project/docs",
        name: "docs",
        mention: { start: 20, end: 25, text: "@docs" },
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
    let request: Parameters<OpenCodeClient["session"]["prompt"]>[0] | undefined
    // The generated method has conditional return types for throwOnError; this mock represents the successful branch.
    // @ts-expect-error successful SDK response is valid for both modes at runtime
    spyOn(client.session, "prompt").mockImplementation((input) => {
      request = input
      queueMicrotask(() => {
        events.push({
          id: "evt_prompted",
          created: 0,
          type: "session.input.promoted",
          durable: durable("ses_1"),
          data: {
            sessionID: "ses_1",
            inputID: "msg_prompt",
          },
        })
        events.push({
          id: "evt_settled",
          created: 0,
          type: "session.execution.succeeded",
          durable: durable("ses_1"),
          data: { sessionID: "ses_1" },
        })
      })
      return ok({ data: promptAdmission(input) })
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

    expect(request?.text).toBe("Review @diagram.png")
    expect(request?.files).toEqual([
      {
        name: "diagram.png",
        uri: pathToFileURL(filePath).href,
        mention: { start: 7, end: 19, text: "@diagram.png" },
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
          action: "read",
          resources: ["/tmp/file"],
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
    spyOn(client.message, "list").mockImplementation(() =>
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
    spyOn(client.session, "prompt").mockImplementation((request) => {
      admitted = true
      return ok({ data: promptAdmission(request) })
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
    spyOn(client.message, "list").mockImplementation(() =>
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
    spyOn(client.session, "prompt").mockImplementation((request) => {
      admitted = true
      return ok({ data: promptAdmission(request) })
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
    spyOn(client.message, "list").mockImplementation(() =>
      ok({
        data: [
          {
            id: "msg_assistant",
            type: "assistant",
            agent: "build",
            model: { providerID: "test", id: "model" },
            content: [{ type: "text", text: "the answer" }],
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
      id: "evt_text_started",
      created: 0,
      type: "session.text.started",
      durable: durable("ses_1"),
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        ordinal: 0,
      },
    })
    events.push({
      id: "evt_text",
      created: 0,
      type: "session.text.delta",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        ordinal: 0,
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

  test("scopes text and reasoning ordinals by assistant message", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({ streams: [events] })
    spyOn(client.message, "list").mockImplementation(() =>
      ok({
        data: [
          {
            id: "msg_b",
            type: "assistant",
            agent: "build",
            model: { providerID: "test", id: "model" },
            content: [
              { type: "reasoning", text: "second thought" },
              { type: "text", text: "second answer" },
            ],
            time: { created: 4, completed: 5 },
          },
          {
            id: "msg_a",
            type: "assistant",
            agent: "build",
            model: { providerID: "test", id: "model" },
            content: [
              { type: "reasoning", text: "first thought" },
              { type: "text", text: "first answer" },
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
        ordinal: 0,
        text: "considering",
      },
    })
    await Bun.sleep(0)

    expect(ui.commits.at(-1)?.text).toBe("Thinking: considering")
    await transport.close()
  })

  test("renders a live tool start when the call begins", async () => {
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
      id: "evt_tool_input",
      created: 1,
      type: "session.tool.input.started",
      durable: durable("ses_1"),
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_read",
        name: "read",
      },
    })
    events.push({
      id: "evt_tool_called",
      created: 2,
      type: "session.tool.called",
      durable: durable("ses_1", 1),
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_read",
        input: { path: "README.md" },
        executed: false,
      },
    })
    await Bun.sleep(0)

    expect(ui.commits).toContainEqual(
      expect.objectContaining({ kind: "tool", phase: "start", partID: "prt_call_read", tool: "read" }),
    )
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
    spyOn(client.session, "prompt").mockImplementation((request) => {
      admitted = true
      return ok({ data: promptAdmission(request) })
    })
    const interrupted = spyOn(client.session, "interrupt").mockImplementation(() => ok(undefined))

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
      type: "session.execution.interrupted",
      durable: durable("ses_1"),
      data: { sessionID: "ses_1", reason: "user" },
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
    spyOn(client.session, "get").mockImplementation(() => ok({ model: undefined }) as never)
    spyOn(client.model, "default").mockImplementation(
      () =>
        ok({
          location: { directory: "/tmp", project: { id: "proj_1", directory: "/tmp" } },
          data: { id: "gpt-5", providerID: "openai" },
        }) as never,
    )
    const switched = spyOn(client.session, "switchModel").mockImplementation(() => ok(undefined))
    let admitted = false
    // The generated method has conditional return types for throwOnError; this mock represents the successful branch.
    // @ts-expect-error successful SDK response is valid for both modes at runtime
    spyOn(client.session, "prompt").mockImplementation((request) => {
      admitted = true
      return ok({ data: promptAdmission(request) })
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
      type: "session.input.promoted",
      durable: durable("ses_1"),
      data: {
        sessionID: "ses_1",
        inputID: "msg_prompt",
      },
    })
    events.push({
      id: "evt_settled",
      created: 0,
      type: "session.execution.succeeded",
      durable: durable("ses_1"),
      data: { sessionID: "ses_1" },
    })
    await turn

    expect(switched).toHaveBeenCalledWith(
      { sessionID: "ses_1", model: { providerID: "openai", id: "gpt-5", variant: "high" } },
      { signal: undefined },
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
    spyOn(client.session, "prompt").mockImplementation((request) => {
      admitted = true
      return ok({ data: promptAdmission(request) })
    })
    const interrupted = spyOn(client.session, "interrupt").mockImplementation(() => ok(undefined))
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
      type: "session.input.promoted",
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
      type: "session.execution.interrupted",
      durable: durable("ses_1"),
      data: { sessionID: "ses_1", reason: "user" },
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
    let request: Parameters<OpenCodeClient["session"]["shell"]>[0] | undefined
    spyOn(client.session, "shell").mockImplementation((input) => {
      request = input
      queueMicrotask(() => {
        events.push({
          id: input.id ?? "evt_missing",
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

    expect(request).toMatchObject({ sessionID: "ses_1", command: "ls", id: expect.stringMatching(/^evt_/) })
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
    spyOn(client.session, "shell").mockImplementation(
      (_input, options) =>
        new Promise((_, reject) => {
          started = true
          options?.signal?.addEventListener("abort", () => {
            aborted = true
            reject(new Error("aborted"))
          })
        }) as never,
    )
    const interrupted = spyOn(client.session, "interrupt").mockImplementation(() => ok(undefined))

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

  test("does not resolve an owned shell output wait from an unrelated shell", async () => {
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
    let request: Parameters<OpenCodeClient["session"]["shell"]>[0] | undefined
    let complete!: () => void
    spyOn(client.session, "shell").mockImplementation((input) => {
      request = input
      return new Promise<void>((resolve) => {
        complete = resolve
      }) as never
    })

    let done = false
    const turn = transport
      .runPromptTurn({
        agent: undefined,
        model: undefined,
        variant: undefined,
        prompt: { text: "pwd", parts: [], mode: "shell" },
        files: [],
        includeFiles: true,
      })
      .then(() => {
        done = true
      })
    while (!request) await Bun.sleep(0)
    events.push({
      id: "evt_unrelated_shell",
      created: 0,
      type: "session.shell.started",
      durable: durable("ses_1"),
      data: {
        sessionID: "ses_1",
        shell: {
          id: "sh_unrelated",
          status: "running",
          command: "other",
          cwd: "/tmp",
          shell: "/bin/sh",
          file: "/tmp/unrelated",
          metadata: {},
          time: { started: 0 },
        },
      },
    })
    events.push({
      id: "evt_unrelated_end",
      created: 0,
      type: "session.shell.ended",
      durable: durable("ses_1", 1),
      data: {
        sessionID: "ses_1",
        shell: {
          id: "sh_unrelated",
          status: "exited",
          command: "other",
          cwd: "/tmp",
          shell: "/bin/sh",
          file: "/tmp/unrelated",
          exit: 0,
          metadata: {},
          time: { started: 0, completed: 1 },
        },
        output: { output: "wrong", cursor: 5, size: 5, truncated: false },
      },
    })
    await Bun.sleep(0)
    complete()
    await Bun.sleep(0)
    expect(done).toBe(false)

    events.push({
      id: request.id ?? "evt_missing",
      created: 0,
      type: "session.shell.started",
      durable: durable("ses_1", 2),
      data: {
        sessionID: "ses_1",
        shell: {
          id: "sh_owned",
          status: "running",
          command: "pwd",
          cwd: "/tmp",
          shell: "/bin/sh",
          file: "/tmp/owned",
          metadata: {},
          time: { started: 0 },
        },
      },
    })
    events.push({
      id: "evt_owned_end",
      created: 0,
      type: "session.shell.ended",
      durable: durable("ses_1", 3),
      data: {
        sessionID: "ses_1",
        shell: {
          id: "sh_owned",
          status: "exited",
          command: "pwd",
          cwd: "/tmp",
          shell: "/bin/sh",
          file: "/tmp/owned",
          exit: 0,
          metadata: {},
          time: { started: 0, completed: 1 },
        },
        output: { output: "/tmp", cursor: 4, size: 4, truncated: false },
      },
    })
    await turn

    expect(request.id).toMatch(/^evt_/)
    expect(ui.commits.some((item) => item.shell?.callID === "sh_owned" && item.text === "/tmp")).toBe(true)
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
            shellID: "sh_1",
            status: "exited",
            command: "ls",
            exit: 0,
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

  test("renders failed projected shells as errors and marks truncated live output", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({
      streams: [events],
      messages: {
        ses_1: [
          {
            id: "msg_failed_shell",
            type: "shell" as const,
            shellID: "sh_failed",
            status: "exited",
            command: "false",
            exit: 7,
            output: { output: "failure output", cursor: 14, size: 14, truncated: false },
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
      id: "evt_truncated_start",
      created: 0,
      type: "session.shell.started",
      durable: durable("ses_1"),
      data: {
        sessionID: "ses_1",
        shell: {
          id: "sh_truncated",
          status: "running",
          command: "long",
          cwd: "/tmp",
          shell: "/bin/sh",
          file: "/tmp/truncated",
          metadata: {},
          time: { started: 0 },
        },
      },
    })
    events.push({
      id: "evt_truncated_end",
      created: 0,
      type: "session.shell.ended",
      durable: durable("ses_1", 1),
      data: {
        sessionID: "ses_1",
        shell: {
          id: "sh_truncated",
          status: "exited",
          command: "long",
          cwd: "/tmp",
          shell: "/bin/sh",
          file: "/tmp/truncated",
          exit: 0,
          metadata: {},
          time: { started: 0, completed: 1 },
        },
        output: { output: "partial", cursor: 7, size: 20, truncated: false },
      },
    })
    await Bun.sleep(0)

    expect(ui.commits).toContainEqual(
      expect.objectContaining({ toolState: "error", toolError: "Shell exited with code 7" }),
    )
    expect(ui.commits).toContainEqual(expect.objectContaining({ text: "partial\n[output truncated]" }))
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
    let request: Parameters<OpenCodeClient["session"]["command"]>[0] | undefined
    spyOn(client.session, "command").mockImplementation((input) => {
      request = input
      queueMicrotask(() => {
        events.push({
          id: "evt_prompted",
          created: 0,
          type: "session.input.promoted",
          durable: durable("ses_1"),
          data: {
            sessionID: "ses_1",
            inputID: "msg_cmd",
          },
        })
        events.push({
          id: "evt_settled",
          created: 0,
          type: "session.execution.succeeded",
          durable: durable("ses_1"),
          data: { sessionID: "ses_1" },
        })
      })
      return ok({
        admittedSeq: 1,
        id: input.id ?? "msg_cmd",
        sessionID: "ses_1",
        type: "user" as const,
        data: { text: "evaluated template" },
        delivery: "steer" as const,
        timeCreated: 2,
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
    expect(client.session.switchAgent).not.toHaveBeenCalled()
    expect(client.session.switchModel).not.toHaveBeenCalled()
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
    let request: Parameters<OpenCodeClient["session"]["skill"]>[0] | undefined
    const command = spyOn(client.session, "command")
    const prompt = spyOn(client.session, "prompt")
    spyOn(client.session, "skill").mockImplementation((input) => {
      request = input
      queueMicrotask(() => {
        events.push({
          id: "evt_skill",
          created: 0,
          type: "session.skill.activated",
          durable: durable("ses_1"),
          data: {
            sessionID: "ses_1",
            id: input.skill ?? "tigerstyle",
            name: input.skill ?? "tigerstyle",
            text: "skill instructions",
          },
        })
        events.push({
          id: "evt_settled",
          created: 0,
          type: "session.execution.succeeded",
          durable: durable("ses_1"),
          data: { sessionID: "ses_1" },
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
    spyOn(client.session, "skill").mockImplementation(() => {
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
      id: "evt_other",
      created: 0,
      type: "session.skill.activated",
      durable: durable("ses_1"),
      data: {
        sessionID: "ses_1",
        id: "other",
        name: "other",
        text: "other instructions",
      },
    })
    events.push({
      id: "evt_unrelated_settled",
      created: 0,
      type: "session.execution.succeeded",
      durable: durable("ses_1"),
      data: { sessionID: "ses_1" },
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
        id: "tigerstyle",
        name: "tigerstyle",
        text: "skill instructions",
      },
    })
    events.push({
      id: "evt_skill_settled",
      created: 0,
      type: "session.execution.succeeded",
      durable: durable("ses_1"),
      data: { sessionID: "ses_1" },
    })
    await turn

    expect(done).toBe(true)
    await transport.close()
  })

  test("refreshes catalogs on connection and location-scoped invalidations", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({ streams: [events] })
    const ui = footer()
    let refreshes = 0
    const transport = await createSessionTransport({
      sdk: client,
      directory: "/project",
      sessionID: "ses_1",
      thinking: false,
      limits: () => ({}),
      footer: ui.api,
      onCatalogRefresh: () => refreshes++,
    })
    expect(refreshes).toBe(1)

    for (const type of [
      "catalog.updated",
      "integration.updated",
      "agent.updated",
      "command.updated",
      "skill.updated",
      "reference.updated",
    ] as const)
      events.push({ id: `evt_${type}`, created: 0, type, location: { directory: "/project" }, data: {} })
    events.push({
      id: "evt_foreign_catalog",
      created: 0,
      type: "catalog.updated",
      location: { directory: "/other" },
      data: {},
    })
    while (refreshes < 7) await Bun.sleep(0)
    await Bun.sleep(0)

    expect(refreshes).toBe(7)
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
            skill: "tigerstyle",
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
        id: "tigerstyle",
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
    spyOn(client.session, "get").mockImplementation(
      () =>
        ok({
          id: "ses_child",
          parentID: "ses_1",
          projectID: "proj_1",
          agent: "explore",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
          title: "Find files",
          location: { directory: "/tmp" },
        }) as never,
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
        ordinal: 0,
        delta: "child answer",
      },
    })
    while (!states().some((state) => state.details.ses_child?.commits.some((item) => item.text === "child answer")))
      await Bun.sleep(0)

    events.push({
      id: "evt_child_settled",
      created: 0,
      type: "session.execution.succeeded",
      durable: durable("ses_child"),
      data: { sessionID: "ses_child" },
    })
    while (!states().some((state) => state.tabs.some((tab) => tab.status === "completed"))) await Bun.sleep(0)
    await transport.close()
  })

  test("reveals an admitted child prompt only when it is promoted after hydration", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({
      streams: [events],
      messages: { ses_child: [] },
      sessions: [{ id: "ses_child", parentID: "ses_1", time: { updated: 1 } }],
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
    transport.selectSubagent("ses_child")
    while (!states().some((state) => state.details.ses_child)) await Bun.sleep(0)

    events.push({
      id: "evt_child_admitted",
      created: 1,
      type: "session.input.admitted",
      durable: durable("ses_child"),
      data: {
        sessionID: "ses_child",
        inputID: "msg_child_prompt",
        input: { type: "user", data: { text: "actual child prompt" }, delivery: "steer" },
      },
    })
    await Bun.sleep(0)
    expect(
      states()
        .at(-1)
        ?.details.ses_child?.commits.some((item) => item.messageID === "msg_child_prompt"),
    ).toBe(false)

    events.push({
      id: "evt_child_promoted",
      created: 2,
      type: "session.input.promoted",
      durable: durable("ses_child", 1),
      data: { sessionID: "ses_child", inputID: "msg_child_prompt" },
    })
    while (
      !states()
        .at(-1)
        ?.details.ses_child?.commits.some(
          (item) => item.messageID === "msg_child_prompt" && item.text === "actual child prompt",
        )
    )
      await Bun.sleep(0)

    await transport.close()
  })

  test("preserves a pre-hydration admission promoted during stale hydration", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({
      streams: [events],
      sessions: [{ id: "ses_child", parentID: "ses_1", time: { updated: 1 } }],
    })
    let childHydrating = false
    let releaseHydration!: () => void
    const hydration = new Promise<void>((resolve) => {
      releaseHydration = resolve
    })
    spyOn(client.message, "list").mockImplementation(async (request) => {
      if (request.sessionID === "ses_child") {
        childHydrating = true
        await hydration
      }
      return ok({ data: [], cursor: {} })
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
    events.push({
      id: "evt_child_admitted_race",
      created: 1,
      type: "session.input.admitted",
      durable: durable("ses_child"),
      data: {
        sessionID: "ses_child",
        inputID: "msg_child_race",
        input: { type: "user", data: { text: "prompt admitted before hydration" }, delivery: "steer" },
      },
    })
    await Bun.sleep(0)
    transport.selectSubagent("ses_child")
    while (!childHydrating) await Bun.sleep(0)
    events.push({
      id: "evt_child_promoted_race",
      created: 2,
      type: "session.input.promoted",
      durable: durable("ses_child", 1),
      data: { sessionID: "ses_child", inputID: "msg_child_race" },
    })
    await Bun.sleep(0)
    releaseHydration()
    await Bun.sleep(0)
    await Bun.sleep(0)
    while (
      !states()
        .at(-1)
        ?.details.ses_child?.commits.some(
          (item) => item.messageID === "msg_child_race" && item.text === "prompt admitted before hydration",
        )
    )
      await Bun.sleep(0)

    await transport.close()
  })

  test("retries child hydration after a bounded live-event overflow", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({
      streams: [events],
      sessions: [{ id: "ses_child", parentID: "ses_1", time: { updated: 1 } }],
    })
    let childRequests = 0
    let releaseStale!: () => void
    let releaseRetry!: () => void
    const stale = new Promise<void>((resolve) => {
      releaseStale = resolve
    })
    const retry = new Promise<void>((resolve) => {
      releaseRetry = resolve
    })
    spyOn(client.message, "list").mockImplementation(async (request) => {
      if (request.sessionID !== "ses_child") return ok({ data: [], cursor: {} })
      childRequests++
      if (childRequests === 1) {
        await stale
        return ok({ data: [], cursor: {} })
      }
      await retry
      return ok({
        data: [
          {
            id: "msg_overflow_assistant",
            type: "assistant" as const,
            agent: "explore",
            model: { providerID: "test", id: "model" },
            content: [{ type: "text" as const, id: "txt_overflow_64", text: "live 64" }],
            time: { created: 2, completed: 3 },
          },
          {
            id: "msg_overflow_baseline",
            type: "user" as const,
            text: "baseline history",
            files: [],
            agents: [],
            time: { created: 1 },
          },
        ],
        cursor: {},
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
    transport.selectSubagent("ses_child")
    while (childRequests < 1) await Bun.sleep(0)

    for (let index = 0; index < 65; index++)
      events.push({
        id: `evt_overflow_${index}`,
        created: index,
        type: "session.text.delta",
        data: {
          sessionID: "ses_child",
          assistantMessageID: "msg_overflow_assistant",
          ordinal: index,
          delta: `live ${index}`,
        },
      })
    while (
      !states()
        .at(-1)
        ?.details.ses_child?.commits.some((item) => item.text === "live 64")
    )
      await Bun.sleep(0)
    releaseStale()
    while (childRequests < 2) await Bun.sleep(0)
    expect(
      states()
        .at(-1)
        ?.details.ses_child?.commits.some((item) => item.text === "live 64"),
    ).toBe(true)

    releaseRetry()
    while (
      !states()
        .at(-1)
        ?.details.ses_child?.commits.some((item) => item.text === "baseline history")
    )
      await Bun.sleep(0)
    expect(
      states()
        .at(-1)
        ?.details.ses_child?.commits.some((item) => item.text === "live 64"),
    ).toBe(true)
    expect(childRequests).toBe(2)
    await transport.close()
  })

  test("reconciles pre-hydration tool metadata without downgrading projected completion", async () => {
    const events = feed()
    events.push(connected())
    const client = sdk({
      streams: [events],
      sessions: [{ id: "ses_child", parentID: "ses_1", time: { updated: 1 } }],
    })
    let childHydrating = false
    let releaseHydration!: () => void
    const hydration = new Promise<void>((resolve) => {
      releaseHydration = resolve
    })
    spyOn(client.message, "list").mockImplementation(async (request) => {
      if (request.sessionID !== "ses_child") return ok({ data: [], cursor: {} })
      childHydrating = true
      await hydration
      return ok({
        data: [
          {
            id: "msg_tool_projected",
            type: "assistant" as const,
            agent: "explore",
            model: { providerID: "test", id: "model" },
            content: [
              {
                type: "tool" as const,
                id: "call_overlap",
                name: "bash",
                state: {
                  status: "completed" as const,
                  input: { command: "projected" },
                  content: [{ type: "text" as const, text: "projected result" }],
                  structured: {},
                },
                time: { created: 1, ran: 1, completed: 2 },
              },
            ],
            time: { created: 1, completed: 2 },
          },
        ],
        cursor: {},
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
    const inputStarted = (callID: string, name: string, seq: number) =>
      events.push({
        id: `evt_started_${callID}`,
        created: seq,
        type: "session.tool.input.started",
        durable: durable("ses_child", seq),
        data: { sessionID: "ses_child", assistantMessageID: "msg_tool_projected", callID, name },
      })
    const called = (callID: string, input: Record<string, unknown>, seq: number) =>
      events.push({
        id: `evt_called_${callID}`,
        created: seq,
        type: "session.tool.called",
        durable: durable("ses_child", seq),
        data: {
          sessionID: "ses_child",
          assistantMessageID: "msg_tool_projected",
          callID,
          input,
          executed: true,
        },
      })

    inputStarted("call_terminal", "grep", 0)
    called("call_terminal", { pattern: "needle" }, 1)
    await Bun.sleep(0)
    transport.selectSubagent("ses_child")
    while (!childHydrating) await Bun.sleep(0)
    events.push({
      id: "evt_success_terminal",
      created: 2,
      type: "session.tool.success",
      durable: durable("ses_child", 2),
      data: {
        sessionID: "ses_child",
        assistantMessageID: "msg_tool_projected",
        callID: "call_terminal",
        structured: {},
        content: [{ type: "text", text: "found" }],
        executed: true,
      },
    })
    inputStarted("call_overlap", "bash", 3)
    called("call_overlap", { command: "stale" }, 4)
    await Bun.sleep(0)
    const beforeHydration = states().length
    releaseHydration()
    while (states().length === beforeHydration) await Bun.sleep(0)
    await Bun.sleep(0)

    const commits = states().at(-1)?.details.ses_child?.commits ?? []
    expect(commits.find((item) => item.partID === "prt_call_terminal")).toMatchObject({
      tool: "grep",
      toolState: "completed",
      part: { state: { input: { pattern: "needle" } } },
    })
    expect(commits.find((item) => item.partID === "prt_call_overlap")).toMatchObject({
      tool: "bash",
      toolState: "completed",
      part: { state: { input: { command: "projected" } } },
    })
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
    spyOn(client.session, "get").mockImplementation(async () => {
      await gate
      return ok({
        id: "ses_child",
        parentID: "ses_1",
        projectID: "proj_1",
        agent: "explore",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 1 },
        title: "Find files",
        location: { directory: "/tmp" },
      }) as never
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
      type: "session.execution.interrupted",
      durable: durable("ses_child"),
      data: { sessionID: "ses_child", reason: "user" },
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
    spyOn(client.session, "get").mockImplementation(async () => {
      await gate
      return ok({
        id: "ses_child",
        parentID: "ses_1",
        projectID: "proj_1",
        agent: "explore",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 1 },
        title: "Find files",
        location: { directory: "/tmp" },
      }) as never
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
      id: "evt_parent_input",
      created: 0,
      type: "session.tool.input.started",
      durable: durable("ses_1"),
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_parent_a",
        callID: "call_sub",
        name: "subagent",
      },
    })
    events.push({
      id: "evt_parent_call",
      created: 0,
      type: "session.tool.called",
      durable: durable("ses_1"),
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_parent_a",
        callID: "call_sub",
        input: { agent: "explore", description: "Find things", prompt: "go", background: true },
        executed: true,
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
        executed: true,
      },
    })
    // The settled event arrives after adoption, so it applies directly.
    events.push({
      id: "evt_child_settled",
      created: 0,
      type: "session.execution.interrupted",
      durable: durable("ses_child"),
      data: { sessionID: "ses_child", reason: "shutdown" },
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
    expect(client.session.list).toHaveBeenCalledWith({ parentID: "ses_1", limit: 100, order: "desc" })
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
