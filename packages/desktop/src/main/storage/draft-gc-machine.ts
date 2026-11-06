// Orphans left by an earlier session are collected once the window is up rather than before it: the scan walks every
// stored document.
export const STARTUP_COLLECT_DELAY_MS = 10_000

// Editing a large paste retires one text chunk per save, so orphans accumulate while the app runs.
export const COLLECT_INTERVAL_MS = 60_000

// A blob stays collectable-proof for this long after its last upload or document reference. The renderer reuses a
// cached chunk id without uploading for far less than this (see draftChunkCacheTtl), so a reference it publishes
// always points at a retained blob.
export const BLOB_GRACE_MS = 15 * 60_000

/**
 * When the draft store next collects blobs no document references. Any document write can orphan a blob, and a sweep
 * keeps orphans still inside the grace period, so the machine stays `scheduled` until a sweep finds none left.
 */
export type DraftGcState =
  /** The last sweep left no unreferenced blob. */
  | { readonly status: "clean"; readonly attempt: number; readonly lastCollectedAt: number }
  | { readonly status: "scheduled"; readonly attempt: number; readonly lastCollectedAt: number; readonly dueAt: number }
  | { readonly status: "collecting"; readonly attempt: number }
  | { readonly status: "closed" }

export type DraftGcEvent =
  | { readonly type: "blob.uploaded"; readonly at: number }
  | { readonly type: "documents.written"; readonly at: number }
  | { readonly type: "timer.fired"; readonly attempt: number; readonly at: number }
  | {
      readonly type: "collect.succeeded"
      readonly attempt: number
      readonly at: number
      /** The oldest `touched_at` among unreferenced blobs the sweep kept, or `null` when none remain. */
      readonly oldestOrphanAt: number | null
    }
  | { readonly type: "collect.failed"; readonly attempt: number; readonly at: number; readonly error: unknown }
  | { readonly type: "close.requested" }

export type DraftGcCommand =
  /** Replaces the armed timer, if any. */
  | { readonly type: "start-timer"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel-timer" }
  /** Deletes unreferenced blobs last touched before `before`. */
  | { readonly type: "collect"; readonly attempt: number; readonly at: number; readonly before: number }
  | { readonly type: "report-error"; readonly error: unknown }

export type DraftGcTransition = { readonly state: DraftGcState; readonly commands: readonly DraftGcCommand[] }

export function initialDraftGcTransition(openAt: number, startupDelayMs: number): DraftGcTransition {
  return schedule(0, openAt, openAt + startupDelayMs, openAt)
}

export function transitionDraftGc(state: DraftGcState, event: DraftGcEvent): DraftGcTransition {
  if (state.status === "closed") return unchanged(state)

  if (event.type === "close.requested")
    return { state: { status: "closed" }, commands: state.status === "scheduled" ? [{ type: "cancel-timer" }] : [] }

  if (state.status === "collecting") return collected(state, event)

  if (event.type === "blob.uploaded") {
    // A scheduled sweep finds the new blob itself and schedules again while it is inside the grace period.
    if (state.status === "scheduled") return unchanged(state)

    return schedule(
      state.attempt,
      state.lastCollectedAt,
      Math.max(state.lastCollectedAt + COLLECT_INTERVAL_MS, event.at + BLOB_GRACE_MS + 1),
      event.at,
    )
  }

  if (event.type === "documents.written") {
    // Only a document write can orphan a blob, so collect right after one when the interval allows.
    if (event.at - state.lastCollectedAt >= COLLECT_INTERVAL_MS) return collect(state.attempt, event.at)

    const dueAt = state.lastCollectedAt + COLLECT_INTERVAL_MS

    if (state.status === "scheduled" && state.dueAt <= dueAt) return unchanged(state)

    return schedule(state.attempt, state.lastCollectedAt, dueAt, event.at)
  }

  if (event.type === "timer.fired" && state.status === "scheduled" && event.attempt === state.attempt)
    return collect(state.attempt, event.at)

  return unchanged(state)
}

function collected(state: Extract<DraftGcState, { status: "collecting" }>, event: DraftGcEvent): DraftGcTransition {
  if (event.type === "collect.failed" && event.attempt === state.attempt) {
    const retry = schedule(state.attempt, event.at, event.at + COLLECT_INTERVAL_MS, event.at)

    return { state: retry.state, commands: [...retry.commands, { type: "report-error", error: event.error }] }
  }

  if (event.type !== "collect.succeeded" || event.attempt !== state.attempt) return unchanged(state)

  if (event.oldestOrphanAt === null)
    return { state: { status: "clean", attempt: state.attempt, lastCollectedAt: event.at }, commands: [] }

  return schedule(
    state.attempt,
    event.at,
    Math.max(event.at + COLLECT_INTERVAL_MS, event.oldestOrphanAt + BLOB_GRACE_MS + 1),
    event.at,
  )
}

function schedule(attempt: number, lastCollectedAt: number, dueAt: number, at: number): DraftGcTransition {
  return {
    state: { status: "scheduled", attempt: attempt + 1, lastCollectedAt, dueAt },
    commands: [{ type: "start-timer", attempt: attempt + 1, delayMs: Math.max(0, dueAt - at) }],
  }
}

function collect(attempt: number, at: number): DraftGcTransition {
  return {
    state: { status: "collecting", attempt: attempt + 1 },
    commands: [{ type: "cancel-timer" }, { type: "collect", attempt: attempt + 1, at, before: at - BLOB_GRACE_MS }],
  }
}

function unchanged(state: DraftGcState): DraftGcTransition {
  return { state, commands: [] }
}
