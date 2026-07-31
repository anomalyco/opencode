import { describe, expect, it } from "bun:test"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { Event, Message, OpencodeClient, Part, SessionMessageResponse, ToolPart } from "@opencode-ai/sdk/v2"
import { Effect, ManagedRuntime } from "effect"
import { ACPEvent } from "@/acp/event"
import * as ACPService from "@/acp/service"
import { Directory } from "@/acp/directory"
import { ACPSession } from "@/acp/session"

type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]
type ToolSessionUpdateParams = SessionUpdateParams & {
  update: Extract<SessionUpdateParams["update"], { sessionUpdate: "tool_call" | "tool_call_update" }>
}
type GlobalEventEnvelope = {
  payload?: Event
}
type DeltaPartType = Extract<Part, { type: "text" | "reasoning" }>["type"]

const pollUntil = async (
  check: () => boolean | Promise<boolean>,
  message: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
) => {
  const started = Date.now()
  while (true) {
    if (await check()) return
    if (Date.now() - started > (opts?.timeoutMs ?? 2000)) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, opts?.intervalMs ?? 5))
  }
}

function makeSessionService() {
  return ManagedRuntime.make(LayerNode.compile(ACPSession.node)).runSync(
    ACPSession.Service.use((service) => Effect.succeed(service)),
  )
}

function createEventStream() {
  const queue: GlobalEventEnvelope[] = []
  const waiters: Array<(value: GlobalEventEnvelope | undefined) => void> = []
  const listeners = new Set<(event: Event) => void>()
  const state = { closed: false }
  const ready = Promise.withResolvers<void>()
  let opened = false

  const push = (event: GlobalEventEnvelope) => {
    if (event.payload) {
      for (const listener of listeners) listener(event.payload)
    }
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
    if (!opened) {
      opened = true
      ready.resolve()
    }
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
        signal?.addEventListener("abort", () => resolve(undefined), { once: true })
      })
      if (!value) return
      yield value
    }
  }

  const subscribe = (listener: (event: Event) => void) => {
    listeners.add(listener)
    ready.resolve()
    return () => listeners.delete(listener)
  }

  return { push, close, ready: ready.promise, stream, subscribe }
}

function createHarness(
  messages: Record<string, SessionMessageResponse> = {},
  onSessionUpdate?: (params: SessionUpdateParams) => void | Promise<void>,
  beforeReplayBarrier?: () => void,
  afterReplayBarrier?: () => void,
) {
  const updates: SessionUpdateParams[] = []
  const calls = {
    eventSubscribe: 0,
    message: 0,
  }
  const events = createEventStream()
  const sdk = {
    global: {
      event: (options?: { signal?: AbortSignal }) => {
        calls.eventSubscribe++
        return Promise.resolve({ stream: events.stream(options?.signal) })
      },
    },
    session: {
      message: (input: { messageID: string }) => {
        calls.message++
        return Promise.resolve({ data: messages[input.messageID] })
      },
      get: () => Promise.resolve({ data: { id: "ses_loaded" } }),
      messages: () => Promise.resolve({ data: [] }),
    },
  } as unknown as OpencodeClient
  const connection = {
    sessionUpdate: (params: SessionUpdateParams) => {
      updates.push(params)
      return Promise.resolve(onSessionUpdate?.(params)).then(() => undefined)
    },
  } satisfies Pick<AgentSideConnection, "sessionUpdate">
  const session = makeSessionService()
  const subscription = new ACPEvent.Subscription({
    sdk,
    connection,
    session,
    publishBarrier: (event) => {
      beforeReplayBarrier?.()
      events.push({ payload: event })
      afterReplayBarrier?.()
    },
    subscribeEvents: (listener) => {
      calls.eventSubscribe++
      return events.subscribe(listener)
    },
  })

  return { calls, connection, events, sdk, session, subscription, updates }
}

function textDelta(sessionID: string, messageID: string, partID: string, delta: string): Event {
  return {
    id: `evt_${sessionID}_${messageID}_${partID}_${delta}`,
    type: "message.part.delta",
    properties: {
      sessionID,
      messageID,
      partID,
      field: "text",
      delta,
    },
  }
}

function partUpdated(sessionID: string, messageID: string, partID: string, type: DeltaPartType): Event {
  return {
    id: `evt_${sessionID}_${messageID}_${partID}`,
    type: "message.part.updated",
    properties: {
      sessionID,
      time: Date.now(),
      part:
        type === "text"
          ? {
              id: partID,
              sessionID,
              messageID,
              type: "text",
              text: "",
            }
          : {
              id: partID,
              sessionID,
              messageID,
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
            },
    },
  }
}

function toolUpdated(part: ToolPart): Event {
  return {
    id: `evt_${part.sessionID}_${part.messageID}_${part.id}_${part.state.status}`,
    type: "message.part.updated",
    properties: {
      sessionID: part.sessionID,
      time: Date.now(),
      part,
    },
  }
}

function assistantMessage(sessionID: string, messageID: string, partID: string, type: DeltaPartType) {
  return {
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      time: { created: Date.now() },
      parentID: "msg_parent",
      modelID: "model",
      providerID: "provider",
      mode: "build",
      agent: "build",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      type === "text"
        ? {
            id: partID,
            sessionID,
            messageID,
            type: "text",
            text: "",
          }
        : {
            id: partID,
            sessionID,
            messageID,
            type: "reasoning",
            text: "",
            time: { start: Date.now() },
          },
    ],
  } satisfies SessionMessageResponse
}

function assistantToolMessage(part: ToolPart) {
  return {
    info: {
      id: part.messageID,
      sessionID: part.sessionID,
      role: "assistant",
      time: { created: Date.now() },
      parentID: "msg_parent",
      modelID: "model",
      providerID: "provider",
      mode: "build",
      agent: "build",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [part],
  } satisfies SessionMessageResponse
}

function runningTool(
  sessionID: string,
  callID: string,
  output?: string,
  input: Record<string, unknown> = { cmd: "printf hello" },
) {
  return {
    id: `part_${callID}`,
    sessionID,
    messageID: `msg_${callID}`,
    type: "tool",
    callID,
    tool: "bash",
    state: {
      status: "running",
      input,
      title: "bash",
      ...(output !== undefined ? { metadata: { output } } : {}),
      time: { start: Date.now() },
    },
  } satisfies ToolPart
}

function completedTool(
  sessionID: string,
  callID: string,
  output = "done",
  attachments: Extract<ToolPart["state"], { status: "completed" }>["attachments"] = [],
  options: {
    readonly tool?: string
    readonly input?: Record<string, unknown>
    readonly metadata?: Record<string, unknown>
  } = {},
) {
  return {
    id: `part_${callID}`,
    sessionID,
    messageID: `msg_${callID}`,
    type: "tool",
    callID,
    tool: options.tool ?? "bash",
    state: {
      status: "completed",
      input: options.input ?? { cmd: "printf done" },
      output,
      title: "bash",
      metadata: options.metadata ?? { exit: 0 },
      time: { start: Date.now() - 1, end: Date.now() },
      ...(attachments.length ? { attachments } : {}),
    },
  } satisfies ToolPart
}

function errorTool(sessionID: string, callID: string) {
  return {
    id: `part_${callID}`,
    sessionID,
    messageID: `msg_${callID}`,
    type: "tool",
    callID,
    tool: "bash",
    state: {
      status: "error",
      input: { cmd: "exit 1" },
      error: "failed hard",
      metadata: { exit: 1 },
      time: { start: Date.now() - 1, end: Date.now() },
    },
  } satisfies ToolPart
}

function toolUpdates(updates: SessionUpdateParams[]) {
  return updates.filter((item): item is ToolSessionUpdateParams => {
    return item.update.sessionUpdate === "tool_call" || item.update.sessionUpdate === "tool_call_update"
  })
}

function textFromUpdates(updates: SessionUpdateParams[], sessionID: string) {
  return updates
    .filter((item) => item.sessionId === sessionID && item.update.sessionUpdate === "agent_message_chunk")
    .map((item) =>
      item.update.sessionUpdate === "agent_message_chunk" && item.update.content.type === "text"
        ? item.update.content.text
        : "",
    )
    .join("")
}

async function createKnownSession(
  session: ACPSession.Interface,
  sessionId: string,
  part: { messageId: string; partId: string; partType: Part["type"]; role?: Message["role"] },
) {
  await Effect.runPromise(session.create({ id: sessionId, cwd: "/workspace" }))
  await Effect.runPromise(
    session.recordPartMetadata({
      sessionId,
      messageId: part.messageId,
      partId: part.partId,
      partType: part.partType,
      role: part.role ?? "assistant",
    }),
  )
}

describe("acp event routing", () => {
  it("delivers transcript and isolated listeners from the single global stream", async () => {
    const harness = createHarness()
    await createKnownSession(harness.session, "ses_listener", {
      messageId: "msg_listener",
      partId: "part_listener",
      partType: "text",
    })
    const received = Promise.withResolvers<Event>()

    harness.subscription.addListener(async () => {
      throw new Error("listener failed")
    })
    harness.subscription.addListener(async (event) => {
      received.resolve(event)
    })
    harness.subscription.start()
    await harness.events.ready

    const event = textDelta("ses_listener", "msg_listener", "part_listener", "hello")
    harness.events.push({ payload: event })

    expect(await received.promise).toEqual(event)
    expect(harness.updates).toEqual([
      {
        sessionId: "ses_listener",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg_listener",
          content: { type: "text", text: "hello" },
        },
      },
    ])
    expect(harness.calls.eventSubscribe).toBe(1)

    harness.subscription.stop()
    harness.events.close()
  })

  it("routes message.part.delta by sessionID without cross-session pollution", async () => {
    const harness = createHarness()
    await createKnownSession(harness.session, "ses_a", { messageId: "msg_a", partId: "part_a", partType: "text" })
    await createKnownSession(harness.session, "ses_b", { messageId: "msg_b", partId: "part_b", partType: "text" })

    await harness.subscription.handle(textDelta("ses_b", "msg_b", "part_b", "hello"))

    expect(harness.updates.map((update) => update.sessionId)).toEqual(["ses_b"])
    expect(harness.updates[0]?.update.sessionUpdate).toBe("agent_message_chunk")
  })

  it("keeps interleaved sessions isolated for text and reasoning deltas", async () => {
    const harness = createHarness()
    await createKnownSession(harness.session, "ses_a", { messageId: "msg_a", partId: "part_a", partType: "text" })
    await createKnownSession(harness.session, "ses_b", {
      messageId: "msg_b",
      partId: "part_b",
      partType: "reasoning",
    })

    await harness.subscription.handle(textDelta("ses_a", "msg_a", "part_a", "A1"))
    await harness.subscription.handle(textDelta("ses_b", "msg_b", "part_b", "B1"))
    await harness.subscription.handle(textDelta("ses_a", "msg_a", "part_a", "A2"))
    await harness.subscription.handle(textDelta("ses_b", "msg_b", "part_b", "B2"))

    expect(
      harness.updates.filter((update) => update.sessionId === "ses_a").map((update) => update.update.sessionUpdate),
    ).toEqual(["agent_message_chunk", "agent_message_chunk"])
    expect(
      harness.updates.filter((update) => update.sessionId === "ses_b").map((update) => update.update.sessionUpdate),
    ).toEqual(["agent_thought_chunk", "agent_thought_chunk"])
  })

  it("does not create extra subscriptions on repeated loadSession", async () => {
    const harness = createHarness()
    let subscription: ACPEvent.Subscription | undefined
    const service = ACPService.make({
      sdk: harness.sdk,
      connection: harness.connection,
      directory: {
        get: () =>
          Effect.succeed(
            Directory.build({
              directory: "/workspace",
              providers: {},
              modes: [],
              defaultModeID: "build",
              commands: [],
            }),
          ),
        refresh: () =>
          Effect.succeed(
            Directory.build({
              directory: "/workspace",
              providers: {},
              modes: [],
              defaultModeID: "build",
              commands: [],
            }),
          ),
        variants: Directory.variants,
      },
      session: harness.session,
      eventBarrierPublisher: (event) => harness.events.push({ payload: event }),
      eventSubscriber: (listener) => {
        harness.calls.eventSubscribe++
        return harness.events.subscribe(listener)
      },
      eventSubscription: (started) => {
        subscription = started
      },
    })

    await pollUntil(() => harness.calls.eventSubscribe === 1, "event subscription did not start")
    await Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }))
    await Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }))
    await Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }))

    expect(harness.calls.eventSubscribe).toBe(1)
    subscription?.stop()
    harness.events.close()
  })

  it("does not call sdk.session.message repeatedly when metadata is known", async () => {
    const harness = createHarness()
    await createKnownSession(harness.session, "ses_a", { messageId: "msg_a", partId: "part_a", partType: "text" })

    for (const delta of ["a", "b", "c", "d", "e"]) {
      await harness.subscription.handle(textDelta("ses_a", "msg_a", "part_a", delta))
    }

    expect(harness.calls.message).toBe(0)
    expect(harness.updates).toHaveLength(5)
  })

  it("fetches unknown part metadata once and reuses it for later deltas", async () => {
    const harness = createHarness({
      msg_a: assistantMessage("ses_a", "msg_a", "part_a", "text"),
    })
    await Effect.runPromise(harness.session.create({ id: "ses_a", cwd: "/workspace" }))

    await harness.subscription.handle(partUpdated("ses_a", "msg_a", "part_a", "text"))
    await harness.subscription.handle(textDelta("ses_a", "msg_a", "part_a", "a"))
    await harness.subscription.handle(textDelta("ses_a", "msg_a", "part_a", "b"))

    expect(harness.calls.message).toBe(1)
    expect(harness.updates).toHaveLength(2)
  })

  it("rolls back a failed replay delivery and recovers its unattached journal on retry", async () => {
    const events = createEventStream()
    const updates: SessionUpdateParams[] = []
    const baseline = assistantMessage("ses_loaded", "msg_recovery", "part_recovery", "text")
    const baselinePart = baseline.parts[0]
    if (baselinePart?.type === "text") baselinePart.text = "baseline"
    let failReplay = true
    const connection = {
      sessionUpdate: (params: SessionUpdateParams) => {
        if (failReplay) {
          failReplay = false
          return Promise.reject(new Error("replay send failed"))
        }

        updates.push(params)
        return Promise.resolve()
      },
    } satisfies Pick<AgentSideConnection, "sessionUpdate">
    let subscription: ACPEvent.Subscription | undefined
    const service = ACPService.make({
      sdk: {
        global: {
          event: (options?: { signal?: AbortSignal }) => Promise.resolve({ stream: events.stream(options?.signal) }),
        },
        session: {
          get: () => Promise.resolve({ data: { id: "ses_loaded" } }),
          messages: () => Promise.resolve({ data: [baseline] }),
        },
      } as unknown as OpencodeClient,
      connection,
      directory: {
        get: () =>
          Effect.succeed(
            Directory.build({
              directory: "/workspace",
              providers: {},
              modes: [],
              defaultModeID: "build",
              commands: [],
            }),
          ),
        refresh: () =>
          Effect.succeed(
            Directory.build({
              directory: "/workspace",
              providers: {},
              modes: [],
              defaultModeID: "build",
              commands: [],
            }),
          ),
        variants: Directory.variants,
      },
      eventBarrierPublisher: (event) => events.push({ payload: event }),
      eventSubscriber: events.subscribe,
      eventSubscription: (started) => {
        subscription = started
      },
    })

    const earlyHandled = Promise.withResolvers<void>()
    subscription?.addListener(async (event) => {
      if (event.id === "evt_ses_loaded_msg_recovery_part_recovery_early") earlyHandled.resolve()
    })
    events.push({ payload: textDelta("ses_loaded", "msg_recovery", "part_recovery", "early") })
    await earlyHandled.promise

    await expect(
      Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] })),
    ).rejects.toMatchObject({
      _tag: "ACPServiceFailureError",
      safeMessage: "Unable to replay session messages",
    })

    await Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }))

    expect(textFromUpdates(updates, "ses_loaded")).toBe("baselineearly")
    subscription?.stop()
    events.close()
  })

  it("reconciles a fully drained unattached delta with a delta received during fenced load", async () => {
    const harness = createHarness()
    const earlyHandled = Promise.withResolvers<void>()
    const fencedHandled = Promise.withResolvers<void>()
    harness.subscription.addListener(async (event) => {
      if (event.id === "evt_ses_unattached_msg_unattached_part_unattached_early") earlyHandled.resolve()
      if (event.id === "evt_ses_unattached_msg_unattached_part_unattached_fenced") fencedHandled.resolve()
    })
    harness.subscription.start()
    await harness.events.ready

    harness.events.push({ payload: textDelta("ses_unattached", "msg_unattached", "part_unattached", "early") })
    await earlyHandled.promise

    const replay = harness.subscription.beginReplay("ses_unattached")
    harness.events.push({ payload: textDelta("ses_unattached", "msg_unattached", "part_unattached", "fenced") })
    await fencedHandled.promise
    const boundary = await harness.subscription.replayBoundary(replay)
    await Effect.runPromise(harness.session.create({ id: "ses_unattached", cwd: "/workspace" }))
    const baseline = assistantMessage("ses_unattached", "msg_unattached", "part_unattached", "text")
    await harness.subscription.replayMessage(baseline)
    await harness.subscription.finishReplay(replay, boundary, [baseline])

    expect(textFromUpdates(harness.updates, "ses_unattached")).toBe("earlyfenced")
    harness.subscription.stop()
  })

  it("fails replay explicitly when an unattached transcript journal overflows", async () => {
    const harness = createHarness()
    await harness.subscription.handle(
      textDelta("ses_unattached_overflow", "msg_overflow", "part_overflow", "x".repeat(2 * 1024 * 1024)),
    )

    const replay = harness.subscription.beginReplay("ses_unattached_overflow")
    try {
      await expect(harness.subscription.finishReplay(replay, 0)).rejects.toBeInstanceOf(ACPEvent.ReplayBoundaryError)
    } finally {
      await harness.subscription.abortReplay(replay)
    }

    const retry = harness.subscription.beginReplay("ses_unattached_overflow")
    try {
      await expect(harness.subscription.finishReplay(retry, 0)).rejects.toBeInstanceOf(ACPEvent.ReplayBoundaryError)
    } finally {
      await harness.subscription.abortReplay(retry)
    }
  })

  it("recovers an unattached overflow after the dropped part is durably finalized", async () => {
    const harness = createHarness()
    await harness.subscription.handle(
      textDelta("ses_overflow_finalized", "msg_overflow", "part_overflow", "x".repeat(2 * 1024 * 1024)),
    )
    const finalized = partUpdated("ses_overflow_finalized", "msg_overflow", "part_overflow", "text")
    if (finalized.type === "message.part.updated" && finalized.properties.part.type === "text") {
      finalized.properties.part.text = "complete"
      finalized.properties.part.time = { start: Date.now() - 1, end: Date.now() }
    }
    await harness.subscription.handle(finalized)

    const replay = harness.subscription.beginReplay("ses_overflow_finalized")
    await expect(harness.subscription.finishReplay(replay, 0)).resolves.toBeUndefined()
  })

  it("recovers an unattached overflow after the dropped part is removed", async () => {
    const harness = createHarness()
    await harness.subscription.handle(
      textDelta("ses_overflow_removed", "msg_overflow", "part_overflow", "x".repeat(2 * 1024 * 1024)),
    )
    await harness.subscription.handle({
      id: "evt_overflow_removed",
      type: "message.part.removed",
      properties: {
        sessionID: "ses_overflow_removed",
        messageID: "msg_overflow",
        partID: "part_overflow",
      },
    })

    const replay = harness.subscription.beginReplay("ses_overflow_removed")
    await expect(harness.subscription.finishReplay(replay, 0)).resolves.toBeUndefined()
  })

  it("purges an unattached delta when its source part is removed", async () => {
    const harness = createHarness()
    await harness.subscription.handle(textDelta("ses_removed_part", "msg_removed", "part_removed", "obsolete"))
    await harness.subscription.handle({
      id: "evt_removed_part",
      type: "message.part.removed",
      properties: {
        sessionID: "ses_removed_part",
        messageID: "msg_removed",
        partID: "part_removed",
      },
    })

    const replay = harness.subscription.beginReplay("ses_removed_part")
    await Effect.runPromise(harness.session.create({ id: "ses_removed_part", cwd: "/workspace" }))
    const baseline = assistantMessage("ses_removed_part", "msg_removed", "part_removed", "text")
    await harness.subscription.replayMessage(baseline)
    await harness.subscription.finishReplay(replay, 0, [baseline])

    expect(textFromUpdates(harness.updates, "ses_removed_part")).toBe("")
  })

  it("claims a queued removal atomically when replay begins", async () => {
    const harness = createHarness()
    await createKnownSession(harness.session, "ses_tail_blocker", {
      messageId: "msg_tail_blocker",
      partId: "part_tail_blocker",
      partType: "text",
    })
    const blocked = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    harness.subscription.addListener(async (event) => {
      if (event.id !== "evt_ses_tail_blocker_msg_tail_blocker_part_tail_blocker_block") return
      blocked.resolve()
      await release.promise
    })
    harness.subscription.start()
    await harness.events.ready
    harness.events.push({
      payload: textDelta("ses_tail_blocker", "msg_tail_blocker", "part_tail_blocker", "block"),
    })
    await blocked.promise

    let retry: ACPEvent.ReplayWindow | undefined
    try {
      harness.events.push({ payload: textDelta("ses_removed_pending", "msg_removed", "part_removed", "obsolete") })
      harness.events.push({
        payload: {
          id: "evt_removed_pending",
          type: "message.part.removed",
          properties: {
            sessionID: "ses_removed_pending",
            messageID: "msg_removed",
            partID: "part_removed",
          },
        },
      })

      const replay = harness.subscription.beginReplay("ses_removed_pending")
      await harness.subscription.abortReplay(replay)
      retry = harness.subscription.beginReplay("ses_removed_pending")
      expect(harness.subscription.replayRevision(retry)).toBe(0)
    } finally {
      if (retry) await harness.subscription.abortReplay(retry)
      release.resolve()
      harness.subscription.stop()
      harness.events.close()
    }
  })

  it("compacts queued unattached deltas after their finalized durable update", async () => {
    const harness = createHarness()
    const finalized = partUpdated("ses_finalized", "msg_finalized", "part_finalized", "text")
    if (finalized.type === "message.part.updated" && finalized.properties.part.type === "text") {
      finalized.properties.part.text = "complete"
      finalized.properties.part.time = { start: Date.now() - 1, end: Date.now() }
    }
    const handled = Promise.withResolvers<void>()
    harness.subscription.addListener(async (event) => {
      if (event.id === finalized.id) handled.resolve()
    })
    harness.subscription.start()
    await harness.events.ready

    harness.events.push({ payload: textDelta("ses_finalized", "msg_finalized", "part_finalized", "partial") })
    harness.events.push({ payload: finalized })
    await handled.promise

    const replay = harness.subscription.beginReplay("ses_finalized")
    expect(harness.subscription.replayRevision(replay)).toBe(0)
    await harness.subscription.abortReplay(replay)
    harness.subscription.stop()
  })

  it("invalidates an active replay when its session is deleted", async () => {
    const harness = createHarness()
    const replay = harness.subscription.beginReplay("ses_deleted")
    await harness.subscription.handle(textDelta("ses_deleted", "msg_deleted", "part_deleted", "obsolete"))
    await harness.subscription.handle({
      id: "evt_deleted_session",
      type: "session.deleted",
      properties: {
        sessionID: "ses_deleted",
        info: { id: "ses_deleted" },
      },
    } as unknown as Event)
    await Effect.runPromise(harness.session.create({ id: "ses_deleted", cwd: "/workspace" }))

    try {
      await expect(harness.subscription.finishReplay(replay, 1)).rejects.toBeInstanceOf(ACPEvent.ReplayBoundaryError)
    } finally {
      await Effect.runPromise(harness.session.remove("ses_deleted"))
      await harness.subscription.abortReplay(replay)
    }

    const retry = harness.subscription.beginReplay("ses_deleted")
    expect(harness.subscription.replayRevision(retry)).toBe(0)
    await harness.subscription.abortReplay(retry)
  })

  it("invalidates replay immediately when deletion arrives behind a blocked event tail", async () => {
    const harness = createHarness()
    await createKnownSession(harness.session, "ses_delete_blocker", {
      messageId: "msg_delete_blocker",
      partId: "part_delete_blocker",
      partType: "text",
    })
    const blocked = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    harness.subscription.addListener(async (event) => {
      if (event.id !== "evt_ses_delete_blocker_msg_delete_blocker_part_delete_blocker_block") return
      blocked.resolve()
      await release.promise
    })
    harness.subscription.start()
    await harness.events.ready
    harness.events.push({
      payload: textDelta("ses_delete_blocker", "msg_delete_blocker", "part_delete_blocker", "block"),
    })
    await blocked.promise

    const replay = harness.subscription.beginReplay("ses_deleted_pending")
    try {
      harness.events.push({
        payload: {
          id: "evt_deleted_pending",
          type: "session.deleted",
          properties: {
            sessionID: "ses_deleted_pending",
            info: { id: "ses_deleted_pending" },
          },
        } as unknown as Event,
      })

      await expect(harness.subscription.replayBoundary(replay)).rejects.toBeInstanceOf(ACPEvent.ReplayBoundaryError)
    } finally {
      release.resolve()
      await harness.subscription.abortReplay(replay)
      harness.subscription.stop()
      harness.events.close()
    }
  })

  it("opens a lossless replay boundary before draining later live transcript events", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_boundary", cwd: "/workspace" }))

    const replay = harness.subscription.beginReplay("ses_boundary")
    await harness.subscription.handle(partUpdated("ses_boundary", "msg_boundary", "part_boundary", "text"))
    await harness.subscription.handle(textDelta("ses_boundary", "msg_boundary", "part_boundary", "covered"))
    const boundary = harness.subscription.replayRevision(replay)

    const baseline = assistantMessage("ses_boundary", "msg_boundary", "part_boundary", "text")
    const baselinePart = baseline.parts[0]
    if (baselinePart?.type === "text") baselinePart.text = "covered"
    await harness.subscription.replayMessage(baseline)

    await harness.subscription.handle(textDelta("ses_boundary", "msg_boundary", "part_boundary", " live"))
    await harness.subscription.finishReplay(replay, boundary, [baseline])

    expect(textFromUpdates(harness.updates, "ses_boundary")).toBe("covered live")
  })

  it("does not suppress a repeated text delta committed after the replay boundary", async () => {
    const harness = createHarness()
    await createKnownSession(harness.session, "ses_repeated", {
      messageId: "msg_repeated",
      partId: "part_repeated",
      partType: "text",
    })
    const baseline = assistantMessage("ses_repeated", "msg_repeated", "part_repeated", "text")
    const part = baseline.parts[0]
    if (part?.type === "text") part.text = "x"

    const replay = harness.subscription.beginReplay("ses_repeated")
    const boundary = harness.subscription.replayRevision(replay)
    await harness.subscription.replayMessage(baseline)
    await harness.subscription.handle(textDelta("ses_repeated", "msg_repeated", "part_repeated", "x"))
    await harness.subscription.finishReplay(replay, boundary, [baseline])

    expect(textFromUpdates(harness.updates, "ses_repeated")).toBe("xx")
  })

  it("accounts for a second post-boundary event while the first awaits replay", async () => {
    const harness = createHarness()
    await createKnownSession(harness.session, "ses_bounded", {
      messageId: "msg_bounded",
      partId: "part_bounded",
      partType: "text",
    })
    harness.subscription.start()
    await harness.events.ready
    const replay = harness.subscription.beginReplay("ses_bounded")

    try {
      const boundary = await harness.subscription.replayBoundary(replay)
      harness.events.push({ payload: textDelta("ses_bounded", "msg_bounded", "part_bounded", "first") })
      await pollUntil(
        () => harness.subscription.replayRevision(replay) === 1,
        "first post-boundary event was not admitted",
      )
      harness.events.push({
        payload: textDelta("ses_bounded", "msg_bounded", "part_bounded", "x".repeat(2 * 1024 * 1024)),
      })

      await expect(harness.subscription.finishReplay(replay, boundary)).rejects.toBeInstanceOf(
        ACPEvent.ReplayBoundaryError,
      )
    } finally {
      await harness.subscription.abortReplay(replay)
      harness.subscription.stop()
      harness.events.close()
    }
  })

  it("enforces the event-count cap across batches admitted while replay drains", async () => {
    let harness: ReturnType<typeof createHarness>
    let injected = false
    const delta = textDelta("s", "m", "p", "x")
    harness = createHarness({}, (update) => {
      if (injected || update.update.sessionUpdate !== "agent_message_chunk") return
      injected = true
      for (let index = 0; index < 5_001; index++) {
        void harness.subscription.handle(delta)
      }
    })
    await createKnownSession(harness.session, "s", {
      messageId: "m",
      partId: "p",
      partType: "text",
    })
    const replay = harness.subscription.beginReplay("s")
    for (let index = 0; index < 5_000; index++) {
      await harness.subscription.handle(delta)
    }

    try {
      await expect(harness.subscription.finishReplay(replay, 0)).rejects.toBeInstanceOf(ACPEvent.ReplayBoundaryError)
    } finally {
      harness.subscription.stop()
    }
  })

  it("retains a transient delta that is absent from the replay snapshot", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_transient", cwd: "/workspace" }))

    const replay = harness.subscription.beginReplay("ses_transient")
    await harness.subscription.handle(partUpdated("ses_transient", "msg_transient", "part_transient", "text"))
    await harness.subscription.handle(textDelta("ses_transient", "msg_transient", "part_transient", "transient"))
    const boundary = harness.subscription.replayRevision(replay)
    const baseline = assistantMessage("ses_transient", "msg_transient", "part_transient", "text")

    await harness.subscription.replayMessage(baseline)
    await harness.subscription.finishReplay(replay, boundary, [baseline])

    expect(textFromUpdates(harness.updates, "ses_transient")).toBe("transient")
  })

  it("fails replay when a fenced delta cannot be delivered", async () => {
    const harness = createHarness({}, (update) => {
      if (
        update.update.sessionUpdate === "agent_message_chunk" &&
        update.update.content.type === "text" &&
        update.update.content.text === "undelivered"
      ) {
        throw new Error("connection write failed")
      }
    })
    await createKnownSession(harness.session, "ses_delivery_failure", {
      messageId: "msg_delivery_failure",
      partId: "part_delivery_failure",
      partType: "text",
    })
    const replay = harness.subscription.beginReplay("ses_delivery_failure")
    await harness.subscription.handle(
      textDelta("ses_delivery_failure", "msg_delivery_failure", "part_delivery_failure", "undelivered"),
    )

    try {
      await expect(harness.subscription.finishReplay(replay, 0)).rejects.toThrow("connection write failed")
    } finally {
      await harness.subscription.abortReplay(replay)
    }
  })

  it("fails replay when uncovered finalized content cannot be delivered", async () => {
    const harness = createHarness({}, (update) => {
      if (
        update.update.sessionUpdate === "agent_message_chunk" &&
        update.update.content.type === "text" &&
        update.update.content.text === "uncovered"
      ) {
        throw new Error("connection write failed")
      }
    })
    await createKnownSession(harness.session, "ses_uncovered_failure", {
      messageId: "msg_uncovered",
      partId: "part_uncovered",
      partType: "text",
    })
    const updated = partUpdated("ses_uncovered_failure", "msg_uncovered", "part_uncovered", "text")
    if (updated.type === "message.part.updated" && updated.properties.part.type === "text") {
      updated.properties.part.text = "uncovered"
      updated.properties.part.time = { start: Date.now() - 1, end: Date.now() }
    }
    const replay = harness.subscription.beginReplay("ses_uncovered_failure")
    await harness.subscription.handle(updated)

    try {
      await expect(harness.subscription.finishReplay(replay, 1)).rejects.toThrow("connection write failed")
    } finally {
      await harness.subscription.abortReplay(replay)
    }
  })

  it("projects a tool completion committed after the snapshot and before its boundary", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_tool_race", cwd: "/workspace" }))
    const completed = completedTool("ses_tool_race", "call_after_snapshot")

    const replay = harness.subscription.beginReplay("ses_tool_race")
    await harness.subscription.handle(toolUpdated(completed))
    const boundary = harness.subscription.replayRevision(replay)
    await harness.subscription.finishReplay(replay, boundary, [])

    expect(toolUpdates(harness.updates).map((item) => item.update.toolCallId)).toEqual([
      "call_after_snapshot",
      "call_after_snapshot",
    ])
  })

  it("does not duplicate a snapshot-covered tool completion delivered after its boundary", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_tool_delayed", cwd: "/workspace" }))
    const completed = completedTool("ses_tool_delayed", "call_delayed")
    const baseline = assistantToolMessage(completed)

    const replay = harness.subscription.beginReplay("ses_tool_delayed")
    const boundary = harness.subscription.replayRevision(replay)
    await harness.subscription.handle(toolUpdated(completed))
    await harness.subscription.replayMessage(baseline)
    await harness.subscription.finishReplay(replay, boundary, [baseline])

    expect(toolUpdates(harness.updates).map((item) => item.update.toolCallId)).toEqual(["call_delayed", "call_delayed"])
  })

  it("does not regress snapshot running-tool progress to an earlier buffered update", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_tool_progress", cwd: "/workspace" }))
    const earlier = runningTool("ses_tool_progress", "call_progress", "earlier")
    const latest = runningTool("ses_tool_progress", "call_progress", "latest")
    const baseline = assistantToolMessage(latest)

    const replay = harness.subscription.beginReplay("ses_tool_progress")
    await harness.subscription.handle(toolUpdated(earlier))
    await harness.subscription.handle(toolUpdated(latest))
    const boundary = harness.subscription.replayRevision(replay)
    await harness.subscription.replayMessage(baseline)
    await harness.subscription.finishReplay(replay, boundary, [baseline])

    const outputs = toolUpdates(harness.updates).flatMap((item) => {
      if (item.update.sessionUpdate !== "tool_call_update") return []
      return (item.update.content ?? []).flatMap((content) =>
        content.type === "content" && content.content.type === "text" ? [content.content.text] : [],
      )
    })
    expect(outputs).toEqual(["latest"])
  })

  it("fences matching running-tool progress before projecting an earlier update", async () => {
    const earlier = runningTool("ses_tool_drain", "call_drain", "earlier")
    const latest = runningTool("ses_tool_drain", "call_drain", "latest")
    const baseline = assistantToolMessage(latest)
    let harness: ReturnType<typeof createHarness>
    let injected = false
    harness = createHarness({}, undefined, () => {
      if (injected) return
      injected = true
      harness.events.push({ payload: toolUpdated(latest) })
    })
    await Effect.runPromise(harness.session.create({ id: "ses_tool_drain", cwd: "/workspace" }))
    harness.subscription.start()

    const replay = harness.subscription.beginReplay("ses_tool_drain")
    await harness.subscription.handle(toolUpdated(earlier))
    const boundary = harness.subscription.replayRevision(replay)
    await harness.subscription.replayMessage(baseline)
    await harness.subscription.finishReplay(replay, boundary, [baseline])

    const outputs = toolUpdates(harness.updates).flatMap((item) => {
      if (item.update.sessionUpdate !== "tool_call_update") return []
      return (item.update.content ?? []).flatMap((content) =>
        content.type === "content" && content.content.type === "text" ? [content.content.text] : [],
      )
    })
    expect(outputs).toEqual(["latest"])
    harness.subscription.stop()
  })

  it("keeps a replay locked while post-fence live events are backpressured", async () => {
    const liveStarted = Promise.withResolvers<void>()
    const releaseLive = Promise.withResolvers<void>()
    let harness: ReturnType<typeof createHarness>
    let injected = false
    harness = createHarness(
      {},
      (update) => {
        if (
          update.update.sessionUpdate !== "agent_message_chunk" ||
          update.update.content.type !== "text" ||
          update.update.content.text !== "live"
        ) {
          return
        }
        liveStarted.resolve()
        return releaseLive.promise
      },
      undefined,
      () => {
        if (injected) return
        injected = true
        harness.events.push({ payload: textDelta("ses_drain_lock", "msg_drain_lock", "part_drain_lock", "live") })
      },
    )
    await createKnownSession(harness.session, "ses_drain_lock", {
      messageId: "msg_drain_lock",
      partId: "part_drain_lock",
      partType: "text",
    })
    harness.subscription.start()
    const replay = harness.subscription.beginReplay("ses_drain_lock")
    const finishing = harness.subscription.finishReplay(replay, 0)
    await liveStarted.promise

    let concurrent: ACPEvent.ReplayWindow | undefined
    let concurrentError: unknown
    try {
      concurrent = harness.subscription.beginReplay("ses_drain_lock")
    } catch (error) {
      concurrentError = error
    }
    harness.events.push({ payload: textDelta("ses_drain_lock", "msg_drain_lock", "part_drain_lock", "later") })
    releaseLive.resolve()
    await finishing
    if (concurrent) await harness.subscription.abortReplay(concurrent)

    expect(concurrentError).toBeInstanceOf(Error)
    expect(textFromUpdates(harness.updates, "ses_drain_lock")).toBe("livelater")
    const retry = harness.subscription.beginReplay("ses_drain_lock")
    await harness.subscription.abortReplay(retry)
    harness.subscription.stop()
  })

  it("reconciles a pre-replay queued event before newer post-fence events", async () => {
    const blockerStarted = Promise.withResolvers<void>()
    const releaseBlocker = Promise.withResolvers<void>()
    let harness: ReturnType<typeof createHarness>
    let injected = false
    harness = createHarness(
      {},
      (update) => {
        if (
          update.sessionId !== "ses_blocker" ||
          update.update.sessionUpdate !== "agent_message_chunk" ||
          update.update.content.type !== "text"
        ) {
          return
        }
        blockerStarted.resolve()
        return releaseBlocker.promise
      },
      undefined,
      () => {
        if (injected) return
        injected = true
        harness.events.push({ payload: textDelta("ses_ordered", "msg_ordered", "part_ordered", "new") })
      },
    )
    await createKnownSession(harness.session, "ses_blocker", {
      messageId: "msg_blocker",
      partId: "part_blocker",
      partType: "text",
    })
    await createKnownSession(harness.session, "ses_ordered", {
      messageId: "msg_ordered",
      partId: "part_ordered",
      partType: "text",
    })
    harness.subscription.start()
    harness.events.push({ payload: textDelta("ses_blocker", "msg_blocker", "part_blocker", "block") })
    await blockerStarted.promise
    harness.events.push({ payload: textDelta("ses_ordered", "msg_ordered", "part_ordered", "old") })

    const replay = harness.subscription.beginReplay("ses_ordered")
    const boundary = harness.subscription.replayRevision(replay)
    const baseline = assistantMessage("ses_ordered", "msg_ordered", "part_ordered", "text")
    const baselinePart = baseline.parts[0]
    if (baselinePart?.type === "text") baselinePart.text = "old"
    await harness.subscription.replayMessage(baseline)
    const finishing = harness.subscription.finishReplay(replay, boundary, [baseline])
    releaseBlocker.resolve()
    await finishing

    expect(textFromUpdates(harness.updates, "ses_ordered")).toBe("oldnew")
    harness.subscription.stop()
  })

  it("restores tool replay caches when a failed replay is aborted", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_tool_abort", cwd: "/workspace" }))
    const baseline = assistantToolMessage(runningTool("ses_tool_abort", "call_abort", "latest"))
    const first = harness.subscription.beginReplay("ses_tool_abort")
    await harness.subscription.replayMessage(baseline)
    await harness.subscription.handle(
      textDelta("ses_tool_abort", "msg_overflow", "part_overflow", "x".repeat(2 * 1024 * 1024)),
    )
    await expect(harness.subscription.finishReplay(first, 0, [baseline])).rejects.toBeInstanceOf(
      ACPEvent.ReplayBoundaryError,
    )
    await harness.subscription.abortReplay(first)

    const beforeRetry = harness.updates.length
    const retry = harness.subscription.beginReplay("ses_tool_abort")
    await harness.subscription.replayMessage(baseline)
    await harness.subscription.finishReplay(retry, 0, [baseline])

    const retried = toolUpdates(harness.updates.slice(beforeRetry))
    expect(retried.map((item) => item.update.sessionUpdate)).toEqual(["tool_call", "tool_call_update"])
    expect(retried[1]?.update).toMatchObject({
      content: [{ type: "content", content: { type: "text", text: "latest" } }],
    })
  })

  it("isolates running-tool caches for reused call IDs in different sessions", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_tool_first", cwd: "/workspace" }))
    await Effect.runPromise(harness.session.create({ id: "ses_tool_second", cwd: "/workspace" }))

    await harness.subscription.replayMessage(
      assistantToolMessage(runningTool("ses_tool_first", "call_shared", "first")),
    )
    await harness.subscription.replayMessage(
      assistantToolMessage(runningTool("ses_tool_second", "call_shared", "second")),
    )

    expect(toolUpdates(harness.updates).map((item) => [item.sessionId, item.update.sessionUpdate])).toEqual([
      ["ses_tool_first", "tool_call"],
      ["ses_tool_first", "tool_call_update"],
      ["ses_tool_second", "tool_call"],
      ["ses_tool_second", "tool_call_update"],
    ])
  })

  it("treats finalized transformed text as covering its original streamed deltas", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_transformed", cwd: "/workspace" }))
    const replay = harness.subscription.beginReplay("ses_transformed")
    await harness.subscription.handle(partUpdated("ses_transformed", "msg_transformed", "part_transformed", "text"))
    await harness.subscription.handle(textDelta("ses_transformed", "msg_transformed", "part_transformed", "hello"))
    const boundary = harness.subscription.replayRevision(replay)
    const baseline = assistantMessage("ses_transformed", "msg_transformed", "part_transformed", "text")
    const part = baseline.parts[0]
    if (part?.type === "text") {
      const finalized = part as unknown as {
        text: string
        time: { start: number; end: number }
      }
      finalized.text = "HELLO"
      finalized.time = { start: Date.now() - 1, end: Date.now() }
    }

    await harness.subscription.replayMessage(baseline)
    await harness.subscription.finishReplay(replay, boundary, [baseline])

    expect(textFromUpdates(harness.updates, "ses_transformed")).toBe("HELLO")
  })

  it("ignores unknown sessions and live user parts without user_message_chunk duplication", async () => {
    const harness = createHarness()
    await createKnownSession(harness.session, "ses_user", {
      messageId: "msg_user",
      partId: "part_user",
      partType: "text",
      role: "user",
    })

    await harness.subscription.handle(textDelta("ses_missing", "msg_missing", "part_missing", "ignored"))
    await harness.subscription.handle(partUpdated("ses_user", "msg_user", "part_live", "text"))
    await harness.subscription.handle(textDelta("ses_user", "msg_user", "part_user", "hello"))

    expect(harness.updates).toHaveLength(0)
  })

  it("exposes the shell command on the synthetic pending tool call", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_tool", cwd: "/workspace" }))

    await harness.subscription.handle(toolUpdated(runningTool("ses_tool", "call_1", "hello")))

    expect(toolUpdates(harness.updates).map((item) => item.update.sessionUpdate)).toEqual([
      "tool_call",
      "tool_call_update",
    ])
    expect(harness.updates[0]?.update).toMatchObject({
      status: "pending",
      toolCallId: "call_1",
      title: "printf hello",
      kind: "execute",
      locations: [{ path: "/workspace" }],
      rawInput: { cmd: "printf hello", cwd: "/workspace" },
    })
    expect(harness.updates[1]?.update).toMatchObject({ status: "in_progress", toolCallId: "call_1" })
  })

  it("includes available input in the synthetic pending tool call", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_pending_input", cwd: "/workspace" }))

    await harness.subscription.handle(
      toolUpdated({
        id: "part_call_read",
        sessionID: "ses_pending_input",
        messageID: "msg_call_read",
        type: "tool",
        callID: "call_read",
        tool: "read",
        state: {
          status: "running",
          input: { filePath: "/workspace/file.ts" },
          title: "Read file.ts",
          time: { start: Date.now() },
        },
      } satisfies ToolPart),
    )

    expect(harness.updates[0]?.update).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "call_read",
      status: "pending",
      title: "Read file.ts",
      kind: "read",
      rawInput: { filePath: "/workspace/file.ts" },
      locations: [{ path: "/workspace/file.ts" }],
    })
  })

  it("does not emit duplicate synthetic pending after a replayed running tool", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_replay", cwd: "/workspace" }))

    await harness.subscription.replayMessage(assistantToolMessage(runningTool("ses_replay", "call_replay", "first")))
    await harness.subscription.handle(toolUpdated(runningTool("ses_replay", "call_replay", "second")))

    expect(toolUpdates(harness.updates).filter((item) => item.update.sessionUpdate === "tool_call")).toHaveLength(1)
    expect(toolUpdates(harness.updates).map((item) => item.update.sessionUpdate)).toEqual([
      "tool_call",
      "tool_call_update",
      "tool_call_update",
    ])
  })

  it("dedupes shell output snapshots while still sending status-only running updates", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_shell", cwd: "/workspace" }))

    await harness.subscription.handle(toolUpdated(runningTool("ses_shell", "call_shell", "same")))
    await harness.subscription.handle(toolUpdated(runningTool("ses_shell", "call_shell", "same")))

    const updates = toolUpdates(harness.updates)
    expect(updates).toHaveLength(3)
    expect(updates[1]?.update).toMatchObject({
      sessionUpdate: "tool_call_update",
      content: [{ type: "content", content: { type: "text", text: "same" } }],
    })
    expect(updates[2]?.update).toMatchObject({ sessionUpdate: "tool_call_update", status: "in_progress" })
    expect("content" in updates[2]!.update).toBe(false)
  })

  it("clears shell snapshot marker when a tool returns to pending", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_pending", cwd: "/workspace" }))

    await harness.subscription.handle(toolUpdated(runningTool("ses_pending", "call_pending", "repeat")))
    await harness.subscription.handle(
      toolUpdated({
        id: "part_call_pending",
        sessionID: "ses_pending",
        messageID: "msg_call_pending",
        type: "tool",
        callID: "call_pending",
        tool: "bash",
        state: {
          status: "pending",
          input: { cmd: "printf repeat" },
          raw: '{"cmd":"printf repeat"}',
        },
      }),
    )
    await harness.subscription.handle(toolUpdated(runningTool("ses_pending", "call_pending", "repeat")))

    expect(
      toolUpdates(harness.updates)
        .filter((item) => item.update.sessionUpdate === "tool_call_update")
        .map((item) => ("content" in item.update ? item.update.content : undefined)),
    ).toEqual([
      [{ type: "content", content: { type: "text", text: "repeat" } }],
      [{ type: "content", content: { type: "text", text: "repeat" } }],
    ])
  })

  it("emits completed tool output and rawOutput", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_done", cwd: "/workspace" }))

    await harness.subscription.handle(toolUpdated(completedTool("ses_done", "call_done", "finished")))

    expect(harness.updates.at(-1)?.update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_done",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "finished" } }],
      rawOutput: { output: "finished", metadata: { exit: 0 } },
    })
  })

  it("emits clean read display content and preserves rawOutput", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_read", cwd: "/workspace" }))
    const output = [
      "<path>/workspace/file.ts</path>",
      "<type>file</type>",
      "<content>",
      "1: import { value } from './value'",
      "2: export { value }",
      "",
      "(End of file - total 2 lines)",
      "</content>",
    ].join("\n")
    const metadata = {
      display: {
        type: "file",
        path: "/workspace/file.ts",
        text: "import { value } from './value'\nexport { value }",
        lineStart: 1,
        lineEnd: 2,
        totalLines: 2,
        truncated: false,
      },
    }

    await harness.subscription.handle(
      toolUpdated(
        completedTool("ses_read", "call_read", output, [], {
          tool: "read",
          input: { filePath: "/workspace/file.ts" },
          metadata,
        }),
      ),
    )

    expect(harness.updates.at(-1)?.update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_read",
      status: "completed",
      content: [
        {
          type: "content",
          content: { type: "text", text: "import { value } from './value'\nexport { value }" },
        },
      ],
      rawOutput: { output, metadata },
    })
  })

  it("emits error tool output", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_error", cwd: "/workspace" }))

    await harness.subscription.handle(toolUpdated(errorTool("ses_error", "call_error")))

    expect(harness.updates.at(-1)?.update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_error",
      status: "failed",
      content: [{ type: "content", content: { type: "text", text: "failed hard" } }],
      rawOutput: { error: "failed hard", metadata: { exit: 1 } },
    })
  })

  it("emits image attachments as ACP image content for live and replayed completed tool updates", async () => {
    const harness = createHarness()
    const image = Buffer.from("image-data").toString("base64")
    const attachment = {
      id: "file_image",
      sessionID: "ses_image",
      messageID: "msg_image",
      type: "file",
      mime: "image/png",
      filename: "image.png",
      url: `data:image/png;base64,${image}`,
    } as const
    await Effect.runPromise(harness.session.create({ id: "ses_image", cwd: "/workspace" }))

    await harness.subscription.handle(toolUpdated(completedTool("ses_image", "call_live", "live", [attachment])))
    await harness.subscription.replayMessage(
      assistantToolMessage(completedTool("ses_image", "call_replayed", "replayed", [attachment])),
    )

    expect(
      toolUpdates(harness.updates)
        .filter((item) => item.update.sessionUpdate === "tool_call_update" && item.update.status === "completed")
        .map((item) => ("content" in item.update ? item.update.content : [])),
    ).toEqual([
      [
        { type: "content", content: { type: "text", text: "live" } },
        { type: "content", content: { type: "image", mimeType: "image/png", data: image } },
      ],
      [
        { type: "content", content: { type: "text", text: "replayed" } },
        { type: "content", content: { type: "image", mimeType: "image/png", data: image } },
      ],
    ])
  })
})
