import type { AgentSideConnection, PlanEntry } from "@agentclientprotocol/sdk"
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

export function start(input: { sdk: OpencodeClient; connection: Connection; session: ACPSession.Interface }) {
  const subscription = new Subscription(input)
  subscription.start()
  return subscription
}

export class Subscription {
  private readonly abort = new AbortController()
  private readonly shellSnapshots = new Map<string, string>()
  private readonly toolStarts = new Set<string>()
  private readonly lastPlanBySession = new Map<string, PlanEntry[]>()
  private readonly lastPlanFingerprintBySession = new Map<string, string>()
  private readonly everInProgressBySession = new Map<string, Set<string>>()
  private readonly permission: ACPPermission.Handler
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
  }

  async handle(event: Event) {
    switch (event.type) {
      case "permission.asked":
        this.permission.handle(event)
        return
      case "message.part.updated":
        return this.handlePartUpdated(event)
      case "message.part.delta":
        return this.handlePartDelta(event)
      case "todo.updated":
        return this.handleTodoUpdated(event)
      case "session.idle":
        return this.handleSessionIdle(event)
    }
  }

  async replayMessage(message: SessionMessageResponse) {
    if (message.info.role !== "assistant" && message.info.role !== "user") return

    for (const part of message.parts) {
      await this.recordFetchedPart(message.info.sessionID, message, part)
      if (part.type === "tool") {
        await this.handleToolPart(message.info.sessionID, part)
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
      const events = (await this.input.sdk.global.event({
        signal: this.abort.signal,
      })) as GlobalEventStream

      for await (const event of events.stream) {
        if (this.abort.signal.aborted) return
        if (!event.payload) continue
        await this.handle(event.payload).catch(() => {})
      }
      if (!this.abort.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1000))
    }
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
      await this.handleToolPart(session.id, part)
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

  private async handleToolPart(sessionId: string, part: ToolPart) {
    await this.toolStart(sessionId, part)

    switch (part.state.status) {
      case "pending":
        this.shellSnapshots.delete(part.callID)
        return

      case "running":
        await this.runningTool(sessionId, part)
        return

      case "completed":
        this.clearTool(part.callID)
        await this.input.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            ...completedToolUpdate({
              toolCallId: part.callID,
              toolName: part.tool,
              state: part.state,
            }),
          },
        })
        return

      case "error":
        this.clearTool(part.callID)
        await this.input.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            ...errorToolUpdate({
              toolCallId: part.callID,
              toolName: part.tool,
              state: part.state,
            }),
          },
        })
        return
    }
  }

  private async runningTool(sessionId: string, part: ToolPart) {
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
        }),
      },
    })
  }

  private async toolStart(sessionId: string, part: ToolPart) {
    if (this.toolStarts.has(part.callID)) return
    this.toolStarts.add(part.callID)
    await this.input.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        ...pendingToolCall({
          toolCallId: part.callID,
          toolName: part.tool,
          state: part.state,
        }),
      },
    })
  }

  private clearTool(toolCallId: string) {
    this.toolStarts.delete(toolCallId)
    this.shellSnapshots.delete(toolCallId)
  }

  private async handleTodoUpdated(event: Extract<Event, { type: "todo.updated" }>) {
    const sessionId = event.properties.sessionID
    const session = await Effect.runPromise(this.input.session.tryGet(sessionId))
    if (!session) return
    const entries = event.properties.todos.flatMap((todo) => {
      const entry = toPlanEntry(todo)
      return entry ? [entry] : []
    })

    const everStarted = this.everInProgressBySession.get(sessionId) ?? new Set<string>()
    for (const entry of entries) {
      if (entry.status === "in_progress") everStarted.add(entry.content)
    }
    if (everStarted.size > 0) this.everInProgressBySession.set(sessionId, everStarted)

    await this.sendPlan(sessionId, entries)
  }

  // When a turn ends, any entry the agent ever started during the session
  // should be considered done — either it really was finished (model forgot to
  // mark it completed) or the model demoted it back to pending without
  // updating it again before stopping. Both render as a non-checked item in
  // ACP clients, which contradicts the visible reality that work stopped.
  // Genuinely planned-but-never-started entries (status: pending and never
  // in_progress) are left alone so future plans still render correctly.
  private async handleSessionIdle(event: Extract<Event, { type: "session.idle" }>) {
    const sessionId = event.properties.sessionID
    const previous = this.lastPlanBySession.get(sessionId)
    if (!previous) return
    const everStarted = this.everInProgressBySession.get(sessionId)
    if (!everStarted || everStarted.size === 0) return
    if (!previous.some((entry) => everStarted.has(entry.content) && entry.status !== "completed")) {
      return
    }
    const next = previous.map((entry) =>
      everStarted.has(entry.content) && entry.status !== "completed"
        ? { ...entry, status: "completed" as const }
        : entry,
    )
    await this.sendPlan(sessionId, next)
  }

  private async sendPlan(sessionId: string, entries: PlanEntry[]) {
    const fingerprint = JSON.stringify(entries)
    if (this.lastPlanFingerprintBySession.get(sessionId) === fingerprint) return
    this.lastPlanFingerprintBySession.set(sessionId, fingerprint)
    this.lastPlanBySession.set(sessionId, entries)
    await this.input.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "plan",
        entries,
      },
    })
  }
}

// opencode's todowrite allows a "cancelled" status and free-form priority;
// ACP's PlanEntry only models pending/in_progress/completed and high/medium/low,
// so collapse cancelled into completed and default unknown priorities to medium.
function toPlanEntry(raw: unknown): PlanEntry | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const todo = raw as { content?: unknown; status?: unknown; priority?: unknown }
  if (typeof todo.content !== "string" || todo.content.length === 0) return undefined
  return {
    content: todo.content,
    status:
      todo.status === "in_progress"
        ? "in_progress"
        : todo.status === "completed" || todo.status === "cancelled"
          ? "completed"
          : "pending",
    priority: todo.priority === "high" || todo.priority === "low" ? todo.priority : "medium",
  }
}

export * as ACPEvent from "./event"
