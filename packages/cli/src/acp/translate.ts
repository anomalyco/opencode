import type { PromptResponse, SessionUpdate } from "@agentclientprotocol/sdk"
import type { OpenCodeEvent } from "@opencode/client/effect"
import type { Session } from "@opencode/schema/session"
import type { SessionError } from "@opencode/schema/session-error"
import type { SessionMessage } from "@opencode/schema/session-message"
import { TokenUsage } from "@opencode/schema/token-usage"
import { ACPChild } from "./child"
import { ACPCompaction } from "./compaction"
import { ACPError } from "./error"
import { completedToolUpdate, errorToolUpdate, pendingToolCall, runningToolUpdate, type ToolInput } from "./tool"

const RetryMeta = "opencode/retry"

export type TurnStart = { readonly type: "input" | "compaction"; readonly id: SessionMessage.ID }

export type Terminal = "succeeded" | "failed" | "interrupted"

export type TurnContext = {
  readonly sessionID: Session.ID
  readonly cwd: string
  readonly start: TurnStart
  readonly childUpdates: boolean
  readonly compaction: boolean
}

type Tool = {
  readonly sessionID: string
  readonly id: string
  readonly name: string
  readonly input: ToolInput
  readonly metadata: Record<string, unknown>
}

type RetryStatus = {
  readonly attempt: number
  readonly nextRetryAt: string
  readonly error: SessionError.Error
}

export type TurnState = {
  readonly started: boolean
  readonly tools: ReadonlyMap<string, Tool>
  readonly retries: ReadonlyMap<string, RetryStatus>
  readonly compactions: ACPCompaction.Tracked
  readonly children: ReadonlyMap<string, ACPChild.Session>
  readonly openChildren: ReadonlySet<string>
  readonly asks: ReadonlySet<string>
  readonly finish?: SessionMessage.Assistant["finish"]
  readonly usage?: { readonly turn: TokenUsage.Info; readonly last: TokenUsage.Info }
  readonly stepError?: SessionError.Error
  readonly executionError?: { readonly type: string; readonly message: string }
}

type PermissionEvent = Extract<OpenCodeEvent, { type: "permission.asked" }>
type FormEvent = Extract<OpenCodeEvent, { type: "form.created" }>
type CreatedEvent = Extract<OpenCodeEvent, { type: "session.created" }>

export type Output =
  | { readonly _tag: "SessionUpdate"; readonly update: SessionUpdate }
  | { readonly _tag: "ChildUpdate"; readonly update: ACPChild.Update }
  | {
      readonly _tag: "PermissionAsk"
      readonly event: PermissionEvent
      readonly tool?: Tool
      readonly child?: ACPChild.Session
    }
  | { readonly _tag: "FormAsk"; readonly form: FormEvent["data"]["form"]; readonly child?: ACPChild.Session }
  | { readonly _tag: "AskSettled"; readonly id: string }

export type Folded = {
  readonly state: TurnState
  readonly outputs: ReadonlyArray<Output>
  readonly terminal?: Terminal
}

export const initial: TurnState = {
  started: false,
  tools: new Map(),
  retries: new Map(),
  compactions: new Map(),
  children: new Map(),
  openChildren: new Set(),
  asks: new Set(),
}

export function fold(state: TurnState, event: OpenCodeEvent, ctx: TurnContext): Folded {
  if (event.type === "session.created") return childCreated(state, event, ctx)

  const sessionID = sessionIDFromEvent(event)
  const child = sessionID ? state.children.get(sessionID) : undefined

  if (event.type === "permission.asked" && (event.data.sessionID === ctx.sessionID || child)) {
    const tool = event.data.source?.id
      ? state.tools.get(toolKey(event.data.sessionID, event.data.source.id))
      : undefined
    return {
      state: { ...state, asks: new Set(state.asks).add(event.data.id) },
      outputs: [{ _tag: "PermissionAsk", event, tool, child }],
    }
  }
  if (event.type === "form.created" && (event.data.form.sessionID === ctx.sessionID || child)) {
    return {
      state: { ...state, asks: new Set(state.asks).add(event.data.form.id) },
      outputs: [{ _tag: "FormAsk", form: event.data.form, child }],
    }
  }
  const settledID =
    event.type === "permission.replied"
      ? event.data.requestID
      : event.type === "form.replied" || event.type === "form.cancelled"
        ? event.data.id
        : undefined
  if (settledID && state.asks.has(settledID)) {
    const asks = new Set(state.asks)
    asks.delete(settledID)
    return { state: { ...state, asks }, outputs: [{ _tag: "AskSettled", id: settledID }] }
  }
  if (!sessionID || (sessionID !== ctx.sessionID && !child)) return { state, outputs: [] }
  if (event.type === "session.inbox.delivered" && event.data.inboxID === ctx.start.id)
    return { state: { ...state, started: true }, outputs: [] }
  if (!state.started) return { state, outputs: [] }
  return child ? childEvent(state, event, ctx, child) : rootEvent(state, event, ctx)
}

export function fromTrackedChild(state: TurnState, event: OpenCodeEvent) {
  const sessionID = event.type === "session.created" ? event.data.parentID : sessionIDFromEvent(event)
  return sessionID !== undefined && state.children.has(sessionID)
}

export function failure(state: TurnState) {
  const error = state.stepError ?? state.executionError
  if (error?.type === "provider.auth") return new ACPError.AuthRequiredError()
  if (error && error.type !== "aborted" && error.type !== "provider.content-filter") {
    return new ACPError.ServiceFailureError({
      safeMessage: error.message || "OpenCode prompt failed",
      service: "session",
      errorName: error.type,
    })
  }
  return undefined
}

export function response(state: TurnState, sessionID: string, terminal: Terminal): PromptResponse {
  const tokens = state.usage?.turn
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
  const error = (state.stepError ?? state.executionError)?.type
  const stopReason = resolveStopReason({ terminal, finish: state.finish, error })
  // Interruption clears the projected retry, so a retry pending at interrupt is reported here.
  const retry = state.retries.get(sessionID)
  return { stopReason, ...(usage ? { usage } : {}), _meta: retry ? { [RetryMeta]: retry } : {} }
}

// Child compactions are left to the background consumer.
export function abandon(state: TurnState, ctx: TurnContext): Folded {
  const compaction = state.compactions.get(ctx.sessionID)
  return {
    state: { ...state, tools: new Map(), compactions: without(state.compactions, ctx.sessionID) },
    outputs: [
      ...[...state.tools.values()].flatMap((tool) =>
        route(ctx, state.children.get(tool.sessionID), {
          sessionUpdate: "tool_call_update",
          ...errorToolUpdate({
            toolCallId: tool.id,
            toolName: tool.name,
            input: tool.input,
            metadata: tool.metadata,
            content: [],
            error: "Cancelled",
            cwd: ctx.cwd,
          }),
        }),
      ),
      ...(compaction
        ? route(ctx, undefined, ACPCompaction.abandon(compaction, ACPCompaction.usesStandardUpdates(ctx, false)))
        : []),
    ],
  }
}

export function reasoningMessageID(messageID: string, ordinal: number) {
  return `${messageID}:reasoning:${ordinal}`
}

function childCreated(state: TurnState, event: CreatedEvent, ctx: TurnContext): Folded {
  const parentID = event.data.parentID
  if (!parentID) return { state, outputs: [] }
  const parent = parentID === ctx.sessionID ? undefined : state.children.get(parentID)
  if (!parent && parentID !== ctx.sessionID) return { state, outputs: [] }
  const child = { id: event.data.sessionID, parentID, depth: parent ? parent.depth + 1 : 1, title: event.data.title }
  return {
    state: {
      ...state,
      children: new Map(state.children).set(child.id, child),
      openChildren: new Set(state.openChildren).add(child.id),
    },
    outputs: childStatus(ctx, child, { type: "status", status: "created" }),
  }
}

function rootEvent(state: TurnState, event: OpenCodeEvent, ctx: TurnContext): Folded {
  switch (event.type) {
    case "session.step.started":
      return sessionEvent({ ...state, stepError: undefined }, event, ctx, undefined)
    case "session.step.ended":
      return { state: { ...recordStep(state, event.data.tokens), finish: event.data.finish }, outputs: [] }
    case "session.step.failed": {
      const recorded = event.data.tokens ? recordStep(state, event.data.tokens) : state
      return { state: { ...recorded, stepError: event.data.error }, outputs: [] }
    }
    case "session.execution.succeeded":
      return { state, outputs: [], terminal: "succeeded" }
    case "session.execution.interrupted":
      return { state, outputs: [], terminal: "interrupted" }
    case "session.execution.failed":
      return { state: { ...state, executionError: event.data.error }, outputs: [], terminal: "failed" }
    default:
      return sessionEvent(state, event, ctx, undefined)
  }
}

function childEvent(state: TurnState, event: OpenCodeEvent, ctx: TurnContext, child: ACPChild.Session): Folded {
  switch (event.type) {
    case "session.execution.started":
      return { state, outputs: childStatus(ctx, child, { type: "status", status: "running" }) }
    case "session.execution.succeeded":
      return childEnded(state, ctx, child, { type: "status", status: "completed" })
    case "session.execution.interrupted":
      return childEnded(state, ctx, child, { type: "status", status: "interrupted" })
    case "session.execution.failed":
      return childEnded(state, ctx, child, { type: "status", status: "failed", error: event.data.error })
    default:
      return sessionEvent(state, event, ctx, child)
  }
}

function sessionEvent(
  state: TurnState,
  event: OpenCodeEvent,
  ctx: TurnContext,
  child: ACPChild.Session | undefined,
): Folded {
  const sessionID = child?.id ?? ctx.sessionID
  const send = (update: SessionUpdate) => route(ctx, child, update)
  switch (event.type) {
    case "session.step.started":
      if (!state.retries.has(sessionID)) return { state, outputs: [] }
      return {
        state: { ...state, retries: without(state.retries, sessionID) },
        outputs: send({ sessionUpdate: "session_info_update", _meta: { [RetryMeta]: null } }),
      }
    case "session.retry.scheduled": {
      const retry = {
        attempt: event.data.attempt,
        nextRetryAt: new Date(event.data.at).toISOString(),
        error: event.data.error,
      }
      return {
        state: { ...state, retries: new Map(state.retries).set(sessionID, retry) },
        outputs: send({ sessionUpdate: "session_info_update", _meta: { [RetryMeta]: retry } }),
      }
    }
    case "session.compaction.started":
    case "session.compaction.ended":
    case "session.compaction.failed": {
      const applied = ACPCompaction.apply(
        event,
        state.compactions,
        ACPCompaction.usesStandardUpdates(ctx, child !== undefined),
      )
      return { state: { ...state, compactions: applied.tracked }, outputs: applied.updates.flatMap(send) }
    }
    case "session.compaction.delta": {
      const update = ACPCompaction.chunk(
        state.compactions.get(sessionID),
        event.data.text,
        ACPCompaction.usesStandardUpdates(ctx, child !== undefined),
      )
      return { state, outputs: update ? send(update) : [] }
    }
    case "session.text.delta":
      return {
        state,
        outputs: send({
          sessionUpdate: "agent_message_chunk",
          messageId: event.data.assistantMessageID,
          content: { type: "text", text: event.data.delta },
        }),
      }
    case "session.reasoning.delta":
      return {
        state,
        outputs: send({
          sessionUpdate: "agent_thought_chunk",
          messageId: reasoningMessageID(event.data.assistantMessageID, event.data.ordinal),
          content: { type: "text", text: event.data.delta },
        }),
      }
    case "session.tool.input.started":
      return {
        state: {
          ...state,
          tools: new Map(state.tools).set(
            toolKey(event.data.sessionID, event.data.id),
            newTool(event.data.sessionID, event.data.id, event.data.name),
          ),
        },
        outputs: send({
          sessionUpdate: "tool_call",
          ...pendingToolCall({
            toolCallId: event.data.id,
            toolName: event.data.name,
            state: { input: {} },
            cwd: ctx.cwd,
          }),
        }),
      }
    case "session.tool.called": {
      const key = toolKey(event.data.sessionID, event.data.id)
      const tool = {
        ...(state.tools.get(key) ?? newTool(event.data.sessionID, event.data.id)),
        input: event.data.input,
      }
      return {
        state: { ...state, tools: new Map(state.tools).set(key, tool) },
        outputs: send({
          sessionUpdate: "tool_call_update",
          ...runningToolUpdate({
            toolCallId: event.data.id,
            toolName: tool.name,
            state: { input: tool.input },
            cwd: ctx.cwd,
          }),
        }),
      }
    }
    case "session.tool.progress": {
      const key = toolKey(event.data.sessionID, event.data.id)
      const current = state.tools.get(key)
      if (!current) return { state, outputs: [] }
      return {
        state: { ...state, tools: new Map(state.tools).set(key, { ...current, metadata: event.data.metadata }) },
        outputs: send({
          sessionUpdate: "tool_call_update",
          ...runningToolUpdate({
            toolCallId: event.data.id,
            toolName: current.name,
            state: { input: current.input },
            cwd: ctx.cwd,
          }),
        }),
      }
    }
    case "session.tool.success": {
      const key = toolKey(event.data.sessionID, event.data.id)
      const tool = state.tools.get(key) ?? newTool(event.data.sessionID, event.data.id)
      return {
        state: { ...state, tools: without(state.tools, key) },
        outputs: send({
          sessionUpdate: "tool_call_update",
          ...completedToolUpdate({
            toolCallId: event.data.id,
            toolName: tool.name,
            input: tool.input,
            metadata: event.data.metadata,
            content: event.data.content,
            cwd: ctx.cwd,
          }),
        }),
      }
    }
    case "session.tool.failed": {
      const key = toolKey(event.data.sessionID, event.data.id)
      const tool = state.tools.get(key) ?? newTool(event.data.sessionID, event.data.id)
      return {
        state: { ...state, tools: without(state.tools, key) },
        outputs: send({
          sessionUpdate: "tool_call_update",
          ...errorToolUpdate({
            toolCallId: event.data.id,
            toolName: tool.name,
            input: tool.input,
            metadata: event.data.metadata ?? tool.metadata,
            content: event.data.content ?? [],
            error: event.data.error.message,
            cwd: ctx.cwd,
          }),
        }),
      }
    }
    default:
      return { state, outputs: [] }
  }
}

function newTool(sessionID: string, id: string, name = "tool"): Tool {
  return { sessionID, id, name, input: {}, metadata: {} }
}

function route(ctx: TurnContext, child: ACPChild.Session | undefined, update: SessionUpdate): Output[] {
  if (!child) return [{ _tag: "SessionUpdate", update }]
  const projected = ACPChild.project(update, child)
  if (ctx.childUpdates) return childStatus(ctx, child, { type: "update", update: projected })
  return [{ _tag: "SessionUpdate", update: projected }]
}

function childStatus(ctx: TurnContext, child: ACPChild.Session, event: ACPChild.Event): Output[] {
  if (!ctx.childUpdates) return []
  return [{ _tag: "ChildUpdate", update: ACPChild.update(ctx.sessionID, child, event) }]
}

function childEnded(state: TurnState, ctx: TurnContext, child: ACPChild.Session, status: ACPChild.Event): Folded {
  const openChildren = new Set(state.openChildren)
  openChildren.delete(child.id)
  return { state: { ...state, openChildren }, outputs: childStatus(ctx, child, status) }
}

function recordStep(state: TurnState, tokens: TokenUsage.Info): TurnState {
  const turn = state.usage?.turn
  return {
    ...state,
    usage: {
      turn: turn
        ? {
            input: turn.input + tokens.input,
            output: turn.output + tokens.output,
            reasoning: turn.reasoning + tokens.reasoning,
            cache: { read: turn.cache.read + tokens.cache.read, write: turn.cache.write + tokens.cache.write },
          }
        : tokens,
      last: tokens,
    },
  }
}

function without<K, V>(map: ReadonlyMap<K, V>, key: K) {
  const next = new Map(map)
  next.delete(key)
  return next
}

function sessionIDFromEvent(event: OpenCodeEvent) {
  if ("sessionID" in event.data && typeof event.data.sessionID === "string") return event.data.sessionID
  if (event.type === "form.created") return event.data.form.sessionID
  return undefined
}

function toolKey(sessionID: string, id: string) {
  return `${sessionID}:${id}`
}

function resolveStopReason(input: {
  readonly terminal: Terminal
  readonly finish: SessionMessage.Assistant["finish"]
  readonly error?: string
}): PromptResponse["stopReason"] {
  if (input.terminal === "interrupted" || input.error === "aborted") return "cancelled"
  if (input.finish === "length") return "max_tokens"
  if (input.finish === "content-filter" || input.error === "provider.content-filter") return "refusal"
  return "end_turn"
}

export * as ACPTranslate from "./translate"
