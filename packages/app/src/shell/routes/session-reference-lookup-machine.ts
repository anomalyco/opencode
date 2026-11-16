import type { SessionInfo } from "@opencode/client/promise"

/**
 * Lookups of sessions the transcript references but this window has not loaded. Each ID is looked up once per
 * provider: `pending` while the request runs, `settled` after it, whether the session was found, missing, archived or
 * the request failed. A found session goes into the session cache, which is what renders the reference's title.
 */
export type SessionReferenceLookupState =
  | {
      readonly status: "active"
      readonly attempt: number
      readonly entries: ReadonlyMap<string, { readonly status: "pending"; readonly attempt: number } | SettledEntry>
    }
  | { readonly status: "disposed" }

type SettledEntry = { readonly status: "settled" }

export type SessionReferenceLookupEvent =
  | { readonly type: "requested"; readonly sessionID: string }
  | { readonly type: "resolved"; readonly sessionID: string; readonly attempt: number; readonly session: SessionInfo }
  /** Not found, archived, or the request failed: the reference stays its raw ID. */
  | { readonly type: "unavailable"; readonly sessionID: string; readonly attempt: number }
  /** The provider moved to another server, so every earlier answer is for the wrong one. */
  | { readonly type: "server.changed" }
  | { readonly type: "disposed" }

export type SessionReferenceLookupEffect =
  | { readonly type: "fetch"; readonly sessionID: string; readonly attempt: number }
  | { readonly type: "remember"; readonly session: SessionInfo }
  | { readonly type: "abort-all" }

export type SessionReferenceLookupTransition = {
  readonly state: SessionReferenceLookupState
  readonly effects: readonly SessionReferenceLookupEffect[]
}

const NONE: readonly SessionReferenceLookupEffect[] = []

const SETTLED: SettledEntry = Object.freeze({ status: "settled" })

export function createSessionReferenceLookupState(): SessionReferenceLookupState {
  return { status: "active", attempt: 0, entries: new Map() }
}

export function transitionSessionReferenceLookup(
  state: SessionReferenceLookupState,
  event: SessionReferenceLookupEvent,
): SessionReferenceLookupTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: [{ type: "abort-all" }] }

  if (event.type === "server.changed") {
    if (state.entries.size === 0) return { state, effects: NONE }

    return { state: { status: "active", attempt: state.attempt, entries: new Map() }, effects: [{ type: "abort-all" }] }
  }

  if (event.type === "requested") {
    if (state.entries.has(event.sessionID)) return { state, effects: NONE }
    const attempt = state.attempt + 1

    return {
      state: {
        status: "active",
        attempt,
        entries: new Map(state.entries).set(event.sessionID, { status: "pending", attempt }),
      },
      effects: [{ type: "fetch", sessionID: event.sessionID, attempt }],
    }
  }

  const entry = state.entries.get(event.sessionID)

  if (entry?.status !== "pending" || entry.attempt !== event.attempt) return { state, effects: NONE }

  const next: SessionReferenceLookupState = {
    status: "active",
    attempt: state.attempt,
    entries: new Map(state.entries).set(event.sessionID, SETTLED),
  }

  if (event.type === "unavailable" || event.session.time.archived) return { state: next, effects: NONE }

  return { state: next, effects: [{ type: "remember", session: event.session }] }
}
