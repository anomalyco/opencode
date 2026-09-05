import type { AgentSideConnection, SessionUpdate } from "@agentclientprotocol/sdk"
import type {
  Event,
  EventMessagePartDelta,
  EventMessagePartUpdated,
  OpencodeClient,
  Part,
  SessionMessageResponse,
  ToolPart,
} from "@opencode-ai/sdk/v2"
import { Effect } from "effect"
import { ACPSession } from "./session"
import { ACPPermission } from "./permission"
import { partsToContentChunks, type ReplayPart } from "./content"
import {
  duplicateRunningToolUpdate,
  errorToolUpdate,
  pendingToolCall,
  runningToolUpdate,
  shellOutputSnapshot,
  completedToolUpdate,
} from "./tool"

type Connection = Pick<AgentSideConnection, "sessionUpdate"> &
  Partial<Pick<AgentSideConnection, "requestPermission" | "writeTextFile">>
type GlobalEventEnvelope = {
  payload?: Event
}
type GlobalEventStream = {
  stream: AsyncIterable<GlobalEventEnvelope>
}
type ChildSession = {
  id: string
  parentID: string
  rootID: string
  depth: number
  title?: string
}

export function start(input: { sdk: OpencodeClient; connection: Connection; session: ACPSession.Interface }) {
  const subscription = new Subscription(input)
  subscription.start()
  return subscription
}

export class Subscription {
  private readonly abort = new AbortController()
  private readonly shellSnapshots = new Map<string, string>()
  private readonly toolStarts = new Set<string>()
  private readonly connectionWaiters = new Set<() => void>()
  private readonly idleWaiters = new Map<string, Set<ReturnType<typeof signal>>>()
  private readonly children = new Map<string, ChildSession>()
  private readonly permission: ACPPermission.Handler
  private connected = false
  private started = false

  constructor(
    private readonly input: {
      sdk: OpencodeClient
      connection: Connection
      session: ACPSession.Interface
    },
  ) {
    this.permission = new ACPPermission.Handler(input)
  }

  start() {
    if (this.started) return
    this.started = true
    this.run().catch(() => {
      if (this.abort.signal.aborted) return
    })
  }

  stop() {
    this.abort.abort()
    this.disconnected()
    for (const resolve of this.connectionWaiters) resolve()
    this.connectionWaiters.clear()
  }

  async runUntilIdle<A>(sessionId: string, request: () => Promise<A>) {
    await this.waitUntilConnected()
    const waiter = signal()
    const waiters = this.idleWaiters.get(sessionId) ?? new Set()
    waiters.add(waiter)
    this.idleWaiters.set(sessionId, waiters)

    try {
      // Idle is queued after the turn's events, and this subscription awaits each update in order.
      void waiter.promise.catch(() => {})
      const response = await request()
      await waiter.promise
      return response
    } finally {
      waiters.delete(waiter)
      if (waiters.size === 0) this.idleWaiters.delete(sessionId)
    }
  }

  async handle(event: Event) {
    switch (event.type) {
      case "session.created":
        await this.registerChild(event.properties.info)
        return
      case "session.deleted":
        this.children.delete(event.properties.sessionID)
        return
      case "session.status":
        if (event.properties.status.type === "idle") this.idle(event.properties.sessionID)
        return
      case "permission.asked": {
        const target = await this.resolveSession(event.properties.sessionID)
        if (!target) return
        this.permission.handle(event, {
          sessionId: target.session.id,
          cwd: target.session.cwd,
          ...(target.child
            ? {
                toolCallPrefix: target.child.id,
                titlePrefix: target.child.title,
              }
            : {}),
        })
        return
      }
      case "message.part.updated":
        return this.handlePartUpdated(event)
      case "message.part.delta":
        return this.handlePartDelta(event)
    }
  }

  async replayMessage(message: SessionMessageResponse) {
    if (message.info.role !== "assistant" && message.info.role !== "user") return

    const cwd = message.info.role === "assistant" ? message.info.path?.cwd : undefined
    for (const part of message.parts) {
      await this.recordFetchedPart(message.info.sessionID, message, part)
      if (part.type === "tool") {
        await this.handleToolPart(message.info.sessionID, message.info.sessionID, part, cwd ?? process.cwd())
        continue
      }
      await this.replayContentPart(message, part)
    }
  }

  private async replayContentPart(message: SessionMessageResponse, part: Part) {
    if (part.type !== "text" && part.type !== "file" && part.type !== "reasoning") return

    const sessionUpdate =
      part.type === "reasoning"
        ? "agent_thought_chunk"
        : message.info.role === "user"
          ? "user_message_chunk"
          : "agent_message_chunk"

    for (const chunk of partsToContentChunks([part as ReplayPart])) {
      await this.input.connection.sessionUpdate({
        sessionId: message.info.sessionID,
        update: {
          sessionUpdate,
          messageId: message.info.id,
          ...chunk,
        },
      })
    }
  }

  private async run() {
    while (!this.abort.signal.aborted) {
      await this.consume().catch(() => {})
      this.disconnected()
      if (!this.abort.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  private async consume() {
    const events = (await this.input.sdk.global.event({
      signal: this.abort.signal,
    })) as GlobalEventStream
    this.connected = true
    for (const resolve of this.connectionWaiters) resolve()
    this.connectionWaiters.clear()

    for await (const event of events.stream) {
      if (this.abort.signal.aborted) return
      if (!event.payload) continue
      await this.handle(event.payload).catch(() => {})
    }
  }

  private async waitUntilConnected() {
    while (!this.connected) {
      if (this.abort.signal.aborted) throw new Error("ACP event subscription stopped")
      await new Promise<void>((resolve) => this.connectionWaiters.add(resolve))
    }
  }

  private disconnected() {
    if (!this.connected) return
    this.connected = false
    const error = new Error("ACP event stream disconnected")
    for (const waiters of this.idleWaiters.values()) {
      for (const waiter of waiters) waiter.reject(error)
    }
    this.idleWaiters.clear()
  }

  private idle(sessionId: string) {
    const waiters = this.idleWaiters.get(sessionId)
    if (!waiters) return
    this.idleWaiters.delete(sessionId)
    for (const waiter of waiters) waiter.resolve()
  }

  private async handlePartUpdated(event: EventMessagePartUpdated) {
    const part = event.properties.part
    const sourceSessionId = part.sessionID || event.properties.sessionID
    const target = await this.resolveSession(sourceSessionId)
    if (!target) return

    await Effect.runPromise(
      this.input.session.recordPartMetadata({
        sessionId: target.session.id,
        messageId: part.messageID,
        partId: part.id,
        partType: part.type,
        role: part.type === "reasoning" ? "assistant" : undefined,
        ignored: part.type === "text" ? part.ignored : undefined,
        toolCallId: part.type === "tool" ? part.callID : undefined,
        metadata: "metadata" in part ? part.metadata : undefined,
      }),
    )
    if (part.type === "tool") {
      await this.handleToolPart(target.session.id, sourceSessionId, part, target.session.cwd, target.child)
    }
  }

  private async handlePartDelta(event: EventMessagePartDelta) {
    const props = event.properties
    const target = await this.resolveSession(props.sessionID)
    if (!target) return

    const known = await Effect.runPromise(
      this.input.session.tryGetPartMetadata({
        sessionId: target.session.id,
        messageId: props.messageID,
        partId: props.partID,
      }),
    )
    const metadata =
      known?.role && known.partType
        ? known
        : await this.fetchPartMetadata(
            props.sessionID,
            target.session.id,
            target.session.cwd,
            props.messageID,
            props.partID,
          )
    if (metadata?.role !== "assistant") return
    if (metadata.partType === "text" && props.field === "text" && metadata.ignored !== true) {
      await this.update(
        target.session.id,
        {
          sessionUpdate: "agent_message_chunk",
          messageId: props.messageID,
          content: {
            type: "text",
            text: props.delta,
          },
        },
        target.child,
      )
      return
    }

    if (metadata.partType === "reasoning" && props.field === "text") {
      await this.update(
        target.session.id,
        {
          sessionUpdate: "agent_thought_chunk",
          messageId: props.messageID,
          content: {
            type: "text",
            text: props.delta,
          },
        },
        target.child,
      )
    }
  }

  private async fetchPartMetadata(
    sourceSessionId: string,
    targetSessionId: string,
    cwd: string,
    messageId: string,
    partId: string,
  ) {
    const message = await this.input.sdk.session
      .message(
        {
          sessionID: sourceSessionId,
          messageID: messageId,
          directory: cwd,
        },
        { throwOnError: true },
      )
      .then((response) => response.data)
      .catch(() => undefined)
    if (!message) return

    const part = message.parts.find((item) => item.id === partId)
    if (!part) return
    return await this.recordFetchedPart(targetSessionId, message, part)
  }

  private async recordFetchedPart(sessionId: string, message: SessionMessageResponse, part: Part) {
    return await Effect.runPromise(
      this.input.session.recordPartMetadata({
        sessionId,
        messageId: part.messageID,
        partId: part.id,
        partType: part.type,
        role: message.info.role,
        ignored: part.type === "text" ? part.ignored : undefined,
        toolCallId: part.type === "tool" ? part.callID : undefined,
        metadata: "metadata" in part ? part.metadata : undefined,
      }),
    )
  }

  private async handleToolPart(
    sessionId: string,
    sourceSessionId: string,
    part: ToolPart,
    cwd: string,
    child?: ChildSession,
  ) {
    const key = toolKey(sourceSessionId, part.callID)
    await this.toolStart(sessionId, key, part, cwd, child)

    switch (part.state.status) {
      case "pending":
        this.shellSnapshots.delete(key)
        return

      case "running":
        await this.runningTool(sessionId, key, part, cwd, child)
        return

      case "completed":
        this.clearTool(key)
        await this.update(
          sessionId,
          {
            sessionUpdate: "tool_call_update",
            ...completedToolUpdate({
              toolCallId: part.callID,
              toolName: part.tool,
              state: part.state,
              cwd,
            }),
          },
          child,
        )
        return

      case "error":
        this.clearTool(key)
        await this.update(
          sessionId,
          {
            sessionUpdate: "tool_call_update",
            ...errorToolUpdate({
              toolCallId: part.callID,
              toolName: part.tool,
              state: part.state,
              cwd,
            }),
          },
          child,
        )
        return
    }
  }

  private async runningTool(sessionId: string, key: string, part: ToolPart, cwd: string, child?: ChildSession) {
    if (part.state.status !== "running") return

    const output = part.tool === "bash" ? shellOutputSnapshot(part.state) : undefined
    if (output !== undefined) {
      if (this.shellSnapshots.get(key) === output) {
        await this.update(
          sessionId,
          {
            sessionUpdate: "tool_call_update",
            ...duplicateRunningToolUpdate({
              toolCallId: part.callID,
              toolName: part.tool,
              state: part.state,
              cwd,
            }),
          },
          child,
        )
        return
      }
      this.shellSnapshots.set(key, output)
    }

    await this.update(
      sessionId,
      {
        sessionUpdate: "tool_call_update",
        ...runningToolUpdate({
          toolCallId: part.callID,
          toolName: part.tool,
          state: part.state,
          output,
          cwd,
        }),
      },
      child,
    )
  }

  private async toolStart(sessionId: string, key: string, part: ToolPart, cwd: string, child?: ChildSession) {
    if (this.toolStarts.has(key)) return
    this.toolStarts.add(key)
    await this.update(
      sessionId,
      {
        sessionUpdate: "tool_call",
        ...pendingToolCall({
          toolCallId: part.callID,
          toolName: part.tool,
          state: part.state,
          cwd,
        }),
      },
      child,
    )
  }

  private clearTool(key: string) {
    this.toolStarts.delete(key)
    this.shellSnapshots.delete(key)
  }

  private async registerChild(info: Extract<Event, { type: "session.created" }>["properties"]["info"]) {
    if (!info.parentID) return
    const parent = this.children.get(info.parentID)
    const rootID = parent?.rootID ?? (await Effect.runPromise(this.input.session.tryGet(info.parentID)))?.id
    if (!rootID) return
    this.children.set(info.id, {
      id: info.id,
      parentID: info.parentID,
      rootID,
      depth: (parent?.depth ?? 0) + 1,
      title: info.title,
    })
  }

  private async resolveSession(sessionId: string) {
    const session = await Effect.runPromise(this.input.session.tryGet(sessionId))
    if (session) return { session, child: undefined }
    const child = this.children.get(sessionId)
    if (!child) return
    const root = await Effect.runPromise(this.input.session.tryGet(child.rootID))
    if (!root) return
    return { session: root, child }
  }

  private update(sessionId: string, update: SessionUpdate, child?: ChildSession) {
    return this.input.connection.sessionUpdate({
      sessionId,
      update: child ? projectChildUpdate(update, child) : update,
    })
  }
}

function toolKey(sessionId: string, toolCallId: string) {
  return `${sessionId}:${toolCallId}`
}

function projectChildUpdate(update: SessionUpdate, child: ChildSession) {
  const projected = { ...update }
  projected._meta = {
    ...projected._meta,
    "opencode/child-session": {
      id: child.id,
      parentID: child.parentID,
      depth: child.depth,
      ...(child.title ? { title: child.title } : {}),
    },
  }
  if (projected.sessionUpdate === "tool_call" || projected.sessionUpdate === "tool_call_update") {
    projected.toolCallId = `${child.id}:${projected.toolCallId}`
    if (projected.title && child.title) projected.title = `${child.title}: ${projected.title}`
  }
  return projected
}

function signal() {
  const state: {
    resolve: () => void
    reject: (reason?: unknown) => void
  } = {
    resolve: () => {},
    reject: () => {},
  }
  const promise = new Promise<void>((resolve, reject) => {
    state.resolve = resolve
    state.reject = reject
  })
  return {
    promise,
    resolve: () => state.resolve(),
    reject: (reason?: unknown) => state.reject(reason),
  }
}

export * as ACPEvent from "./event"
