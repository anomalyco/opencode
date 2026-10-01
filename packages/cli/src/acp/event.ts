import type { PromptResponse, SessionUpdate } from "@agentclientprotocol/sdk"
import type {
  EventSubscribeOutput,
  OpenCodeClient,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionStructuredError,
  TokenUsageInfo,
} from "@opencode/client/promise"
import { Event } from "@opencode/schema/event"
import { SessionMessage } from "@opencode/schema/session-message"
import { TokenUsage } from "@opencode/schema/token-usage"
import type { ACPConnection } from "./connection"
import { partsToContentChunks, type ReplayPart } from "./content"
import { ACPError } from "./error"
import { replyPermission } from "./permission"
import {
  completedToolUpdate,
  errorToolUpdate,
  pendingToolCall,
  runningToolUpdate,
  type ToolContent,
  type ToolInput,
} from "./tool"

type Connection = Pick<ACPConnection.Connection, "sessionUpdate" | "requestPermission">

export type TurnControl = {
  cancelled: boolean
  // Aborted whenever the turn is cancelled or closed, so it also cancels the turn's outbound client requests.
  readonly admission: AbortController
}

type ToolState = {
  readonly name: string
  input: ToolInput
  metadata: Record<string, unknown>
  content: ToolContent
}

export type TurnStart =
  | { readonly type: "input"; readonly id: string }
  | { readonly type: "skill"; readonly id: string }
  | { readonly type: "compaction"; readonly id: string }

export const ChildSessionUpdatesCapability = "opencode/child-session-updates"
export const ChildSessionUpdateMethod = "opencode/session/child_update"
const RetryMeta = "opencode/retry"
const CompactionMeta = "opencode/compaction"

type RetryStatus = {
  readonly attempt: number
  readonly nextRetryAt: string
  readonly error: SessionStructuredError
}

type CompactionMarker = {
  readonly status: "started" | "completed" | "failed"
  readonly messageId: string
  readonly reason: "auto" | "manual"
  readonly error?: SessionStructuredError
}

type CompactionEvent = Extract<
  EventSubscribeOutput,
  { readonly type: "session.compaction.started" | "session.compaction.ended" | "session.compaction.failed" }
>

type ChildSessionUpdateBase = {
  readonly rootSessionId: string
  readonly childSessionId: string
  readonly parentSessionId: string
  readonly depth: number
  readonly title?: string
}

type ChildSessionEvent =
  | { readonly type: "update"; readonly update: SessionUpdate }
  | {
      readonly type: "status"
      readonly status: "created" | "running" | "completed" | "failed" | "interrupted"
      readonly error?: { readonly type: string; readonly message: string }
    }

export type ChildSessionUpdate = ChildSessionUpdateBase & ChildSessionEvent

type ChildSession = {
  readonly id: string
  readonly parentID: string
  readonly depth: number
  readonly title?: string
}

function emptyToolState(): ToolState {
  return { name: "tool", input: {}, metadata: {}, content: [] }
}

export async function streamTurn(input: {
  readonly client: OpenCodeClient
  readonly connection: Connection
  readonly sessionID: string
  readonly cwd: string
  readonly start: TurnStart
  readonly action?: boolean
  readonly submit: (signal: AbortSignal) => Promise<unknown>
  readonly control: TurnControl
  readonly childSessionUpdate?: (update: ChildSessionUpdate) => Promise<void>
  readonly connectionSignal?: AbortSignal
  readonly sessionSignal?: AbortSignal
}): Promise<{ readonly response: PromptResponse; readonly contextTokens: number | undefined }> {
  const streamController = new AbortController()
  const connectionAbort = () => streamController.abort()
  input.connectionSignal?.addEventListener("abort", connectionAbort, { once: true })
  const stream = input.client.event.subscribe({ signal: streamController.signal })[Symbol.asyncIterator]()
  const connected = await stream.next()
  if (connected.done) throw new Error("event stream disconnected before prompt admission")

  const control = input.control
  let started = false
  let finish: SessionMessageAssistant["finish"]
  let executionError: { readonly type: string; readonly message: string } | undefined
  let stepError: SessionStructuredError | undefined
  let usage: { readonly turn: TokenUsageInfo; readonly last: TokenUsageInfo } | undefined
  const tools = new Map<string, ToolState>()
  const retries = new Map<string, RetryStatus>()
  const compactions = new Map<string, string>()
  const children = new Map<string, ChildSession>()
  const openChildren = new Set<string>()
  let handedOff = false

  const recordStep = (tokens: TokenUsageInfo) => {
    const turn = usage?.turn
    usage = {
      turn: turn
        ? {
            input: turn.input + tokens.input,
            output: turn.output + tokens.output,
            reasoning: turn.reasoning + tokens.reasoning,
            cache: { read: turn.cache.read + tokens.cache.read, write: turn.cache.write + tokens.cache.write },
          }
        : tokens,
      last: tokens,
    }
  }

  const notifyChild = async (child: ChildSession, value: ChildSessionEvent) => {
    if (!input.childSessionUpdate) return
    await input
      .childSessionUpdate({
        rootSessionId: input.sessionID,
        childSessionId: child.id,
        parentSessionId: child.parentID,
        depth: child.depth,
        ...(child.title ? { title: child.title } : {}),
        ...value,
      })
      .catch(() => {})
  }

  const updateSession = async (value: SessionUpdate, child: ChildSession | undefined, mode: "turn" | "background") => {
    const projected = child ? projectChildUpdate(value, child) : value
    if (mode === "turn" && (!child || !input.childSessionUpdate)) {
      await input.connection.sessionUpdate({ sessionId: input.sessionID, update: projected })
    }
    if (child) await notifyChild(child, { type: "update", update: projected })
  }

  const consume = async (mode: "turn" | "background") => {
    while (!streamController.signal.aborted) {
      const next = await stream.next()
      if (next.done) throw new Error("event stream disconnected during prompt execution")
      const event = next.value
      if (event.type === "session.created") {
        const parentID = event.data.parentID
        if (!parentID) continue
        const parent = parentID === input.sessionID ? undefined : children.get(parentID)
        if ((mode === "turn" && parentID === input.sessionID) || parent) {
          const child = {
            id: event.data.sessionID,
            parentID,
            depth: parent ? parent.depth + 1 : 1,
            title: event.data.title,
          }
          children.set(child.id, child)
          openChildren.add(child.id)
          await notifyChild(child, { type: "status", status: "created" })
        }
        continue
      }

      const eventSessionID = sessionIDFromEvent(event)
      const child = eventSessionID ? children.get(eventSessionID) : undefined
      const send = (update: SessionUpdate) => updateSession(update, child, mode)
      if (mode === "background" && !child) continue

      if (event.type === "permission.asked" && (event.data.sessionID === input.sessionID || child)) {
        const tool = event.data.source?.id ? tools.get(toolKey(event.data.sessionID, event.data.source.id)) : undefined
        await replyPermission({
          client: input.client,
          connection: input.connection,
          event,
          sessionID: event.data.sessionID,
          clientSessionID: input.sessionID,
          cwd: input.cwd,
          tool,
          signal: control.admission.signal,
          ...(child ? { toolCallPrefix: child.id, titlePrefix: child.title } : {}),
        })
        continue
      }
      if (event.type === "form.created" && (event.data.form.sessionID === input.sessionID || child)) {
        await input.client.session.form
          .cancel({ sessionID: event.data.form.sessionID, formID: event.data.form.id })
          .catch(() => input.client.session.interrupt({ sessionID: event.data.form.sessionID }).catch(() => {}))
        continue
      }
      if (!eventSessionID || (eventSessionID !== input.sessionID && !child)) continue
      if (matchesStart(event, input.start)) {
        started = true
        continue
      }
      if (!started) continue

      if (event.type === "session.execution.started") {
        if (child) {
          await notifyChild(child, { type: "status", status: "running" })
        }
        continue
      }

      if (event.type === "session.step.started") {
        if (!child) stepError = undefined
        if (retries.delete(eventSessionID))
          await send({ sessionUpdate: "session_info_update", _meta: { [RetryMeta]: null } })
        continue
      }
      if (event.type === "session.retry.scheduled") {
        const retry = {
          attempt: event.data.attempt,
          nextRetryAt: new Date(event.data.at).toISOString(),
          error: event.data.error,
        }
        retries.set(eventSessionID, retry)
        await send({ sessionUpdate: "session_info_update", _meta: { [RetryMeta]: retry } })
        continue
      }
      if (
        event.type === "session.compaction.started" ||
        event.type === "session.compaction.ended" ||
        event.type === "session.compaction.failed"
      ) {
        const marker = compactionMarker(event, compactions)
        if (marker) await send(compactionUpdate(marker))
        continue
      }
      if (event.type === "session.text.delta") {
        await send({
          sessionUpdate: "agent_message_chunk",
          messageId: event.data.assistantMessageID,
          content: { type: "text", text: event.data.delta },
        })
        continue
      }
      if (event.type === "session.reasoning.delta") {
        await send({
          sessionUpdate: "agent_thought_chunk",
          messageId: `${event.data.assistantMessageID}:reasoning:${event.data.ordinal}`,
          content: { type: "text", text: event.data.delta },
        })
        continue
      }
      if (event.type === "session.tool.input.started") {
        tools.set(toolKey(event.data.sessionID, event.data.id), {
          name: event.data.name,
          input: {},
          metadata: {},
          content: [],
        })
        await send({
          sessionUpdate: "tool_call",
          ...pendingToolCall({
            toolCallId: event.data.id,
            toolName: event.data.name,
            state: { input: {} },
            cwd: input.cwd,
          }),
        })
        continue
      }
      if (event.type === "session.tool.called") {
        const key = toolKey(event.data.sessionID, event.data.id)
        const current = tools.get(key) ?? emptyToolState()
        current.input = event.data.input
        tools.set(key, current)
        await send({
          sessionUpdate: "tool_call_update",
          ...runningToolUpdate({
            toolCallId: event.data.id,
            toolName: current.name,
            state: { input: current.input },
            cwd: input.cwd,
          }),
        })
        continue
      }
      if (event.type === "session.tool.progress") {
        const current = tools.get(toolKey(event.data.sessionID, event.data.id))
        if (!current) continue
        current.metadata = event.data.metadata
        await send({
          sessionUpdate: "tool_call_update",
          ...runningToolUpdate({
            toolCallId: event.data.id,
            toolName: current.name,
            state: { input: current.input },
            cwd: input.cwd,
          }),
        })
        continue
      }
      if (event.type === "session.tool.success") {
        const key = toolKey(event.data.sessionID, event.data.id)
        const current = tools.get(key) ?? emptyToolState()
        tools.delete(key)
        await send({
          sessionUpdate: "tool_call_update",
          ...completedToolUpdate({
            toolCallId: event.data.id,
            toolName: current.name,
            input: current.input,
            metadata: event.data.metadata,
            content: event.data.content,
            cwd: input.cwd,
          }),
        })
        continue
      }
      if (event.type === "session.tool.failed") {
        const key = toolKey(event.data.sessionID, event.data.id)
        const current = tools.get(key) ?? emptyToolState()
        tools.delete(key)
        await send({
          sessionUpdate: "tool_call_update",
          ...errorToolUpdate({
            toolCallId: event.data.id,
            toolName: current.name,
            input: current.input,
            metadata: event.data.metadata ?? current.metadata,
            content: event.data.content ?? current.content,
            error: event.data.error.message,
            cwd: input.cwd,
          }),
        })
        continue
      }
      if (event.type === "session.step.ended") {
        if (!child) {
          finish = event.data.finish
          recordStep(event.data.tokens)
        }
        continue
      }
      if (event.type === "session.step.failed") {
        if (!child) {
          stepError = event.data.error
          if (event.data.tokens) recordStep(event.data.tokens)
        }
        continue
      }
      if (event.type === "session.execution.succeeded") {
        if (!child) return "succeeded" as const
        openChildren.delete(child.id)
        await notifyChild(child, { type: "status", status: "completed" })
        if (mode === "background" && openChildren.size === 0) return "succeeded" as const
        continue
      }
      if (event.type === "session.execution.interrupted") {
        if (!child) return "interrupted" as const
        openChildren.delete(child.id)
        await notifyChild(child, { type: "status", status: "interrupted" })
        if (mode === "background" && openChildren.size === 0) return "interrupted" as const
        continue
      }
      if (event.type === "session.execution.failed") {
        if (child) {
          openChildren.delete(child.id)
          await notifyChild(child, { type: "status", status: "failed", error: event.data.error })
          if (mode === "background" && openChildren.size === 0) return "failed" as const
          continue
        }
        executionError = event.data.error
        return "failed" as const
      }
    }
    return "interrupted" as const
  }

  const completed = consume("turn")
  const closeStream = async () => {
    streamController.abort()
    input.connectionSignal?.removeEventListener("abort", connectionAbort)
    input.sessionSignal?.removeEventListener("abort", connectionAbort)
    await stream.return?.(undefined).catch(() => {})
  }
  try {
    await input.submit(control.admission.signal).catch((error) => {
      if (!control.cancelled) throw error
    })
    if (input.action) {
      streamController.abort()
      await completed.catch(() => {})
      return {
        response: response(undefined, undefined, "succeeded", control.cancelled, undefined),
        contextTokens: undefined,
      }
    }
    if (control.cancelled) {
      await input.client.session.interrupt({ sessionID: input.sessionID }).catch(() => {})
      if (!started) {
        streamController.abort()
        await completed.catch(() => {})
        return { response: response(undefined, undefined, "interrupted", true, undefined), contextTokens: undefined }
      }
    }
    const terminal = await completed
    if (input.childSessionUpdate && openChildren.size > 0 && !input.sessionSignal?.aborted) {
      handedOff = true
      input.sessionSignal?.addEventListener("abort", connectionAbort, { once: true })
      void consume("background")
        .catch(() => {})
        .finally(closeStream)
    }
    return {
      response: response(
        usage?.turn,
        stepError ?? executionError,
        terminal,
        control.cancelled,
        finish,
        retries.get(input.sessionID),
      ),
      contextTokens: usage ? TokenUsage.total(usage.last) : undefined,
    }
  } catch (error) {
    streamController.abort()
    await completed.catch(() => {})
    throw error
  } finally {
    if (!handedOff) await closeStream()
  }
}

function sessionIDFromEvent(event: EventSubscribeOutput) {
  if ("sessionID" in event.data && typeof event.data.sessionID === "string") return event.data.sessionID
  if (event.type === "form.created") return event.data.form.sessionID
  return undefined
}

function toolKey(sessionID: string, id: string) {
  return `${sessionID}:${id}`
}

// Message IDs follow core's compaction message projection, so live markers match replayed ones.
function compactionMarker(event: CompactionEvent, compactions: Map<string, string>): CompactionMarker | undefined {
  const sessionID = event.data.sessionID
  if (event.type === "session.compaction.started") {
    const messageId = event.data.inputID ?? SessionMessage.ID.fromEvent(Event.ID.make(event.id))
    compactions.set(sessionID, messageId)
    return { status: "started", messageId, reason: event.data.reason }
  }
  const tracked = compactions.get(sessionID)
  compactions.delete(sessionID)
  if (event.type === "session.compaction.ended")
    return tracked ? { status: "completed", messageId: tracked, reason: event.data.reason } : undefined
  // Automatic compaction can fail before it starts, for example when there is nothing to compact yet.
  return {
    status: "failed",
    messageId: tracked ?? event.data.inputID ?? SessionMessage.ID.fromEvent(Event.ID.make(event.id)),
    reason: event.data.reason,
    error: event.data.error,
  }
}

function compactionUpdate(marker: CompactionMarker): SessionUpdate {
  return { sessionUpdate: "session_info_update", _meta: { [CompactionMeta]: marker } }
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

export async function replayMessages(
  connection: Pick<Connection, "sessionUpdate">,
  sessionID: string,
  cwd: string,
  messages: readonly SessionMessageInfo[],
) {
  for (const message of messages) await replayMessage(connection, sessionID, cwd, message).catch(() => {})
}

async function replayMessage(
  connection: Pick<Connection, "sessionUpdate">,
  sessionID: string,
  cwd: string,
  message: SessionMessageInfo,
) {
  if (message.type === "user") {
    await connection.sessionUpdate({
      sessionId: sessionID,
      update: {
        sessionUpdate: "user_message_chunk",
        messageId: message.id,
        content: { type: "text", text: message.text },
      },
    })
    const files: ReplayPart[] = (message.files ?? []).map((file) => ({
      type: "file",
      url: file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`,
      filename: file.name,
      mime: file.mime,
    }))
    for (const chunk of partsToContentChunks(files)) {
      await connection.sessionUpdate({
        sessionId: sessionID,
        update: { sessionUpdate: "user_message_chunk", messageId: message.id, ...chunk },
      })
    }
    return
  }
  // A running compaction has no live turn on this connection to settle it, so replay only settled ones.
  if (message.type === "compaction" && message.status !== "running") {
    await connection.sessionUpdate({
      sessionId: sessionID,
      update: compactionUpdate({
        status: message.status,
        messageId: message.id,
        reason: message.reason,
        ...(message.status === "failed" ? { error: message.error } : {}),
      }),
    })
    return
  }
  if (message.type !== "assistant") return
  // Live reasoning ordinals count only reasoning parts, not the mixed content array.
  let reasoningOrdinal = 0
  for (const part of message.content) {
    if (part.type === "text") {
      await connection.sessionUpdate({
        sessionId: sessionID,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: message.id,
          content: { type: "text", text: part.text },
        },
      })
      continue
    }
    if (part.type === "reasoning") {
      await connection.sessionUpdate({
        sessionId: sessionID,
        update: {
          sessionUpdate: "agent_thought_chunk",
          messageId: `${message.id}:reasoning:${reasoningOrdinal++}`,
          content: { type: "text", text: part.text },
        },
      })
      continue
    }
    await connection.sessionUpdate({
      sessionId: sessionID,
      update: {
        sessionUpdate: "tool_call",
        ...pendingToolCall({
          toolCallId: part.id,
          toolName: part.name,
          state: { input: part.state.status === "streaming" ? {} : part.state.input },
          cwd,
        }),
      },
    })
    switch (part.state.status) {
      case "completed":
        await connection.sessionUpdate({
          sessionId: sessionID,
          update: {
            sessionUpdate: "tool_call_update",
            ...completedToolUpdate({
              toolCallId: part.id,
              toolName: part.name,
              input: part.state.input,
              metadata: part.state.metadata,
              content: part.state.content,
              cwd,
            }),
          },
        })
        break
      case "running":
        await connection.sessionUpdate({
          sessionId: sessionID,
          update: {
            sessionUpdate: "tool_call_update",
            ...runningToolUpdate({
              toolCallId: part.id,
              toolName: part.name,
              state: { input: part.state.input },
              cwd,
            }),
          },
        })
        break
      case "error":
        await connection.sessionUpdate({
          sessionId: sessionID,
          update: {
            sessionUpdate: "tool_call_update",
            ...errorToolUpdate({
              toolCallId: part.id,
              toolName: part.name,
              input: part.state.input,
              metadata: part.state.metadata,
              content: part.state.content,
              error: part.state.error.message,
              cwd,
            }),
          },
        })
        break
      case "streaming":
        break
    }
  }
}

function matchesStart(event: EventSubscribeOutput, start: TurnStart) {
  if (start.type === "input") return event.type === "session.inbox.delivered" && event.data.inboxID === start.id
  if (start.type === "compaction") return event.type === "session.inbox.delivered" && event.data.inboxID === start.id
  return event.type === "session.skill.activated" && event.id === start.id.replace(/^msg_/, "evt_")
}

function response(
  tokens: TokenUsageInfo | undefined,
  error: { readonly type: string; readonly message: string } | undefined,
  terminal: "succeeded" | "failed" | "interrupted",
  cancelled: boolean,
  finish: SessionMessageAssistant["finish"],
  retry?: RetryStatus,
): PromptResponse {
  if (error?.type === "provider.auth") throw new ACPError.AuthRequiredError()
  if (error && error.type !== "aborted" && error.type !== "provider.content-filter") {
    throw new ACPError.ServiceFailureError({
      safeMessage: error.message || "OpenCode prompt failed",
      service: "session",
      errorName: error.type,
    })
  }
  const usage = tokens
    ? {
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        totalTokens: TokenUsage.total(tokens),
        ...(tokens.reasoning > 0 ? { thoughtTokens: tokens.reasoning } : {}),
        ...(tokens.cache.read > 0 ? { cachedReadTokens: tokens.cache.read } : {}),
        ...(tokens.cache.write > 0 ? { cachedWriteTokens: tokens.cache.write } : {}),
      }
    : undefined
  const stopReason = resolveStopReason({ terminal, cancelled, finish, error: error?.type })
  // Only an interrupt during backoff leaves a retry pending. Interruption clears the projected retry, so report it here.
  return { stopReason, ...(usage ? { usage } : {}), _meta: retry ? { [RetryMeta]: retry } : {} }
}

function resolveStopReason(input: {
  readonly terminal: "succeeded" | "failed" | "interrupted"
  readonly cancelled: boolean
  readonly finish: SessionMessageAssistant["finish"]
  readonly error?: string
}): PromptResponse["stopReason"] {
  if (input.cancelled || input.terminal === "interrupted" || input.error === "aborted") return "cancelled"
  if (input.finish === "length") return "max_tokens"
  if (input.finish === "content-filter" || input.error === "provider.content-filter") return "refusal"
  return "end_turn"
}

export * as ACPEvent from "./event"
