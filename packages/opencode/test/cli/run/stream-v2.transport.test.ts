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
  spyOn(client.config, "get").mockImplementation(() => ok({}))
  spyOn(client.v2.model, "list").mockImplementation(() =>
    ok({
      location: {
        directory: "/tmp",
        project: {
          id: "proj_1",
          directory: "/tmp",
        },
      },
      data: [],
    }),
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

  test("inlines local text files and directories before current prompt admission", async () => {
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
    let request:
      | Parameters<OpencodeClient["v2"]["session"]["prompt"]>[0]
      | undefined
    // The generated method has conditional return types for throwOnError; this mock represents the successful branch.
    // @ts-expect-error successful SDK response is valid for both modes at runtime
    spyOn(client.v2.session, "prompt").mockImplementation((input) => {
      request = input
      queueMicrotask(() => {
        events.push({
          id: "evt_prompted",
          type: "session.next.prompted",
          data: {
            timestamp: 2,
            sessionID: "ses_1",
            messageID: "msg_prompt",
            prompt: { text: input.prompt?.text ?? "" },
            delivery: "steer",
          },
        })
        events.push({
          id: "evt_settled",
          type: "session.next.execution.settled",
          data: { timestamp: 3, sessionID: "ses_1", outcome: "success" },
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

    expect(request?.prompt?.text).toContain("Review @note.ts and @docs")
    expect(request?.prompt?.text).toContain(
      `Called the Read tool with the following input: ${JSON.stringify({ filePath: filePath })}`,
    )
    expect(request?.prompt?.text).toContain("1: export const answer = 42")
    expect(request?.prompt?.text).toContain("<type>directory</type>")
    expect(request?.prompt?.text).toContain("README.md")
    expect(request?.prompt?.files).toBeUndefined()
    await transport.close()
  })

  test("converts local media mentions into data URL attachments before current prompt admission", async () => {
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
    let request:
      | Parameters<OpencodeClient["v2"]["session"]["prompt"]>[0]
      | undefined
    // The generated method has conditional return types for throwOnError; this mock represents the successful branch.
    // @ts-expect-error successful SDK response is valid for both modes at runtime
    spyOn(client.v2.session, "prompt").mockImplementation((input) => {
      request = input
      queueMicrotask(() => {
        events.push({
          id: "evt_prompted",
          type: "session.next.prompted",
          data: {
            timestamp: 2,
            sessionID: "ses_1",
            messageID: "msg_prompt",
            prompt: { text: input.prompt?.text ?? "" },
            delivery: "steer",
          },
        })
        events.push({
          id: "evt_settled",
          type: "session.next.execution.settled",
          data: { timestamp: 3, sessionID: "ses_1", outcome: "success" },
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

    expect(request?.prompt?.text).toContain(
      `Called the Read tool with the following input: ${JSON.stringify({ filePath: filePath })}`,
    )
    expect(request?.prompt?.files).toEqual([
      expect.objectContaining({
        name: "diagram.png",
        uri: expect.stringMatching(/^data:image\/png;base64,/),
      }),
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
      return ok({ data: { admittedSeq: 1, id: messageID, sessionID: "ses_1", prompt, delivery: "steer" as const, timeCreated: 2 } })
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
      type: "session.next.execution.settled",
      data: { timestamp: 3, sessionID: "ses_1", outcome: "interrupted" },
    })
    await turn

    expect(interrupted).toHaveBeenCalledWith({ sessionID: "ses_1" })
    await transport.close()
  })

  test("falls back to the configured model when selecting a variant on a fresh session", async () => {
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
    spyOn(client.config, "get").mockImplementation(() => ok({ model: "openai/gpt-5" }))
    const switched = spyOn(client.v2.session, "switchModel").mockImplementation(() => ok(undefined))
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
      variant: "high",
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
      id: "evt_settled",
      type: "session.next.execution.settled",
      data: { timestamp: 3, sessionID: "ses_1", outcome: "success" },
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
