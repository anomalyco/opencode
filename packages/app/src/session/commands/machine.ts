// --- Session commands: /compact and opening the /fork, /open and /mcp dialogs ---

// A dialog's chunk that has not loaded by then is reported as a failed request.
export const SESSION_DIALOG_LOAD_TIMEOUT_MS = 15_000

/** The lazily loaded dialogs: the /fork picker, the /open file palette and the /mcp list. */
export type SessionDialogKind = "fork" | "palette" | "mcp"

/**
 * The session commands stay mounted while tabs switch between sessions, so compactions are keyed by the session they
 * run for; a dialog loads for the session it was asked from and does not open over another. /export runs through
 * `export-machine.ts`.
 */
export type SessionCommandsState =
  | {
      readonly status: "active"
      readonly issued: number
      readonly compacting: Readonly<Record<string, number>>
      readonly dialog:
        | { readonly status: "closed" }
        | {
            readonly status: "loading"
            readonly attempt: number
            readonly kind: SessionDialogKind
            readonly sessionKey: string
          }
    }
  | { readonly status: "disposed" }

export type SessionCommandsEvent =
  | { readonly type: "compact.requested"; readonly sessionID: string }
  | { readonly type: "compact.succeeded"; readonly attempt: number; readonly sessionID: string }
  | { readonly type: "compact.failed"; readonly attempt: number; readonly sessionID: string; readonly cause: unknown }
  | { readonly type: "dialog.requested"; readonly kind: SessionDialogKind; readonly sessionKey: string }
  | { readonly type: "dialog.loaded"; readonly attempt: number }
  | { readonly type: "dialog.load-failed"; readonly attempt: number; readonly cause: unknown }
  | { readonly type: "dialog.timed-out"; readonly attempt: number }
  | { readonly type: "session.changed"; readonly sessionKey: string }
  | { readonly type: "disposed" }

export type SessionCommandsEffect =
  | { readonly type: "compact.run"; readonly attempt: number; readonly sessionID: string }
  | {
      readonly type: "dialog.load"
      readonly attempt: number
      readonly kind: SessionDialogKind
      readonly timeoutMs: number
    }
  // Stops the load's timer; its result is dropped by attempt.
  | { readonly type: "dialog.cancel" }
  | { readonly type: "dialog.show"; readonly kind: SessionDialogKind }
  | { readonly type: "toast.request-failed"; readonly cause: unknown }

export type SessionCommandsTransition = {
  readonly state: SessionCommandsState
  readonly effects: readonly SessionCommandsEffect[]
}

export function createSessionCommandsState(): SessionCommandsState {
  return { status: "active", issued: 0, compacting: {}, dialog: { status: "closed" } }
}

export function transitionSessionCommands(
  state: SessionCommandsState,
  event: SessionCommandsEvent,
): SessionCommandsTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: cancelDialog(state) }

  if (event.type === "compact.requested") {
    // A compaction already admitting for this session answers a repeat, which would run with the same request.
    if (state.compacting[event.sessionID] !== undefined) return unchanged(state)
    const attempt = state.issued + 1

    return {
      state: { ...state, issued: attempt, compacting: { ...state.compacting, [event.sessionID]: attempt } },
      effects: [{ type: "compact.run", attempt, sessionID: event.sessionID }],
    }
  }

  if (event.type === "compact.succeeded" || event.type === "compact.failed") {
    if (state.compacting[event.sessionID] !== event.attempt) return unchanged(state)
    const next = { ...state, compacting: omit(state.compacting, event.sessionID) }

    if (event.type === "compact.succeeded") return { state: next, effects: [] }

    return { state: next, effects: [{ type: "toast.request-failed", cause: event.cause }] }
  }

  if (event.type === "dialog.requested") {
    const dialog = state.dialog

    // The dialog's chunk is still loading: a repeat would open it twice.
    if (dialog.status === "loading" && dialog.kind === event.kind && dialog.sessionKey === event.sessionKey)
      return unchanged(state)
    const attempt = state.issued + 1

    // Another dialog replaces one still loading, as it would replace it once open.
    return {
      state: {
        ...state,
        issued: attempt,
        dialog: { status: "loading", attempt, kind: event.kind, sessionKey: event.sessionKey },
      },
      effects: [
        ...cancelDialog(state),
        { type: "dialog.load", attempt, kind: event.kind, timeoutMs: SESSION_DIALOG_LOAD_TIMEOUT_MS },
      ],
    }
  }

  if (state.dialog.status !== "loading") return unchanged(state)
  const closed: SessionCommandsState = { ...state, dialog: { status: "closed" } }

  // The dialogs belong to the session they were asked from, so none opens over another.
  if (event.type === "session.changed") {
    if (state.dialog.sessionKey === event.sessionKey) return unchanged(state)

    return { state: closed, effects: [{ type: "dialog.cancel" }] }
  }

  if (event.attempt !== state.dialog.attempt) return unchanged(state)

  if (event.type === "dialog.loaded")
    return { state: closed, effects: [{ type: "dialog.cancel" }, { type: "dialog.show", kind: state.dialog.kind }] }

  if (event.type === "dialog.load-failed")
    return { state: closed, effects: [{ type: "dialog.cancel" }, { type: "toast.request-failed", cause: event.cause }] }

  return { state: closed, effects: [{ type: "toast.request-failed", cause: undefined }] }
}

// --- ⌘W after the side panel empties ---

// How long ⌘W must rest after the side panel closes before it closes the session tab.
export const CLOSE_TAB_GUARD_QUIET_MS = 500

/**
 * ⌘W on the side panel's last tab closes the panel; one press too many would then close the session tab. While armed,
 * ⌘W closes nothing, until ⌘W rests for `CLOSE_TAB_GUARD_QUIET_MS` or the user moves on by clicking, focusing
 * elsewhere, pressing another key, leaving the window, or switching session. Each swallowed ⌘W restarts the rest, so
 * mashing or holding it never reaches the session tab. `settling` covers the frame after arming, in which closing the
 * panel may still move focus.
 */
export type CloseTabGuardState =
  | { readonly status: "disarmed"; readonly issued: number }
  | {
      readonly status: "armed"
      readonly attempt: number
      readonly tabKey: string | undefined
      readonly settling: boolean
    }
  | { readonly status: "disposed" }

export type CloseTabGuardEvent =
  | {
      readonly type: "close.completed"
      readonly keybind: boolean
      readonly tabKey: string | undefined
      readonly sideOpened: boolean
    }
  | { readonly type: "settle.completed"; readonly attempt: number }
  | { readonly type: "quiet.elapsed"; readonly attempt: number }
  | { readonly type: "pointer.down" }
  | { readonly type: "focus.in" }
  | { readonly type: "window.blur" }
  | { readonly type: "key.down"; readonly key: string; readonly matchesClose: boolean }
  | { readonly type: "layout.synced"; readonly tabKey: string | undefined; readonly sideOpened: boolean }
  | { readonly type: "disposed" }

export type CloseTabGuardEffect =
  | { readonly type: "settle.schedule"; readonly attempt: number }
  | { readonly type: "settle.cancel" }
  | { readonly type: "quiet.schedule"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "quiet.cancel" }

export type CloseTabGuardTransition = {
  readonly state: CloseTabGuardState
  readonly effects: readonly CloseTabGuardEffect[]
}

export function createCloseTabGuardState(): CloseTabGuardState {
  return { status: "disarmed", issued: 0 }
}

const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt"])

const NO_GUARD_EFFECTS: readonly CloseTabGuardEffect[] = []

export function transitionCloseTabGuard(state: CloseTabGuardState, event: CloseTabGuardEvent): CloseTabGuardTransition {
  if (state.status === "disposed") return { state, effects: NO_GUARD_EFFECTS }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: cancelTimers(state) }

  if (event.type === "close.completed") {
    if (event.keybind && !event.sideOpened) {
      const attempt = (state.status === "armed" ? state.attempt : state.issued) + 1

      return {
        state: { status: "armed", attempt, tabKey: event.tabKey, settling: true },
        effects: [...settleCancel(state), { type: "settle.schedule", attempt }, quietSchedule(attempt)],
      }
    }

    return disarm(state)
  }

  // Every other event leaves a disarmed guard as it is, without allocating.
  if (state.status === "disarmed") return { state, effects: NO_GUARD_EFFECTS }

  if (event.type === "settle.completed") {
    if (!state.settling || event.attempt !== state.attempt) return { state, effects: NO_GUARD_EFFECTS }

    return { state: { ...state, settling: false }, effects: NO_GUARD_EFFECTS }
  }

  // Focus the panel's own close moves, in this frame, is not the user moving on.
  if (event.type === "focus.in" && state.settling) return { state, effects: NO_GUARD_EFFECTS }

  if (event.type === "quiet.elapsed") {
    if (event.attempt !== state.attempt) return { state, effects: NO_GUARD_EFFECTS }

    return disarm(state)
  }

  if (event.type === "key.down" && event.matchesClose) return { state, effects: [quietSchedule(state.attempt)] }

  if (event.type === "key.down" && MODIFIER_KEYS.has(event.key)) return { state, effects: NO_GUARD_EFFECTS }

  // The panel closing is what armed the guard; only another session or the panel reopening moves on.
  if (event.type === "layout.synced" && event.tabKey === state.tabKey && !event.sideOpened) {
    return { state, effects: NO_GUARD_EFFECTS }
  }

  return disarm(state)
}

/** Whether ⌘W, with the side panel closed, closes nothing. */
export function selectCloseTabSwallowed(state: CloseTabGuardState) {
  return state.status === "armed"
}

function disarm(state: Exclude<CloseTabGuardState, { status: "disposed" }>): CloseTabGuardTransition {
  if (state.status === "disarmed") return { state, effects: NO_GUARD_EFFECTS }

  return { state: { status: "disarmed", issued: state.attempt }, effects: cancelTimers(state) }
}

function quietSchedule(attempt: number): CloseTabGuardEffect {
  return { type: "quiet.schedule", attempt, timeoutMs: CLOSE_TAB_GUARD_QUIET_MS }
}

function cancelTimers(state: CloseTabGuardState): CloseTabGuardEffect[] {
  return state.status === "armed" ? [...settleCancel(state), { type: "quiet.cancel" }] : []
}

function settleCancel(state: CloseTabGuardState): CloseTabGuardEffect[] {
  return state.status === "armed" && state.settling ? [{ type: "settle.cancel" }] : []
}

function cancelDialog(state: Extract<SessionCommandsState, { status: "active" }>): SessionCommandsEffect[] {
  return state.dialog.status === "loading" ? [{ type: "dialog.cancel" }] : []
}

function omit(record: Readonly<Record<string, number>>, key: string) {
  return Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key))
}

function unchanged(state: SessionCommandsState): SessionCommandsTransition {
  return { state, effects: [] }
}
