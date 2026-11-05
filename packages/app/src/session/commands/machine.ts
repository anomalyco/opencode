import type { SessionExportData } from "./export"

// --- Session commands: /compact, /export and opening /fork ---

/**
 * The session commands stay mounted while tabs switch between sessions, so compactions and exports are keyed by the
 * session they run for; the /fork picker loads for the session it was asked from.
 */
export type SessionCommandsState =
  | {
      readonly status: "active"
      readonly issued: number
      readonly compacting: Readonly<Record<string, number>>
      readonly exporting: Readonly<Record<string, number>>
      readonly forkDialog:
        | { readonly status: "closed" }
        | { readonly status: "loading"; readonly attempt: number; readonly sessionID: string }
    }
  | { readonly status: "disposed" }

export type SessionCommandsEvent =
  | { readonly type: "compact.requested"; readonly sessionID: string }
  | { readonly type: "compact.succeeded"; readonly attempt: number; readonly sessionID: string }
  | { readonly type: "compact.failed"; readonly attempt: number; readonly sessionID: string; readonly cause: unknown }
  | { readonly type: "export.requested"; readonly sessionID: string }
  | {
      readonly type: "export.fetched"
      readonly attempt: number
      readonly sessionID: string
      readonly data: SessionExportData
    }
  | {
      readonly type: "export.saved"
      readonly attempt: number
      readonly sessionID: string
      readonly filename: string
      readonly saved: boolean
    }
  | { readonly type: "export.failed"; readonly attempt: number; readonly sessionID: string; readonly message?: string }
  | { readonly type: "fork.requested"; readonly sessionID: string }
  | { readonly type: "fork.loaded"; readonly attempt: number }
  | { readonly type: "fork.load-failed"; readonly attempt: number; readonly cause: unknown }
  | { readonly type: "session.changed"; readonly sessionID: string | undefined }
  | { readonly type: "disposed" }

export type SessionCommandsEffect =
  | { readonly type: "compact.run"; readonly attempt: number; readonly sessionID: string }
  | { readonly type: "export.fetch"; readonly attempt: number; readonly sessionID: string }
  | {
      readonly type: "export.save"
      readonly attempt: number
      readonly sessionID: string
      readonly data: SessionExportData
    }
  | { readonly type: "export.abort"; readonly attempt: number }
  | { readonly type: "fork.load"; readonly attempt: number }
  | { readonly type: "fork.show" }
  | { readonly type: "toast.request-failed"; readonly cause: unknown }
  | { readonly type: "toast.exported"; readonly filename: string }
  | { readonly type: "toast.export-failed"; readonly message?: string }

export type SessionCommandsTransition = {
  readonly state: SessionCommandsState
  readonly effects: readonly SessionCommandsEffect[]
}

export function createSessionCommandsState(): SessionCommandsState {
  return { status: "active", issued: 0, compacting: {}, exporting: {}, forkDialog: { status: "closed" } }
}

export function transitionSessionCommands(
  state: SessionCommandsState,
  event: SessionCommandsEvent,
): SessionCommandsTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") {
    return {
      state: { status: "disposed" },
      effects: Object.values(state.exporting).map((attempt) => ({ type: "export.abort", attempt })),
    }
  }

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

  if (event.type === "export.requested") {
    if (state.exporting[event.sessionID] !== undefined) return unchanged(state)
    const attempt = state.issued + 1

    return {
      state: { ...state, issued: attempt, exporting: { ...state.exporting, [event.sessionID]: attempt } },
      effects: [{ type: "export.fetch", attempt, sessionID: event.sessionID }],
    }
  }

  if (event.type === "export.fetched") {
    if (state.exporting[event.sessionID] !== event.attempt) return unchanged(state)

    return {
      state,
      effects: [{ type: "export.save", attempt: event.attempt, sessionID: event.sessionID, data: event.data }],
    }
  }

  if (event.type === "export.saved" || event.type === "export.failed") {
    if (state.exporting[event.sessionID] !== event.attempt) return unchanged(state)
    const next = { ...state, exporting: omit(state.exporting, event.sessionID) }

    if (event.type === "export.failed") {
      return { state: next, effects: [{ type: "toast.export-failed", message: event.message }] }
    }

    // A cancelled save dialog is not a failure.
    return { state: next, effects: event.saved ? [{ type: "toast.exported", filename: event.filename }] : [] }
  }

  if (event.type === "fork.requested") {
    // The picker's chunk is still loading: a repeat would open it twice.
    if (state.forkDialog.status !== "closed") return unchanged(state)
    const attempt = state.issued + 1

    return {
      state: { ...state, issued: attempt, forkDialog: { status: "loading", attempt, sessionID: event.sessionID } },
      effects: [{ type: "fork.load", attempt }],
    }
  }

  if (event.type === "fork.loaded" || event.type === "fork.load-failed") {
    if (state.forkDialog.status !== "loading" || state.forkDialog.attempt !== event.attempt) return unchanged(state)
    const next: SessionCommandsState = { ...state, forkDialog: { status: "closed" } }

    if (event.type === "fork.load-failed") {
      return { state: next, effects: [{ type: "toast.request-failed", cause: event.cause }] }
    }

    return { state: next, effects: [{ type: "fork.show" }] }
  }

  // The picker lists one session's prompts, so it does not open over another.
  if (state.forkDialog.status !== "loading" || state.forkDialog.sessionID === event.sessionID) return unchanged(state)

  return { state: { ...state, forkDialog: { status: "closed" } }, effects: [] }
}

// --- ⌘W after the side panel empties ---

/**
 * ⌘W on the side panel's last tab closes the panel; one press too many would then close the session tab. While armed,
 * ⌘W closes nothing, until the user moves on by clicking, focusing elsewhere, pressing another key, leaving the window,
 * or switching session. `settling` covers the frame after arming, in which closing the panel may still move focus.
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
  | { readonly type: "pointer.down" }
  | { readonly type: "focus.in" }
  | { readonly type: "window.blur" }
  | { readonly type: "key.down"; readonly key: string; readonly matchesClose: boolean }
  | { readonly type: "layout.synced"; readonly tabKey: string | undefined; readonly sideOpened: boolean }
  | { readonly type: "disposed" }

export type CloseTabGuardEffect =
  | { readonly type: "settle.schedule"; readonly attempt: number }
  | { readonly type: "settle.cancel" }

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

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: settleCancel(state) }

  if (event.type === "close.completed") {
    if (event.keybind && !event.sideOpened) {
      const attempt = (state.status === "armed" ? state.attempt : state.issued) + 1

      return {
        state: { status: "armed", attempt, tabKey: event.tabKey, settling: true },
        effects: [...settleCancel(state), { type: "settle.schedule", attempt }],
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

  if (event.type === "key.down" && (MODIFIER_KEYS.has(event.key) || event.matchesClose)) {
    return { state, effects: NO_GUARD_EFFECTS }
  }

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

  return { state: { status: "disarmed", issued: state.attempt }, effects: settleCancel(state) }
}

function settleCancel(state: CloseTabGuardState): CloseTabGuardEffect[] {
  return state.status === "armed" && state.settling ? [{ type: "settle.cancel" }] : []
}

function omit(record: Readonly<Record<string, number>>, key: string) {
  return Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key))
}

function unchanged(state: SessionCommandsState): SessionCommandsTransition {
  return { state, effects: [] }
}
