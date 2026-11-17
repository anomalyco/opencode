export const TAB_RENAME_SAVE_TIMEOUT_MS = 15_000

/** What started a rename: a double-click on the title, or the tab's context menu. */
export type TabRenameSource = "pointer" | "menu"

/**
 * The tab's title save. While saves overlap, only the latest one decides the outcome; `confirmed` is the title the
 * server last accepted, which a failed latest save restores. `settledAttempt` is the newest attempt that has answered.
 */
export type TabRenameSave =
  | { readonly status: "idle"; readonly settledAttempt: number }
  | {
      readonly status: "saving"
      readonly attempt: number
      readonly settledAttempt: number
      readonly sessionID: string
      readonly optimistic: string
      readonly confirmed: string | undefined
    }

type TabRenameFields = {
  readonly editIssued: number
  readonly saveIssued: number
  readonly menuOpen: boolean
  readonly save: TabRenameSave
}

/**
 * A session tab's inline rename. `arming` makes the title editable while focus settles: the trigger or the closing
 * menu still moves focus, so a blur then does not end the edit. `editing` saves on blur.
 */
export type TabRenameState =
  | (TabRenameFields & { readonly status: "idle" })
  | (TabRenameFields & {
      readonly status: "arming"
      readonly attempt: number
      readonly sessionID: string
      readonly source: TabRenameSource
      readonly initial: string
      readonly draft: string
      /** The user typed before the title armed, so arming leaves their text unselected. */
      readonly edited: boolean
    })
  | (TabRenameFields & {
      readonly status: "editing"
      readonly sessionID: string
      readonly initial: string
      readonly draft: string
    })
  | { readonly status: "disposed" }

export type TabRenameEvent =
  | { readonly type: "menu.changed"; readonly open: boolean }
  /** `enabled` is false while the tab is dragged. */
  | {
      readonly type: "edit.start"
      readonly source: TabRenameSource
      readonly sessionID: string | undefined
      readonly title: string
      readonly enabled: boolean
    }
  /** The title took focus after the attempt's frame. */
  | { readonly type: "edit.armed"; readonly attempt: number }
  | { readonly type: "edit.input"; readonly value: string }
  | { readonly type: "edit.blur"; readonly currentTitle: string | undefined }
  /** Enter, or a pointer down outside the tab. */
  | { readonly type: "edit.submit"; readonly currentTitle: string | undefined }
  /** Escape. */
  | { readonly type: "edit.cancel" }
  | { readonly type: "session.changed"; readonly sessionID: string | undefined }
  | { readonly type: "save.succeeded"; readonly attempt: number; readonly title: string }
  | {
      readonly type: "save.failed"
      readonly attempt: number
      readonly currentTitle: string | undefined
      readonly error: unknown
    }
  | { readonly type: "save.timed-out"; readonly attempt: number; readonly currentTitle: string | undefined }
  | { readonly type: "disposed" }

export type TabRenameEffect =
  /** Focus the title: a double-click at once and again next frame, a menu pick once the menu has closed. */
  | { readonly type: "editor.arm"; readonly attempt: number; readonly source: TabRenameSource; readonly text: string }
  | { readonly type: "editor.disarm" }
  | { readonly type: "editor.reset" }
  | { readonly type: "session.remember"; readonly sessionID: string; readonly title: string | undefined }
  | {
      readonly type: "save.start"
      readonly attempt: number
      readonly sessionID: string
      readonly title: string
      readonly timeoutMs: number
    }
  | { readonly type: "save.abort"; readonly attempt: number }
  /** Stops the save timers without aborting a request the user already committed. */
  | { readonly type: "save.clear-timers" }
  | { readonly type: "toast.failed"; readonly error: unknown }

export type TabRenameTransition = {
  readonly state: TabRenameState
  readonly effects: readonly TabRenameEffect[]
}

export const INITIAL_TAB_RENAME_STATE: TabRenameState = Object.freeze({
  status: "idle",
  editIssued: 0,
  saveIssued: 0,
  menuOpen: false,
  save: Object.freeze({ status: "idle", settledAttempt: 0 }),
})

const DISPOSED: TabRenameState = Object.freeze({ status: "disposed" })

const NONE: readonly TabRenameEffect[] = []

export function transitionTabRename(state: TabRenameState, event: TabRenameEvent): TabRenameTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed")
    return {
      state: DISPOSED,
      effects: [...disarm(state), ...(state.save.status === "saving" ? [{ type: "save.clear-timers" } as const] : [])],
    }

  if (event.type === "menu.changed")
    return state.menuOpen === event.open
      ? unchanged(state)
      : { state: { ...state, menuOpen: event.open }, effects: NONE }

  if (event.type === "edit.start") {
    // A rename already open keeps its title, its draft and its blur handling.
    if (state.status !== "idle" || !event.enabled || !event.sessionID) return unchanged(state)
    const attempt = state.editIssued + 1

    return {
      state: {
        ...fields(state),
        status: "arming",
        editIssued: attempt,
        menuOpen: false,
        attempt,
        sessionID: event.sessionID,
        source: event.source,
        initial: event.title,
        draft: event.title,
        edited: false,
      },
      effects: [{ type: "editor.arm", attempt, source: event.source, text: event.title }],
    }
  }

  if (event.type === "session.changed") return changeSession(state, event.sessionID)

  if (event.type === "save.succeeded") return saveSucceeded(state, event.attempt, event.title)

  if (event.type === "save.failed" || event.type === "save.timed-out") return saveFailed(state, event)

  if (state.status === "idle") return unchanged(state)

  if (event.type === "edit.armed") {
    if (state.status !== "arming" || state.attempt !== event.attempt) return unchanged(state)

    return {
      state: {
        ...fields(state),
        status: "editing",
        sessionID: state.sessionID,
        initial: state.initial,
        draft: state.draft,
      },
      effects: NONE,
    }
  }

  if (event.type === "edit.input") {
    if (event.value === state.draft) return unchanged(state)

    return {
      state:
        state.status === "arming" ? { ...state, draft: event.value, edited: true } : { ...state, draft: event.value },
      effects: NONE,
    }
  }

  if (event.type === "edit.blur" && state.status === "arming") return unchanged(state)
  const close = [...disarm(state), { type: "editor.reset" } as const]
  const idle = { ...fields(state), status: "idle" } as const

  if (event.type === "edit.cancel") return { state: idle, effects: close }
  const next = state.draft.trim()

  if (!next || next === state.initial) return { state: idle, effects: close }
  const attempt = state.saveIssued + 1

  return {
    state: {
      ...idle,
      saveIssued: attempt,
      save: {
        status: "saving",
        attempt,
        settledAttempt: state.save.settledAttempt,
        sessionID: state.sessionID,
        optimistic: next,
        // An overlapping save keeps the last title the server accepted, never the previous optimistic one.
        confirmed:
          state.save.status === "saving" && state.save.sessionID === state.sessionID
            ? state.save.confirmed
            : event.currentTitle,
      },
    },
    effects: [
      ...close,
      { type: "session.remember", sessionID: state.sessionID, title: next },
      { type: "save.start", attempt, sessionID: state.sessionID, title: next, timeoutMs: TAB_RENAME_SAVE_TIMEOUT_MS },
    ],
  }
}

export function isTabRenaming(state: TabRenameState) {
  return state.status === "arming" || state.status === "editing"
}

export function selectTabMenuOpen(state: TabRenameState) {
  return state.status !== "disposed" && state.menuOpen
}

export function selectTabPreviewBlocked(state: TabRenameState) {
  return isTabRenaming(state) || selectTabMenuOpen(state)
}

type LiveState = Exclude<TabRenameState, { status: "disposed" }>

function changeSession(state: LiveState, sessionID: string | undefined): TabRenameTransition {
  const renaming = state.status !== "idle" && state.sessionID !== sessionID
  const saving = state.save.status === "saving" && state.save.sessionID !== sessionID

  if (!renaming && !saving) return unchanged(state)
  const save: TabRenameSave = saving ? { status: "idle", settledAttempt: state.save.settledAttempt } : state.save
  const clear: readonly TabRenameEffect[] = saving ? [{ type: "save.clear-timers" }] : NONE

  if (!renaming) return { state: { ...state, save }, effects: clear }

  return {
    state: { ...fields(state), status: "idle", save },
    effects: [...disarm(state), { type: "editor.reset" }, ...clear],
  }
}

function saveSucceeded(state: LiveState, attempt: number, title: string): TabRenameTransition {
  const save = state.save

  if (save.status !== "saving" || attempt <= save.settledAttempt || attempt > save.attempt) return unchanged(state)

  if (attempt === save.attempt)
    return { state: { ...state, save: { status: "idle", settledAttempt: attempt } }, effects: NONE }

  // An older save landed while a newer one is in flight: its title is now the one to restore.
  return { state: { ...state, save: { ...save, settledAttempt: attempt, confirmed: title } }, effects: NONE }
}

function saveFailed(
  state: LiveState,
  event: Extract<TabRenameEvent, { type: "save.failed" | "save.timed-out" }>,
): TabRenameTransition {
  const save = state.save

  const abort: readonly TabRenameEffect[] =
    event.type === "save.timed-out" ? [{ type: "save.abort", attempt: event.attempt }] : NONE

  // A superseded save's failure changes nothing: the newer save owns the title.
  if (save.status !== "saving" || save.attempt !== event.attempt) return { state, effects: abort }

  return {
    state: { ...state, save: { status: "idle", settledAttempt: event.attempt } },
    effects: [
      ...abort,
      // A title the server pushed meanwhile stays.
      ...(event.currentTitle === save.optimistic
        ? [{ type: "session.remember", sessionID: save.sessionID, title: save.confirmed } as const]
        : []),
      { type: "toast.failed", error: event.type === "save.failed" ? event.error : undefined },
    ],
  }
}

function fields(state: LiveState): TabRenameFields {
  return { editIssued: state.editIssued, saveIssued: state.saveIssued, menuOpen: state.menuOpen, save: state.save }
}

function disarm(state: LiveState): readonly TabRenameEffect[] {
  return state.status === "arming" ? [{ type: "editor.disarm" }] : NONE
}

function unchanged(state: TabRenameState): TabRenameTransition {
  return { state, effects: NONE }
}
