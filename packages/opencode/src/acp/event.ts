import type { AgentSideConnection, SessionNotification, ToolCallContent } from "@agentclientprotocol/sdk"
import { createTwoFilesPatch } from "diff"
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

export function start(input: {
  sdk: OpencodeClient
  connection: Connection
  session: ACPSession.Interface
  isV2?: () => boolean
  onBusy?: (sessionId: string) => Effect.Effect<void>
  onIdle?: (sessionId: string) => Effect.Effect<void>
}) {
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
  private readonly permission: ACPPermission.Handler
  private connected = false
  private started = false

  constructor(
    private readonly input: {
      sdk: OpencodeClient
      connection: Connection
      session: ACPSession.Interface
      isV2?: () => boolean
      onBusy?: (sessionId: string) => Effect.Effect<void>
      onIdle?: (sessionId: string) => Effect.Effect<void>
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
      case "session.status":
        if (event.properties.status.type === "idle") {
          this.idle(event.properties.sessionID)
          if (this.input.isV2?.())
            await Effect.runPromise(this.input.onIdle?.(event.properties.sessionID) ?? Effect.void)
        }
        if (event.properties.status.type === "busy" && this.input.isV2?.()) {
          await Effect.runPromise(this.input.onBusy?.(event.properties.sessionID) ?? Effect.void)
        }
        return
      case "permission.asked":
        this.permission.handle(event)
        return
      case "message.part.updated":
        return this.handlePartUpdated(event)
      case "message.part.delta":
        return this.handlePartDelta(event)
      case "todo.updated":
        return this.handleTodoUpdated(event)
    }
  }

  async replayMessage(message: SessionMessageResponse) {
    if (message.info.role !== "assistant" && message.info.role !== "user") return

    const cwd = message.info.role === "assistant" ? message.info.path?.cwd : undefined
    for (const part of message.parts) {
      await this.recordFetchedPart(message.info.sessionID, message, part)
      if (part.type === "tool") {
        await this.handleToolPart(message.info.sessionID, part, cwd ?? process.cwd())
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
    const sessionId = part.sessionID || event.properties.sessionID
    const session = await Effect.runPromise(this.input.session.tryGet(sessionId))
    if (!session) return

    await Effect.runPromise(
      this.input.session.recordPartMetadata({
        sessionId: session.id,
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
      await this.handleToolPart(session.id, part, session.cwd)
    }
  }

  private async handlePartDelta(event: EventMessagePartDelta) {
    const props = event.properties
    const session = await Effect.runPromise(this.input.session.tryGet(props.sessionID))
    if (!session) return

    const known = await Effect.runPromise(
      this.input.session.tryGetPartMetadata({
        sessionId: session.id,
        messageId: props.messageID,
        partId: props.partID,
      }),
    )
    const metadata =
      known?.role && known.partType
        ? known
        : await this.fetchPartMetadata(session.id, session.cwd, props.messageID, props.partID)
    if (metadata?.role !== "assistant") return
    if (metadata.partType === "text" && props.field === "text" && metadata.ignored !== true) {
      await this.input.connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: props.messageID,
          content: {
            type: "text",
            text: props.delta,
          },
        },
      })
      return
    }

    if (metadata.partType === "reasoning" && props.field === "text") {
      await this.input.connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: "agent_thought_chunk",
          messageId: props.messageID,
          content: {
            type: "text",
            text: props.delta,
          },
        },
      })
    }
  }

  private async handleTodoUpdated(event: {
    properties: { sessionID: string; todos: Array<{ content: string; status: string; priority: string }> }
  }) {
    const { sessionID, todos } = event.properties
    const entries = todos.map((todo) => ({
      content: todo.content,
      priority: todo.priority as "high" | "medium" | "low",
      status: todo.status as "pending" | "in_progress" | "completed" | "cancelled",
    }))

    if (this.input.isV2?.()) {
      await this.input.connection.sessionUpdate({
        sessionId: sessionID,
        update: {
          sessionUpdate: "plan_update",
          plan: { type: "items", planId: "default", entries },
        },
      } as SessionNotification)
    } else {
      await this.input.connection.sessionUpdate({
        sessionId: sessionID,
        update: {
          sessionUpdate: "plan",
          entries,
        },
      } as SessionNotification)
    }
  }

  private async fetchPartMetadata(sessionId: string, cwd: string, messageId: string, partId: string) {
    const message = await this.input.sdk.session
      .message(
        {
          sessionID: sessionId,
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
    return await this.recordFetchedPart(sessionId, message, part)
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

  private async handleToolPart(sessionId: string, part: ToolPart, cwd: string) {
    await this.toolStart(sessionId, part, cwd)

    switch (part.state.status) {
      case "pending":
        this.shellSnapshots.delete(part.callID)
        return

      case "running":
        await this.runningTool(sessionId, part, cwd)
        return

      case "completed":
        this.clearTool(part.callID)
        await this.input.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            ...this.v2ToolUpdate(
              completedToolUpdate({
                toolCallId: part.callID,
                toolName: part.tool,
                state: part.state,
                cwd,
              }),
            ),
          },
        })
        if (this.input.isV2?.() && isShellTool(part.tool)) {
          await this.emitTerminalUpdate(
            sessionId,
            part,
            cwd,
            shellOutputSnapshot(part.state) ?? part.state.output,
            true,
          )
        }
        return

      case "error":
        this.clearTool(part.callID)
        await this.input.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            ...this.v2ToolUpdate(
              errorToolUpdate({
                toolCallId: part.callID,
                toolName: part.tool,
                state: part.state,
                cwd,
              }),
            ),
          },
        })
        return
    }
  }

  private async runningTool(sessionId: string, part: ToolPart, cwd: string) {
    if (part.state.status !== "running") return

    const output = part.tool === "bash" ? shellOutputSnapshot(part.state) : undefined
    if (output !== undefined) {
      if (this.shellSnapshots.get(part.callID) === output) {
        await this.input.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            ...duplicateRunningToolUpdate({
              toolCallId: part.callID,
              toolName: part.tool,
              state: part.state,
              cwd,
            }),
          },
        })
        return
      }
      this.shellSnapshots.set(part.callID, output)
    }

    await this.input.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        ...runningToolUpdate({
          toolCallId: part.callID,
          toolName: part.tool,
          state: part.state,
          output,
          cwd,
        }),
      },
    })

    if (this.input.isV2?.() && isShellTool(part.tool)) {
      await this.emitTerminalUpdate(sessionId, part, cwd, output, false)
    }
  }

  private async toolStart(sessionId: string, part: ToolPart, cwd: string) {
    if (this.toolStarts.has(part.callID)) return
    this.toolStarts.add(part.callID)
    // v2: the first tool_call_update for an unseen toolCallId creates the tool call.
    // v1: a separate tool_call notification creates it, then tool_call_update patches it.
    const toolCall = pendingToolCall({
      toolCallId: part.callID,
      toolName: part.tool,
      state: part.state,
      cwd,
    })
    // v2: the first tool_call_update for an unseen toolCallId creates the tool call.
    // v1: a separate tool_call notification creates it, then tool_call_update patches it.
    await this.input.connection.sessionUpdate({
      sessionId,
      update: this.input.isV2?.()
        ? { sessionUpdate: "tool_call_update", ...toolCall }
        : { sessionUpdate: "tool_call", ...toolCall },
    })
  }

  private clearTool(toolCallId: string) {
    this.toolStarts.delete(toolCallId)
    this.shellSnapshots.delete(toolCallId)
  }

  private v2ToolUpdate(update: { content?: ToolCallContent[] | null; toolCallId: string; [key: string]: unknown }) {
    if (!this.input.isV2?.() || !update.content) return update
    return { ...update, content: update.content.map(v2DiffContent) }
  }

  private async emitTerminalUpdate(
    sessionId: string,
    part: ToolPart,
    cwd: string,
    output: string | undefined,
    exited: boolean,
  ) {
    const input = part.state.input as Record<string, unknown>
    const command = stringValue(input.command) ?? stringValue(input.cmd) ?? part.tool
    const terminalUpdate: Record<string, unknown> = {
      terminalId: part.callID,
      command,
      cwd,
    }
    if (output !== undefined) {
      terminalUpdate.output = { data: Buffer.from(output).toString("base64") }
    }
    if (exited) {
      const metadata = ("metadata" in part.state ? part.state.metadata : undefined) as
        Record<string, unknown> | undefined
      const exitCode = typeof metadata?.exit === "number" ? metadata.exit : 0
      terminalUpdate.exitStatus = { exitCode }
    }
    await this.input.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "terminal_update",
        ...terminalUpdate,
      },
    } as unknown as SessionNotification)
  }
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

function v2DiffContent(content: ToolCallContent): ToolCallContent {
  if (!("type" in content) || content.type !== "diff") return content
  const v1Diff = content as unknown as { type: "diff"; path: string; oldText: string; newText: string }
  if (!v1Diff.path) return content
  if (typeof v1Diff.oldText !== "string" || typeof v1Diff.newText !== "string") return content

  const raw = createTwoFilesPatch(v1Diff.path, v1Diff.path, v1Diff.oldText, v1Diff.newText, undefined, undefined, {
    context: 3,
  })
  // createTwoFilesPatch emits "Index:" and a "===" separator line that are not
  // part of git_patch format. Body lines always start with ' ', '+', or '-',
  // so filtering "=======" is safe.
  const hunks = raw
    .split("\n")
    .filter((line) => !line.startsWith("Index: ") && !line.startsWith("======="))
    .join("\n")
  const patchText = `diff --git a/${v1Diff.path} b/${v1Diff.path}\n${hunks}`

  return {
    type: "diff",
    changes: [
      {
        operation: "modify",
        path: v1Diff.path,
        fileType: "text",
      },
    ],
    patch: {
      format: "git_patch",
      text: patchText,
    },
  } as unknown as ToolCallContent
}

function isShellTool(toolName: string) {
  const tool = toolName.toLocaleLowerCase()
  return tool === "bash" || tool === "shell"
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}
