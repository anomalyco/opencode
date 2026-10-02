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

export type Context = {
  readonly sessionID: Session.ID
  readonly cwd: string
  readonly start: TurnStart
  readonly childUpdates: boolean
  readonly compaction: boolean
  /** Background mode follows open children after the turn ends and never writes `session/update`. */
  readonly mode: "turn" | "background"
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

export type Output =
  | { readonly _tag: "SessionUpdate"; readonly update: SessionUpdate }
  | { readonly _tag: "ChildUpdate"; readonly update: ACPChild.Update }
  | {
      readonly _tag: "PermissionAsk"
      readonly event: PermissionEvent
      readonly tool?: Tool
      readonly child?: ACPChild.Session
    }
  | {
      readonly _tag: "FormAsk"
      readonly form: FormEvent["data"]["form"]
      readonly child?: ACPChild.Session
      readonly toolCallSent: boolean
    }
  | { readonly _tag: "AskSettled"; readonly id: string }

export type Step = {
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

export function step(state: TurnState, event: OpenCodeEvent, ctx: Context): Step {
  if (event.type === "session.created") {
    const parentID = event.data.parentID
    if (!parentID) return { state, outputs: [] }
    const parent = parentID === ctx.sessionID ? undefined : state.children.get(parentID)
    if (!parent && (ctx.mode === "background" || parentID !== ctx.sessionID)) return { state, outputs: [] }
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

  const eventSessionID = sessionIDFromEvent(event)
  const child = eventSessionID ? state.children.get(eventSessionID) : undefined
  if (ctx.mode === "background" && !child) return { state, outputs: [] }
  const send = (update: SessionUpdate) => route(ctx, child, update)

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
      outputs: [
        {
          _tag: "FormAsk",
          form: event.data.form,
          child,
          toolCallSent: ctx.mode === "turn" && (!child || !ctx.childUpdates),
        },
      ],
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
  if (!eventSessionID || (eventSessionID !== ctx.sessionID && !child)) return { state, outputs: [] }
  if (matchesStart(event, ctx.start)) return { state: { ...state, started: true }, outputs: [] }
  if (!state.started) return { state, outputs: [] }

  switch (event.type) {
    case "session.execution.started":
      return { state, outputs: child ? childStatus(ctx, child, { type: "status", status: "running" }) : [] }
    case "session.step.started": {
      const next = child ? state : { ...state, stepError: undefined }
      if (!state.retries.has(eventSessionID)) return { state: next, outputs: [] }
      return {
        state: { ...next, retries: without(state.retries, eventSessionID) },
        outputs: send({ sessionUpdate: "session_info_update", _meta: { [RetryMeta]: null } }),
      }
    }
    case "session.retry.scheduled": {
      const retry = {
        attempt: event.data.attempt,
        nextRetryAt: new Date(event.data.at).toISOString(),
        error: event.data.error,
      }
      return {
        state: { ...state, retries: new Map(state.retries).set(eventSessionID, retry) },
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
        state.compactions.get(eventSessionID),
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
          messageId: `${event.data.assistantMessageID}:reasoning:${event.data.ordinal}`,
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
    case "session.step.ended":
      if (child) return { state, outputs: [] }
      return { state: { ...recordStep(state, event.data.tokens), finish: event.data.finish }, outputs: [] }
    case "session.step.failed": {
      if (child) return { state, outputs: [] }
      const recorded = event.data.tokens ? recordStep(state, event.data.tokens) : state
      return { state: { ...recorded, stepError: event.data.error }, outputs: [] }
    }
    case "session.execution.succeeded":
      if (!child) return { state, outputs: [], terminal: "succeeded" }
      return childEnded(state, ctx, child, { type: "status", status: "completed" }, "succeeded")
    case "session.execution.interrupted":
      if (!child) return { state, outputs: [], terminal: "interrupted" }
      return childEnded(state, ctx, child, { type: "status", status: "interrupted" }, "interrupted")
    case "session.execution.failed":
      if (!child) return { state: { ...state, executionError: event.data.error }, outputs: [], terminal: "failed" }
      return childEnded(state, ctx, child, { type: "status", status: "failed", error: event.data.error }, "failed")
    default:
      return { state, outputs: [] }
  }
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
export function abandon(state: TurnState, ctx: Context): Step {
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

function newTool(sessionID: string, id: string, name = "tool"): Tool {
  return { sessionID, id, name, input: {}, metadata: {} }
}

function route(ctx: Context, child: ACPChild.Session | undefined, update: SessionUpdate): Output[] {
  if (!child) return ctx.mode === "turn" ? [{ _tag: "SessionUpdate", update }] : []
  const projected = ACPChild.project(update, child)
  if (ctx.childUpdates) return childStatus(ctx, child, { type: "update", update: projected })
  return ctx.mode === "turn" ? [{ _tag: "SessionUpdate", update: projected }] : []
}

function childStatus(ctx: Context, child: ACPChild.Session, event: ACPChild.Event): Output[] {
  if (!ctx.childUpdates) return []
  return [{ _tag: "ChildUpdate", update: ACPChild.update(ctx.sessionID, child, event) }]
}

function childEnded(
  state: TurnState,
  ctx: Context,
  child: ACPChild.Session,
  status: ACPChild.Event,
  terminal: Terminal,
): Step {
  const openChildren = new Set(state.openChildren)
  openChildren.delete(child.id)
  return {
    state: { ...state, openChildren },
    outputs: childStatus(ctx, child, status),
    ...(ctx.mode === "background" && openChildren.size === 0 ? { terminal } : {}),
  }
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

function matchesStart(event: OpenCodeEvent, start: TurnStart) {
  return event.type === "session.inbox.delivered" && event.data.inboxID === start.id
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
