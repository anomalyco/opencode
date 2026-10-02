import type { SessionUpdate } from "@agentclientprotocol/sdk"
import type { OpenCodeEvent } from "@opencode/client/effect"
import type { SessionError } from "@opencode/schema/session-error"
import { SessionMessage } from "@opencode/schema/session-message"

const MarkerMeta = "opencode/compaction"

type Started = { readonly status: "started"; readonly messageId: string; readonly reason: "auto" | "manual" }

type Compaction =
  | Started
  | {
      readonly status: "completed"
      readonly messageId: string
      readonly reason: "auto" | "manual"
      readonly summary: string
    }
  | {
      readonly status: "failed"
      readonly messageId: string
      readonly reason: "auto" | "manual"
      readonly error: SessionError.Error
    }

export type Tracked = ReadonlyMap<string, Started>

type LifecycleEvent = Extract<
  OpenCodeEvent,
  { readonly type: "session.compaction.started" | "session.compaction.ended" | "session.compaction.failed" }
>
type OpeningEvent = Extract<
  LifecycleEvent,
  { readonly type: "session.compaction.started" | "session.compaction.failed" }
>

const Cancelled = new Set(["aborted", "compaction.interrupted"])

// Without child updates, a child's standard update would read as the parent's own.
export function usesStandardUpdates(
  ctx: { readonly compaction: boolean; readonly childUpdates: boolean },
  child: boolean,
) {
  return ctx.compaction && (!child || ctx.childUpdates)
}

export function apply(event: LifecycleEvent, tracked: Tracked, standardUpdates: boolean) {
  const sessionID = event.data.sessionID
  if (event.type === "session.compaction.started") {
    const started = open(event)
    return { tracked: new Map(tracked).set(sessionID, started), updates: [update(started, standardUpdates)] }
  }
  const current = tracked.get(sessionID)
  const remaining = new Map(tracked)
  remaining.delete(sessionID)
  if (event.type === "session.compaction.ended") {
    if (!current) return { tracked: remaining, updates: [] }
    const completed: Compaction = {
      ...current,
      status: "completed",
      reason: event.data.reason,
      summary: event.data.text,
    }
    return { tracked: remaining, updates: [update(completed, standardUpdates)] }
  }
  // Auto compaction can fail without a started event; open it first for standard clients.
  const started = current ?? open(event)
  const failed: Compaction = { ...started, status: "failed", reason: event.data.reason, error: event.data.error }
  return {
    tracked: remaining,
    updates: [
      ...(current || !standardUpdates ? [] : [update(started, standardUpdates)]),
      update(failed, standardUpdates),
    ],
  }
}

export function chunk(started: Started | undefined, text: string, standardUpdates: boolean): SessionUpdate | undefined {
  if (!started || !standardUpdates) return undefined
  return { sessionUpdate: "compaction_summary_chunk", compactionId: started.messageId, content: { type: "text", text } }
}

export function abandon(started: Started, standardUpdates: boolean) {
  return update(
    { ...started, status: "failed", error: { type: "aborted", message: "Compaction cancelled" } },
    standardUpdates,
  )
}

// Nothing on this connection would settle a replayed running compaction.
export function replay(message: Extract<SessionMessage.Info, { type: "compaction" }>, standardUpdates: boolean) {
  if (message.status === "running") return undefined
  const base = { messageId: message.id, reason: message.reason }
  return update(
    message.status === "failed"
      ? { ...base, status: "failed", error: message.error }
      : { ...base, status: "completed", summary: message.summary },
    standardUpdates,
  )
}

// Matches core's compaction message ID, so live and replayed compactions line up.
function open(event: OpeningEvent): Started {
  return {
    status: "started",
    messageId: event.data.inputID ?? SessionMessage.ID.fromEvent(event.id),
    reason: event.data.reason,
  }
}

function update(compaction: Compaction, standardUpdates: boolean): SessionUpdate {
  if (!standardUpdates) {
    const marker = {
      status: compaction.status,
      messageId: compaction.messageId,
      reason: compaction.reason,
      ...(compaction.status === "failed" ? { error: compaction.error } : {}),
    }
    return { sessionUpdate: "session_info_update", _meta: { [MarkerMeta]: marker } }
  }
  const compactionId = compaction.messageId
  if (compaction.status === "started")
    return { sessionUpdate: "compaction_update", compactionId, status: "in_progress" }
  if (compaction.status === "completed") {
    const summary = compaction.summary ? [{ type: "text" as const, text: compaction.summary }] : null
    return { sessionUpdate: "compaction_update", compactionId, status: "completed", summary }
  }
  if (Cancelled.has(compaction.error.type))
    return { sessionUpdate: "compaction_update", compactionId, status: "cancelled", summary: null }
  return {
    sessionUpdate: "compaction_update",
    compactionId,
    status: "failed",
    summary: null,
    error: displayError(compaction.error),
  }
}

// Core reports a defect as `compaction.failed` with a multi-line pretty-printed cause.
function displayError(error: SessionError.Error) {
  if (!error.message || (error.type === "compaction.failed" && error.message.includes("\n"))) return "Compaction failed"
  return error.message
}

export * as ACPCompaction from "./compaction"
