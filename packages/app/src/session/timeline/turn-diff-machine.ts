import type { FileDiffInfo } from "@opencode/client/promise"
import type { TurnDiffState } from "@opencode/session-ui/context"

/**
 * A request's headers are bounded by the server queue (60 s), but a body that stalls after them is not, so each load
 * fails after this and the row offers a retry.
 */
export const TURN_DIFF_LOAD_TIMEOUT_MS = 15_000

/** One turn's load. A finished turn's snapshots never change, so `ready` is final. */
export type TurnDiffEntry =
  | { readonly status: "loading"; readonly attempt: number }
  | { readonly status: "ready"; readonly diffs: readonly FileDiffInfo[] }
  | { readonly status: "failed" }

/** One tab's turn diffs, keyed by `${sessionID}/${from}`. `attempts` numbers every load the cache starts. */
export type TurnDiffCacheState =
  | { readonly status: "active"; readonly attempts: number; readonly entries: ReadonlyMap<string, TurnDiffEntry> }
  | { readonly status: "disposed" }

export type TurnDiffCacheEvent =
  | { readonly type: "load.requested"; readonly key: string }
  | {
      readonly type: "load.succeeded"
      readonly key: string
      readonly attempt: number
      readonly diffs: readonly FileDiffInfo[]
    }
  | { readonly type: "load.failed"; readonly key: string; readonly attempt: number }
  | { readonly type: "load.timed-out"; readonly key: string; readonly attempt: number }
  | { readonly type: "disposed" }

export type TurnDiffCacheEffect =
  /** Starts the request, bounded by `timeoutMs`. */
  | { readonly type: "fetch"; readonly key: string; readonly attempt: number; readonly timeoutMs: number }
  /** Aborts the attempt's request, if still running, and clears its timer. */
  | { readonly type: "cancel"; readonly attempt: number }

export type TurnDiffCacheTransition = {
  readonly state: TurnDiffCacheState
  readonly effects: readonly TurnDiffCacheEffect[]
}

const LOADING: TurnDiffState = Object.freeze({ status: "loading" })

const FAILED: TurnDiffState = Object.freeze({ status: "failed" })

const FAILED_ENTRY: TurnDiffEntry = Object.freeze({ status: "failed" })

const NO_EFFECTS: readonly TurnDiffCacheEffect[] = Object.freeze([])

export const DISPOSED_TURN_DIFF_CACHE_STATE: TurnDiffCacheState = Object.freeze({ status: "disposed" })

export function createTurnDiffCacheState(): TurnDiffCacheState {
  return { status: "active", attempts: 0, entries: new Map() }
}

export function transitionTurnDiffCache(state: TurnDiffCacheState, event: TurnDiffCacheEvent): TurnDiffCacheTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed")
    return {
      state: DISPOSED_TURN_DIFF_CACHE_STATE,
      effects: [...state.entries.values()].flatMap((entry) =>
        entry.status === "loading" ? [{ type: "cancel" as const, attempt: entry.attempt }] : [],
      ),
    }

  const entry = state.entries.get(event.key)

  if (event.type === "load.requested") {
    if (entry && entry.status !== "failed") return { state, effects: NO_EFFECTS }
    const attempt = state.attempts + 1

    return {
      state: {
        status: "active",
        attempts: attempt,
        entries: put(state.entries, event.key, { status: "loading", attempt }),
      },
      effects: [{ type: "fetch", key: event.key, attempt, timeoutMs: TURN_DIFF_LOAD_TIMEOUT_MS }],
    }
  }

  // A result for an attempt that is no longer loading this turn (retried, or already timed out) is stale.
  if (entry?.status !== "loading" || entry.attempt !== event.attempt) return { state, effects: NO_EFFECTS }

  return {
    state: {
      status: "active",
      attempts: state.attempts,
      entries: put(
        state.entries,
        event.key,
        event.type === "load.succeeded" ? { status: "ready", diffs: event.diffs } : FAILED_ENTRY,
      ),
    },
    effects: [{ type: "cancel", attempt: event.attempt }],
  }
}

/** What the row shows for a turn; an unloaded turn reads as loading, since reading it starts the load. */
export function selectTurnDiffState(state: TurnDiffCacheState, key: string): TurnDiffState {
  const entry = state.status === "active" ? state.entries.get(key) : undefined

  if (!entry || entry.status === "loading") return LOADING

  if (entry.status === "failed") return FAILED

  return entry
}

function put(entries: ReadonlyMap<string, TurnDiffEntry>, key: string, entry: TurnDiffEntry) {
  return new Map(entries).set(key, entry)
}
