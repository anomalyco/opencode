import { describe, expect, it } from "bun:test"
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import type { Event, OpencodeClient, Session } from "@opencode-ai/sdk/v2"
import { ACP } from "@/acp/agent"
import { Subagent } from "@/acp/subagent"

type Message = {
  readonly jsonrpc: "2.0"
  readonly id?: number
  readonly method?: string
  readonly result?: unknown
  readonly error?: {
    readonly code: number
  }
  readonly params?: unknown
}

describe("ACP agent connection", () => {
  it("closes subagent extension attachments with the connection", async () => {
    await using harness = makeHarness()
    await harness.events.started.promise

    await harness.send({
      jsonrpc: "2.0",
      id: 1,
      method: "_opencode/subagents/subscribe",
      params: {},
    })
    const subscribed = await harness.output.next()
    expect(Subagent.decodeSnapshot(subscribed.result).nodes.map((node) => node.sessionId)).toEqual(["root"])

    const reads = harness.listReads()
    const writes = harness.output.count()
    await harness.close()
    await harness.connection.closed

    expect(harness.events.signal()?.aborted).toBe(true)
    await harness.events.released.promise
    await harness.events.emit(sessionStatus("root", { type: "busy" }))

    expect(harness.listReads()).toBe(reads)
    expect(harness.output.count()).toBe(writes)
  })

  it("preserves JSON-RPC error classes at the custom-method boundary", async () => {
    await using harness = makeHarness()
    await harness.events.started.promise

    await harness.send({
      jsonrpc: "2.0",
      id: 1,
      method: "_opencode/subagents/list",
      params: { rootSessionId: 42 },
    })
    expect((await harness.output.next()).error?.code).toBe(-32602)

    await harness.send({
      jsonrpc: "2.0",
      id: 2,
      method: "_opencode/subagents/missing",
      params: {},
    })
    expect((await harness.output.next()).error?.code).toBe(-32601)

    harness.failList()
    await harness.send({
      jsonrpc: "2.0",
      id: 3,
      method: "_opencode/subagents/list",
      params: {},
    })
    expect((await harness.output.next()).error?.code).toBe(-32603)
  })

  it("writes the subscribe response before a buffered revision-1 update", async () => {
    const snapshotStarted = Promise.withResolvers<void>()
    const releaseSnapshot = Promise.withResolvers<void>()
    await using harness = makeHarness({
      holdFirstRootRead: {
        started: snapshotStarted,
        release: releaseSnapshot.promise,
      },
    })
    await harness.events.started.promise

    await harness.send({
      jsonrpc: "2.0",
      id: 1,
      method: "_opencode/subagents/subscribe",
      params: { rootSessionId: "root" },
    })
    await snapshotStarted.promise
    await harness.events.emit(
      sessionChanged(
        "session.created",
        session({
          id: "child",
          parentID: "root",
          directory: "/workspace/child",
          created: 2,
          updated: 2,
        }),
      ),
    )
    releaseSnapshot.resolve()

    const response = await harness.output.next()
    const update = await harness.output.next()
    expect(response).toMatchObject({ jsonrpc: "2.0", id: 1 })
    Subagent.decodeSnapshot(response.result)
    expect(update).toMatchObject({
      jsonrpc: "2.0",
      method: "_opencode/subagents/update",
    })
    expect(Subagent.decodeUpdate(update.params)).toMatchObject({
      revision: 1,
      upsert: [{ sessionId: "child", parentSessionId: "root" }],
    })
  })
})

function makeHarness(options?: {
  holdFirstRootRead?: {
    started: PromiseWithResolvers<void>
    release: Promise<void>
  }
}) {
  const events = eventSource()
  const output = outputCollector()
  const input = new TransformStream<Uint8Array, Uint8Array>()
  const writer = input.writable.getWriter()
  const root = session({ id: "root", directory: "/workspace/root", created: 1, updated: 1 })
  let listReads = 0
  let getReads = 0
  let listFailure = false
  let inputClosed = false
  const sdk = {
    global: {
      event: (request?: { signal?: AbortSignal }) => {
        events.capture(request?.signal)
        return Promise.resolve({ stream: events.stream(request?.signal) })
      },
    },
    session: {
      list: async () => {
        listReads += 1
        if (listFailure) throw new Error("list failed")
        if (listReads === 1 && options?.holdFirstRootRead) {
          options.holdFirstRootRead.started.resolve()
          await options.holdFirstRootRead.release
        }
        return { data: [root] }
      },
      get: async () => {
        getReads += 1
        if (getReads === 1 && options?.holdFirstRootRead) {
          options.holdFirstRootRead.started.resolve()
          await options.holdFirstRootRead.release
        }
        return { data: root }
      },
      children: () => Promise.resolve({ data: [] }),
      status: () => Promise.resolve({ data: { root: { type: "idle" as const } } }),
    },
  } as unknown as OpencodeClient
  const connection = new AgentSideConnection(ACP.init({ sdk }).create, ndJsonStream(output.writable, input.readable))
  const close = async () => {
    if (inputClosed) return
    inputClosed = true
    await writer.close()
  }

  return {
    connection,
    events,
    output,
    send: (message: Message) => writer.write(new TextEncoder().encode(`${JSON.stringify(message)}\n`)),
    close,
    failList: () => {
      listFailure = true
    },
    listReads: () => listReads,
    [Symbol.asyncDispose]: async () => {
      await close()
      await connection.closed
    },
  }
}

function outputCollector() {
  const decoder = new TextDecoder()
  const queued: Message[] = []
  const waiters: Array<(message: Message) => void> = []
  let content = ""
  let count = 0

  const push = (message: Message) => {
    count += 1
    const waiter = waiters.shift()
    if (waiter) {
      waiter(message)
      return
    }
    queued.push(message)
  }

  return {
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        content += decoder.decode(chunk, { stream: true })
        const lines = content.split("\n")
        content = lines.pop() ?? ""
        lines
          .map((line) => line.trim())
          .filter(Boolean)
          .forEach((line) => push(JSON.parse(line)))
      },
    }),
    next: () => {
      const message = queued.shift()
      if (message) return Promise.resolve(message)
      return new Promise<Message>((resolve) => waiters.push(resolve))
    },
    count: () => count,
  }
}

function eventSource() {
  type Envelope = {
    readonly payload: Event
    readonly delivered: PromiseWithResolvers<void>
  }
  const queued: Envelope[] = []
  const waiters: Array<(envelope: Envelope | undefined) => void> = []
  const started = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  let signal: AbortSignal | undefined
  let done = false

  const stream = async function* (abort?: AbortSignal) {
    started.resolve()
    try {
      while (!abort?.aborted) {
        const queuedEvent = queued.shift()
        const next =
          queuedEvent ??
          (await new Promise<Envelope | undefined>((resolve) => {
            waiters.push(resolve)
            abort?.addEventListener("abort", () => resolve(undefined), { once: true })
          }))
        if (!next) return
        yield { payload: next.payload }
        next.delivered.resolve()
      }
    } finally {
      done = true
      released.resolve()
    }
  }

  return {
    started,
    released,
    stream,
    capture: (value?: AbortSignal) => {
      signal = value
    },
    signal: () => signal,
    emit: (event: Event) => {
      if (done) return Promise.resolve()
      const envelope = { payload: event, delivered: Promise.withResolvers<void>() }
      const waiter = waiters.shift()
      if (waiter) waiter(envelope)
      else queued.push(envelope)
      return envelope.delivered.promise
    },
  }
}

function session(input: {
  id: string
  directory: string
  created: number
  updated: number
  parentID?: string
}): Session {
  return {
    id: input.id,
    slug: input.id,
    projectID: "project",
    directory: input.directory,
    ...(input.parentID ? { parentID: input.parentID } : {}),
    title: input.id,
    agent: "build",
    version: "1",
    time: { created: input.created, updated: input.updated },
  }
}

function sessionChanged(type: "session.created" | "session.updated", info: Session): Event {
  return {
    id: `event-${type}-${info.id}`,
    type,
    properties: { sessionID: info.id, info },
  }
}

function sessionStatus(sessionID: string, status: { type: "busy" | "idle" }): Event {
  return {
    id: `event-status-${sessionID}`,
    type: "session.status",
    properties: { sessionID, status },
  }
}
