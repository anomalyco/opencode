import type { SessionInfo } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"

/** How long the dialog waits for a restore before it gives control back. The request itself keeps running. */
export const SESSION_RESTORE_TIMEOUT_MS = 15_000

/**
 * The session search dialog's selection. Picking an archived session restores it before it opens; `done` means the
 * dialog opened a session and is closing.
 */
export type SessionSearchState =
  | { readonly status: "idle"; readonly issued: number }
  | {
      readonly status: "restoring"
      readonly issued: number
      readonly attempt: number
      readonly server: ServerConnection.Key
      readonly sessionID: string
      readonly directory: string | undefined
    }
  | { readonly status: "done"; readonly issued: number }
  | { readonly status: "disposed"; readonly issued: number }

export type SessionSearchEvent =
  | {
      readonly type: "entry.selected"
      readonly server: ServerConnection.Key
      readonly sessionID: string
      readonly directory: string | undefined
      readonly archived: boolean
    }
  | {
      readonly type: "restore.succeeded"
      readonly attempt: number
      readonly server: ServerConnection.Key
      readonly session: SessionInfo
    }
  | { readonly type: "restore.failed"; readonly attempt: number; readonly error: unknown }
  | { readonly type: "restore.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type SessionSearchEffect =
  | {
      readonly type: "restore.start"
      readonly attempt: number
      readonly server: ServerConnection.Key
      readonly sessionID: string
      readonly timeoutMs: number
    }
  | { readonly type: "timer.clear"; readonly attempt: number }
  | { readonly type: "session.remember"; readonly server: ServerConnection.Key; readonly session: SessionInfo }
  | {
      readonly type: "session.open"
      readonly server: ServerConnection.Key
      readonly sessionID: string
      readonly directory: string | undefined
    }
  | { readonly type: "toast.failed"; readonly error: unknown }

export type SessionSearchTransition = {
  readonly state: SessionSearchState
  readonly effects: readonly SessionSearchEffect[]
}

export const INITIAL_SESSION_SEARCH_STATE: SessionSearchState = Object.freeze({ status: "idle", issued: 0 })

const NONE: readonly SessionSearchEffect[] = []

export function transitionSessionSearch(state: SessionSearchState, event: SessionSearchEvent): SessionSearchTransition {
  if (event.type === "restore.succeeded") {
    if (event.attempt < 1 || event.attempt > state.issued) return unchanged(state)

    if (state.status === "restoring" && state.attempt === event.attempt)
      return {
        state: { status: "done", issued: state.issued },
        effects: [
          { type: "timer.clear", attempt: event.attempt },
          { type: "session.remember", server: event.server, session: event.session },
          { type: "session.open", server: state.server, sessionID: state.sessionID, directory: state.directory },
        ],
      }

    // The server restored it after the dialog closed or stopped waiting: show the session as restored, but do not
    // open a tab the user no longer expects.
    return { state, effects: [{ type: "session.remember", server: event.server, session: event.session }] }
  }

  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed")
    return {
      state: { status: "disposed", issued: state.issued },
      effects: state.status === "restoring" ? [{ type: "timer.clear", attempt: state.attempt }] : NONE,
    }

  if (event.type === "entry.selected") {
    // One selection at a time: a second Enter or click while restoring or closing does nothing.
    if (state.status !== "idle") return unchanged(state)

    if (!event.archived)
      return {
        state: { status: "done", issued: state.issued },
        effects: [{ type: "session.open", server: event.server, sessionID: event.sessionID, directory: event.directory }],
      }
    const attempt = state.issued + 1

    return {
      state: {
        status: "restoring",
        issued: attempt,
        attempt,
        server: event.server,
        sessionID: event.sessionID,
        directory: event.directory,
      },
      effects: [
        {
          type: "restore.start",
          attempt,
          server: event.server,
          sessionID: event.sessionID,
          timeoutMs: SESSION_RESTORE_TIMEOUT_MS,
        },
      ],
    }
  }

  if (state.status !== "restoring" || state.attempt !== event.attempt) return unchanged(state)

  return {
    state: { status: "idle", issued: state.issued },
    effects: [
      { type: "timer.clear", attempt: event.attempt },
      { type: "toast.failed", error: event.type === "restore.failed" ? event.error : undefined },
    ],
  }
}

/** The palette row id of the session being restored. */
export function selectSessionRestoreEntryID(state: SessionSearchState) {
  return state.status === "restoring" ? `session:${state.server}:${state.sessionID}` : undefined
}

function unchanged(state: SessionSearchState): SessionSearchTransition {
  return { state, effects: NONE }
}
