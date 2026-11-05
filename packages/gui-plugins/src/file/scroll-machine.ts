export type FileScrollPos = {
  readonly x: number
  readonly y: number
}

/** What decides whether the file view can restore or store its scroll now. */
export type FileScrollContext = {
  readonly sessionKey: string
  /** The file tab's scroll key in the layout. */
  readonly scrollKey: string
  /** The code view's scrollable element is mounted. */
  readonly scroller: boolean
  /** The file's content has loaded. */
  readonly loaded: boolean
  /** The session's file view state has loaded; the view restores again once it has. */
  readonly fileReady: boolean
  /** The layout loaded and the session's location is known, so the stored scroll can be read and written. */
  readonly layoutReady: boolean
  /** The file tab is active or visible. */
  readonly shown: boolean
}

export type FileScrollState =
  /**
   * Returns to the stored scroll when the view mounts, shows, loads, reveals a line range or renders rows, until the
   * user scrolls, points, touches or keys the view. Scroll events a restore or a layout clamp fires are not stored.
   */
  | {
      readonly status: "restoring"
      readonly context: FileScrollContext
      /** A restore frame is scheduled. */
      readonly restoreQueued: boolean
      readonly attempt: number
    }
  /** The user placed the view; its scroll is stored once per animation frame. */
  | {
      readonly status: "settled"
      readonly context: FileScrollContext
      /** The latest offset a save frame stores. */
      readonly pending: FileScrollPos | undefined
      readonly attempt: number
    }
  | { readonly status: "disposed"; readonly attempt: number }

export type FileScrollEvent =
  | { readonly type: "context.synced"; readonly context: FileScrollContext }
  /** The file finished rendering or updating its rows. */
  | { readonly type: "restore.requested" }
  /** A link stored a line range's offset for this file; the view scrolls there even after the user scrolled. */
  | { readonly type: "reveal.requested" }
  /** The restore frame scheduled for `attempt` ran. */
  | { readonly type: "restore.stepped"; readonly attempt: number }
  /** The user scrolled with a wheel, pointer, touch or key, or opened find. */
  | { readonly type: "interacted" }
  | { readonly type: "scrolled"; readonly position: FileScrollPos }
  /** The save frame scheduled for `attempt` ran. */
  | { readonly type: "save.stepped"; readonly attempt: number }
  | { readonly type: "disposed" }

export type FileScrollEffect =
  | { readonly type: "frame.restore"; readonly attempt: number }
  | { readonly type: "frame.save"; readonly attempt: number }
  | { readonly type: "frame.cancel" }
  | {
      readonly type: "save.write"
      readonly sessionKey: string
      readonly scrollKey: string
      readonly position: FileScrollPos
    }

export type FileScrollTransition = {
  readonly state: FileScrollState
  readonly effects: readonly FileScrollEffect[]
}

type Active = Exclude<FileScrollState, { status: "disposed" }>

/** Reused on every input event, so the hot path allocates nothing. */
export const FILE_SCROLL_INTERACTED: FileScrollEvent = { type: "interacted" }

export const FILE_SCROLL_RESTORE_REQUESTED: FileScrollEvent = { type: "restore.requested" }

export const FILE_SCROLL_REVEAL_REQUESTED: FileScrollEvent = { type: "reveal.requested" }

const NONE: readonly FileScrollEffect[] = []

const CANCEL: readonly FileScrollEffect[] = [{ type: "frame.cancel" }]

export function createFileScrollState(): FileScrollState {
  return {
    status: "restoring",
    context: {
      sessionKey: "",
      scrollKey: "",
      scroller: false,
      loaded: false,
      fileReady: false,
      layoutReady: false,
      shown: false,
    },
    restoreQueued: false,
    attempt: 0,
  }
}

export function transitionFileScroll(state: FileScrollState, event: FileScrollEvent): FileScrollTransition {
  if (state.status === "disposed") return unchanged(state)

  // An unmount or a hidden tab still stores the user's last offset.
  if (event.type === "disposed")
    return { state: { status: "disposed", attempt: state.attempt + 1 }, effects: stop(state) }

  if (event.type === "context.synced") return synced(state, event.context)

  if (event.type === "restore.requested")
    return state.status === "restoring" && !state.restoreQueued && restorable(state.context)
      ? restore(state.context, state.attempt + 1, NONE)
      : unchanged(state)

  // The reveal's offset is already stored; an unsaved user offset must not overwrite it.
  if (event.type === "reveal.requested") {
    const cancel = framed(state) ? CANCEL : NONE

    if (restorable(state.context)) return restore(state.context, state.attempt + 1, cancel)

    return {
      state: { status: "restoring", context: state.context, restoreQueued: false, attempt: state.attempt + 1 },
      effects: cancel,
    }
  }

  if (event.type === "restore.stepped")
    return state.status === "restoring" && state.restoreQueued && event.attempt === state.attempt
      ? changed({ ...state, restoreQueued: false })
      : unchanged(state)

  if (event.type === "interacted") {
    if (state.status === "settled" || !state.context.scroller || !state.context.shown) return unchanged(state)

    return {
      state: { status: "settled", context: state.context, pending: undefined, attempt: state.attempt + 1 },
      effects: state.restoreQueued ? CANCEL : NONE,
    }
  }

  if (event.type === "scrolled") {
    if (state.status !== "settled" || !restorable(state.context)) return unchanged(state)

    if (!state.pending) {
      const attempt = state.attempt + 1

      return {
        state: { ...state, pending: event.position, attempt },
        effects: [{ type: "frame.save", attempt }],
      }
    }

    if (state.pending.x === event.position.x && state.pending.y === event.position.y) return unchanged(state)

    return changed({ ...state, pending: event.position })
  }

  if (state.status !== "settled" || !state.pending || event.attempt !== state.attempt) return unchanged(state)

  return { state: { ...state, pending: undefined }, effects: [write(state.context, state.pending)] }
}

/** Whether the restore frame scheduled for `attempt` may still move the view. */
export function canRestoreFileScroll(state: FileScrollState, attempt: number) {
  return state.status === "restoring" && state.restoreQueued && state.attempt === attempt && restorable(state.context)
}

/** Whether a scroll event's offset is the user's to store. */
export function canSaveFileScroll(state: FileScrollState) {
  return state.status === "settled" && restorable(state.context)
}

export function sameFileScrollContext(a: FileScrollContext, b: FileScrollContext) {
  return (
    a.sessionKey === b.sessionKey &&
    a.scrollKey === b.scrollKey &&
    a.scroller === b.scroller &&
    a.loaded === b.loaded &&
    a.fileReady === b.fileReady &&
    a.layoutReady === b.layoutReady &&
    a.shown === b.shown
  )
}

function synced(state: Active, context: FileScrollContext): FileScrollTransition {
  if (sameFileScrollContext(state.context, context)) return unchanged(state)
  const target = state.context.sessionKey === context.sessionKey && state.context.scrollKey === context.scrollKey

  if (state.status === "settled") {
    // The user keeps the view while it stays mounted and shown; a late load or render does not move it.
    if (target && restorable(context)) return changed({ ...state, context })

    // Another file or session, a hidden tab or an unmounted view: store the user's offset, restore on the next show.
    const flushed = stop(state)

    if (restorable(context)) return restore(context, state.attempt + 1, flushed)

    return {
      state: { status: "restoring", context, restoreQueued: false, attempt: state.attempt + 1 },
      effects: flushed,
    }
  }

  const cancel = state.restoreQueued ? CANCEL : NONE

  if (!restorable(context))
    return {
      state: {
        status: "restoring",
        context,
        restoreQueued: false,
        attempt: state.restoreQueued ? state.attempt + 1 : state.attempt,
      },
      effects: cancel,
    }

  if (!target || !restorable(state.context) || (context.fileReady && !state.context.fileReady))
    return restore(context, state.attempt + 1, cancel)

  return changed({ ...state, context })
}

function restore(
  context: FileScrollContext,
  attempt: number,
  before: readonly FileScrollEffect[],
): FileScrollTransition {
  return {
    state: { status: "restoring", context, restoreQueued: true, attempt },
    effects: [...before, { type: "frame.restore", attempt }],
  }
}

/** Cancels a scheduled frame, storing the user's offset a save frame was waiting to store. */
function stop(state: Active): readonly FileScrollEffect[] {
  if (state.status === "restoring") return state.restoreQueued ? CANCEL : NONE

  return state.pending ? [...CANCEL, write(state.context, state.pending)] : NONE
}

function write(context: FileScrollContext, position: FileScrollPos): FileScrollEffect {
  return { type: "save.write", sessionKey: context.sessionKey, scrollKey: context.scrollKey, position }
}

/** Whether a restore or save frame is scheduled. */
function framed(state: Active) {
  return state.status === "restoring" ? state.restoreQueued : state.pending !== undefined
}

function restorable(context: FileScrollContext) {
  return Boolean(
    context.sessionKey &&
      context.scrollKey &&
      context.scroller &&
      context.loaded &&
      context.layoutReady &&
      context.shown,
  )
}

function changed(state: FileScrollState): FileScrollTransition {
  return { state, effects: NONE }
}

function unchanged(state: FileScrollState): FileScrollTransition {
  return { state, effects: NONE }
}
