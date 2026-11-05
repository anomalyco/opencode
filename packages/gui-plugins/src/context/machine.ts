import type { SessionExportData } from "./export"

// --- Export session ---

/**
 * The Context tab stays mounted while the routed session changes, so exports are keyed by the session they run for
 * (`SessionRef.key`). An export holds its key from the first request until the save dialog answers.
 */
export type SessionExportState =
  | {
      readonly status: "active"
      readonly issued: number
      readonly exporting: Readonly<Record<string, number>>
    }
  | { readonly status: "disposed" }

export type SessionExportEvent =
  | { readonly type: "export.requested"; readonly sessionKey: string; readonly sessionID: string }
  | {
      readonly type: "export.fetched"
      readonly attempt: number
      readonly sessionKey: string
      readonly data: SessionExportData
    }
  | {
      readonly type: "export.saved"
      readonly attempt: number
      readonly sessionKey: string
      readonly filename: string
      readonly saved: boolean
    }
  | { readonly type: "export.failed"; readonly attempt: number; readonly sessionKey: string; readonly message?: string }
  | { readonly type: "disposed" }

export type SessionExportEffect =
  | { readonly type: "export.fetch"; readonly attempt: number; readonly sessionKey: string; readonly sessionID: string }
  | {
      readonly type: "export.save"
      readonly attempt: number
      readonly sessionKey: string
      readonly data: SessionExportData
    }
  | { readonly type: "export.abort"; readonly attempt: number }
  | { readonly type: "toast.exported"; readonly filename: string }
  | { readonly type: "toast.export-failed"; readonly message?: string }

export type SessionExportTransition = {
  readonly state: SessionExportState
  readonly effects: readonly SessionExportEffect[]
}

export function createSessionExportState(): SessionExportState {
  return { status: "active", issued: 0, exporting: {} }
}

export function transitionSessionExport(state: SessionExportState, event: SessionExportEvent): SessionExportTransition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed") {
    return {
      state: { status: "disposed" },
      effects: Object.values(state.exporting).map((attempt) => ({ type: "export.abort", attempt })),
    }
  }

  if (event.type === "export.requested") {
    // A second click while the pages load or the save dialog is open would export, and ask where to save, again.
    if (state.exporting[event.sessionKey] !== undefined) return { state, effects: [] }
    const attempt = state.issued + 1

    return {
      state: { ...state, issued: attempt, exporting: { ...state.exporting, [event.sessionKey]: attempt } },
      effects: [{ type: "export.fetch", attempt, sessionKey: event.sessionKey, sessionID: event.sessionID }],
    }
  }

  if (state.exporting[event.sessionKey] !== event.attempt) return { state, effects: [] }

  if (event.type === "export.fetched") {
    return {
      state,
      effects: [{ type: "export.save", attempt: event.attempt, sessionKey: event.sessionKey, data: event.data }],
    }
  }

  const next = { ...state, exporting: omit(state.exporting, event.sessionKey) }

  if (event.type === "export.failed") {
    return { state: next, effects: [{ type: "toast.export-failed", message: event.message }] }
  }

  // A cancelled save dialog is not a failure.
  return { state: next, effects: event.saved ? [{ type: "toast.exported", filename: event.filename }] : [] }
}

/** Whether the session's export is loading or waiting for the save dialog. */
export function selectSessionExporting(state: SessionExportState, sessionKey: string) {
  return state.status === "active" && state.exporting[sessionKey] !== undefined
}

// --- Scroll offset of the tab ---

export type ScrollPosition = {
  readonly x: number
  readonly y: number
}

/**
 * The tab's scroll offset, stored per session. `restoring` applies the stored offset a frame after the session shows
 * and again after each content change, because the content renders progressively and clamps the first restore.
 * `applied` is the offset the last restore left, so its own scroll event is not taken for the user's. The first
 * scroll or input of the user moves to `tracking`, which stores the user's offset once per frame and never restores
 * over it. `inactive` covers a session whose layout cannot be read yet.
 */
export type ContextScrollState =
  | { readonly status: "inactive"; readonly attempt: number }
  | {
      readonly status: "restoring"
      readonly sessionKey: string
      readonly attempt: number
      readonly frame: boolean
      readonly applied: ScrollPosition | undefined
    }
  | {
      readonly status: "tracking"
      readonly sessionKey: string
      readonly attempt: number
      readonly pending: ScrollPosition | undefined
    }
  | { readonly status: "disposed" }

export type ContextScrollEvent =
  /** The routed session, or whether its layout can be read (`active`), changed. */
  | { readonly type: "target.synced"; readonly sessionKey: string; readonly active: boolean }
  | { readonly type: "content.changed" }
  | { readonly type: "restore.applied"; readonly attempt: number; readonly applied: ScrollPosition | undefined }
  /** Wheel, pointer, touch or key input on the scroller. */
  | { readonly type: "interacted" }
  | { readonly type: "scrolled"; readonly position: ScrollPosition }
  | { readonly type: "save.flushed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type ContextScrollEffect =
  | { readonly type: "frame.schedule"; readonly kind: "restore" | "save"; readonly attempt: number }
  | { readonly type: "frame.cancel" }
  | { readonly type: "save.write"; readonly sessionKey: string; readonly position: ScrollPosition }

export type ContextScrollTransition = {
  readonly state: ContextScrollState
  readonly effects: readonly ContextScrollEffect[]
}

export function createContextScrollState(): ContextScrollState {
  return { status: "inactive", attempt: 0 }
}

const NO_SCROLL_EFFECTS: readonly ContextScrollEffect[] = []

export function transitionContextScroll(state: ContextScrollState, event: ContextScrollEvent): ContextScrollTransition {
  if (state.status === "disposed") return { state, effects: NO_SCROLL_EFFECTS }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: leave(state) }

  if (event.type === "target.synced") {
    if (!event.active) {
      if (state.status === "inactive") return { state, effects: NO_SCROLL_EFFECTS }

      return { state: { status: "inactive", attempt: state.attempt + 1 }, effects: leave(state) }
    }

    if (state.status !== "inactive" && state.sessionKey === event.sessionKey) {
      return { state, effects: NO_SCROLL_EFFECTS }
    }

    // The previous session keeps the offset the user left it at; the next one restores its own.
    const attempt = state.attempt + 1

    return {
      state: { status: "restoring", sessionKey: event.sessionKey, attempt, frame: true, applied: undefined },
      effects: [...leave(state), { type: "frame.schedule", kind: "restore", attempt }],
    }
  }

  if (state.status === "inactive") return { state, effects: NO_SCROLL_EFFECTS }

  if (state.status === "restoring") {
    if (event.type === "content.changed") {
      if (state.frame) return { state, effects: NO_SCROLL_EFFECTS }
      const attempt = state.attempt + 1

      return {
        state: { ...state, attempt, frame: true },
        effects: [{ type: "frame.schedule", kind: "restore", attempt }],
      }
    }

    if (event.type === "restore.applied") {
      if (!state.frame || event.attempt !== state.attempt) return { state, effects: NO_SCROLL_EFFECTS }

      return { state: { ...state, frame: false, applied: event.applied }, effects: NO_SCROLL_EFFECTS }
    }

    if (event.type === "interacted") {
      return {
        state: { status: "tracking", sessionKey: state.sessionKey, attempt: state.attempt + 1, pending: undefined },
        effects: state.frame ? [{ type: "frame.cancel" }] : NO_SCROLL_EFFECTS,
      }
    }

    if (event.type === "scrolled") {
      if (state.applied && same(state.applied, event.position)) {
        return { state: { ...state, applied: undefined }, effects: NO_SCROLL_EFFECTS }
      }
      const attempt = state.attempt + 1
      const save: ContextScrollEffect = { type: "frame.schedule", kind: "save", attempt }

      return {
        state: { status: "tracking", sessionKey: state.sessionKey, attempt, pending: event.position },
        effects: state.frame ? [{ type: "frame.cancel" }, save] : [save],
      }
    }

    return { state, effects: NO_SCROLL_EFFECTS }
  }

  if (event.type === "scrolled") {
    if (!state.pending) {
      const attempt = state.attempt + 1

      return {
        state: { ...state, attempt, pending: event.position },
        effects: [{ type: "frame.schedule", kind: "save", attempt }],
      }
    }

    if (same(state.pending, event.position)) return { state, effects: NO_SCROLL_EFFECTS }

    // The save frame already scheduled stores the latest offset.
    return { state: { ...state, pending: event.position }, effects: NO_SCROLL_EFFECTS }
  }

  if (event.type === "save.flushed") {
    if (!state.pending || event.attempt !== state.attempt) return { state, effects: NO_SCROLL_EFFECTS }

    return {
      state: { ...state, pending: undefined },
      effects: [{ type: "save.write", sessionKey: state.sessionKey, position: state.pending }],
    }
  }

  // The DOM holds the user's offset now: content changes no longer restore over it.
  return { state, effects: NO_SCROLL_EFFECTS }
}

/** Cancels the scheduled frame and stores the offset still waiting for it. */
function leave(state: Exclude<ContextScrollState, { status: "disposed" }>): readonly ContextScrollEffect[] {
  if (state.status === "restoring" && state.frame) return [{ type: "frame.cancel" }]

  if (state.status !== "tracking" || !state.pending) return NO_SCROLL_EFFECTS

  return [{ type: "frame.cancel" }, { type: "save.write", sessionKey: state.sessionKey, position: state.pending }]
}

function same(a: ScrollPosition, b: ScrollPosition) {
  return a.x === b.x && a.y === b.y
}

function omit(record: Readonly<Record<string, number>>, key: string) {
  return Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key))
}
