import type { SessionUpdate } from "@agentclientprotocol/sdk"
import type { OpenCodeEvent } from "@opencode/client/effect"
import type { SessionError } from "@opencode/schema/session-error"
import { SessionMessage } from "@opencode/schema/session-message"

const MarkerMeta = "opencode/compaction"

/** Message IDs follow core's compaction message projection, so live compactions match replayed ones. */
export type Started = { readonly status: "started"; readonly messageId: string; readonly reason: "auto" | "manual" }

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

/** Each session's compaction that has started and not yet settled, by session ID. */
export type Tracked = ReadonlyMap<string, Started>

type LifecycleEvent = Extract<
  OpenCodeEvent,
  { readonly type: "session.compaction.started" | "session.compaction.ended" | "session.compaction.failed" }
>
type OpeningEvent = Extract<
  LifecycleEvent,
  { readonly type: "session.compaction.started" | "session.compaction.failed" }
>

// Core reports a cancelled or interrupted compaction as a failure with one of these error types.
const Cancelled = new Set(["aborted", "compaction.interrupted"])

/**
 * Whether compactions go out as the standard session updates rather than the `_meta` marker. A child compaction
 * projected onto the parent session keeps the marker, since a standard update there would read as compaction of the
 * parent's own context.
 */
export function usesStandardUpdates(
  ctx: { readonly compaction: boolean; readonly childUpdates: boolean },
  child: boolean,
) {
  return ctx.compaction && (!child || ctx.childUpdates)
}

/** Tracks a lifecycle event and returns the updates it sends. */
export function apply(event: LifecycleEvent, tracked: Tracked, standard: boolean) {
  const sessionID = event.data.sessionID
  if (event.type === "session.compaction.started") {
    const started = open(event)
    return { tracked: new Map(tracked).set(sessionID, started), updates: [update(started, standard)] }
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
    return { tracked: remaining, updates: [update(completed, standard)] }
  }
  // Automatic compaction can fail before it starts, for example when there is nothing to compact yet. A live
  // standard compaction still opens before it settles.
  const started = current ?? open(event)
  const failed: Compaction = { ...started, status: "failed", reason: event.data.reason, error: event.data.error }
  return {
    tracked: remaining,
    updates: [...(current || !standard ? [] : [update(started, standard)]), update(failed, standard)],
  }
}

/** A summary chunk for the session's tracked compaction, if it has one and uses standard updates. */
export function chunk(started: Started | undefined, text: string, standard: boolean): SessionUpdate | undefined {
  if (!started || !standard) return undefined
  return { sessionUpdate: "compaction_summary_chunk", compactionId: started.messageId, content: { type: "text", text } }
}

/** Settles a compaction a cancelled turn left open the way core settles a cancelled one. */
export function abandon(started: Started, standard: boolean) {
  return update({ ...started, status: "failed", error: { type: "aborted", message: "Compaction cancelled" } }, standard)
}

/** A settled compaction as one terminal update. A running one has no live turn on this connection to settle it. */
export function replay(message: Extract<SessionMessage.Info, { type: "compaction" }>, standard: boolean) {
  if (message.status === "running") return undefined
  const base = { messageId: message.id, reason: message.reason }
  return update(
    message.status === "failed"
      ? { ...base, status: "failed", error: message.error }
      : { ...base, status: "completed", summary: message.summary },
    standard,
  )
}

function open(event: OpeningEvent): Started {
  return {
    status: "started",
    messageId: event.data.inputID ?? SessionMessage.ID.fromEvent(event.id),
    reason: event.data.reason,
  }
}

function update(compaction: Compaction, standard: boolean): SessionUpdate {
  if (!standard) {
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
    error: errorMessage(compaction.error),
  }
}

// Core reports a defect as `compaction.failed` with the pretty-printed cause, whose stack trace spans several lines.
function errorMessage(error: SessionError.Error) {
  if (!error.message || (error.type === "compaction.failed" && error.message.includes("\n"))) return "Compaction failed"
  return error.message
}

export * as ACPCompaction from "./compaction"
