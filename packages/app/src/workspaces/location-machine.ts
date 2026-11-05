import type { LocationRef } from "@opencode/client/promise"

export const LOCATION_SYNC_RETRIES = 2
export const LOCATION_SYNC_RETRY_DELAY = 500
export const LOCATION_SYNC_TIMEOUT = 30_000

/** `missing` on an attempt: the folder was missing before, so the missing view stays while the server checks again. */
export type LocationSyncState =
  | { readonly status: "idle"; readonly attempt: number; readonly location: LocationRef }
  | {
      readonly status: "syncing"
      readonly attempt: number
      readonly retries: number
      readonly location: LocationRef
      readonly missing: boolean
    }
  | {
      readonly status: "waiting-retry"
      readonly attempt: number
      readonly retries: number
      readonly location: LocationRef
      readonly missing: boolean
    }
  | { readonly status: "synced"; readonly attempt: number; readonly location: LocationRef }
  | { readonly status: "missing"; readonly attempt: number; readonly location: LocationRef }
  | { readonly status: "failed"; readonly attempt: number; readonly location: LocationRef }
  | { readonly status: "disposed" }

export type LocationSyncEvent =
  | { readonly type: "target.updated"; readonly location: LocationRef; readonly connected: boolean }
  /** The server resolved the Location, so its folder exists. */
  | { readonly type: "info.resolved"; readonly attempt: number }
  | { readonly type: "sync.succeeded"; readonly attempt: number }
  | { readonly type: "sync.missing"; readonly attempt: number }
  | { readonly type: "sync.failed"; readonly attempt: number }
  | { readonly type: "sync.timed-out"; readonly attempt: number }
  | { readonly type: "retry.due"; readonly attempt: number }
  | { readonly type: "disposed" }

export type LocationSyncEffect =
  | { readonly type: "sync"; readonly attempt: number; readonly location: LocationRef; readonly timeout: number }
  | { readonly type: "retry"; readonly attempt: number; readonly delay: number }
  | { readonly type: "timer.clear" }

export type LocationSyncTransition = {
  readonly state: LocationSyncState
  readonly effects: readonly LocationSyncEffect[]
}

export function createLocationSyncState(location: LocationRef): LocationSyncState {
  return { status: "idle", attempt: 0, location }
}

export function transitionLocationSync(state: LocationSyncState, event: LocationSyncEvent): LocationSyncTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: clearTimer(state) }

  if (event.type === "target.updated") return targetUpdated(state, event)

  if (event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "retry.due") {
    if (state.status !== "waiting-retry") return unchanged(state)

    return {
      state: { ...state, status: "syncing" },
      effects: [{ type: "sync", attempt: state.attempt, location: state.location, timeout: LOCATION_SYNC_TIMEOUT }],
    }
  }

  if (state.status !== "syncing") return unchanged(state)

  if (event.type === "info.resolved") return state.missing ? { state: { ...state, missing: false }, effects: [] } : unchanged(state)

  if (event.type === "sync.succeeded") return settle(state, "synced")

  // A typed not-found answer is final; retrying cannot succeed until the folder changes.
  if (event.type === "sync.missing") return settle(state, "missing")

  // Generic failures and timeouts do not prove the folder is missing.
  if (state.retries < LOCATION_SYNC_RETRIES)
    return {
      state: { ...state, status: "waiting-retry", attempt: state.attempt + 1, retries: state.retries + 1 },
      effects: [{ type: "retry", attempt: state.attempt + 1, delay: LOCATION_SYNC_RETRY_DELAY * 2 ** state.retries }],
    }

  return settle(state, state.missing ? "missing" : "failed")
}

/** The Location whose folder is missing, only while it is still the current one. */
export function missingLocation(state: LocationSyncState, current: LocationRef) {
  if (state.status === "disposed" || !sameLocationRef(state.location, current)) return

  if (state.status === "missing") return state.location

  if ((state.status === "syncing" || state.status === "waiting-retry") && state.missing) return state.location
}

export function sameLocationRef(a: LocationRef, b: LocationRef) {
  return a.directory === b.directory && a.workspaceID === b.workspaceID
}

function targetUpdated(
  state: Exclude<LocationSyncState, { status: "disposed" }>,
  event: Extract<LocationSyncEvent, { type: "target.updated" }>,
): LocationSyncTransition {
  const attempt = state.attempt + 1

  // Another Location starts over: nothing about the previous folder carries over.
  if (!sameLocationRef(state.location, event.location)) {
    if (!event.connected)
      return { state: { status: "idle", attempt, location: event.location }, effects: clearTimer(state) }

    return sync(event.location, attempt, false)
  }

  if (event.connected) {
    if (state.status === "idle") return sync(state.location, attempt, false)

    // Reconnecting checks the folder again without hiding the missing view meanwhile.
    if (state.status === "missing") return sync(state.location, attempt, true)

    return unchanged(state)
  }

  if (state.status === "idle" || state.status === "missing") return unchanged(state)

  // Offline proves nothing about the folder, so a missing one stays missing.
  if ((state.status === "syncing" || state.status === "waiting-retry") && state.missing)
    return { state: { status: "missing", attempt, location: state.location }, effects: clearTimer(state) }

  return { state: { status: "idle", attempt, location: state.location }, effects: clearTimer(state) }
}

function sync(location: LocationRef, attempt: number, missing: boolean): LocationSyncTransition {
  return {
    state: { status: "syncing", attempt, retries: 0, location, missing },
    effects: [{ type: "sync", attempt, location, timeout: LOCATION_SYNC_TIMEOUT }],
  }
}

function settle(
  state: Extract<LocationSyncState, { status: "syncing" }>,
  status: "synced" | "missing" | "failed",
): LocationSyncTransition {
  return { state: { status, attempt: state.attempt, location: state.location }, effects: [{ type: "timer.clear" }] }
}

function clearTimer(state: LocationSyncState): LocationSyncEffect[] {
  return state.status === "syncing" || state.status === "waiting-retry" ? [{ type: "timer.clear" }] : []
}

function unchanged(state: LocationSyncState): LocationSyncTransition {
  return { state, effects: [] }
}
