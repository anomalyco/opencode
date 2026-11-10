/** What started a rename: a double-click on the title, or the tab's context menu. */
export type RenameSource = "pointer" | "menu"

/**
 * A terminal tab's inline rename. `arming` shows the field while focus settles: the trigger or the closing menu still
 * moves focus, so a blur then does not end the edit. `editing` saves on blur. `issued` is the last attempt handed out.
 */
export type RenameState =
  | { readonly status: "idle"; readonly issued: number }
  | {
      readonly status: "arming"
      readonly issued: number
      readonly attempt: number
      readonly source: RenameSource
      readonly draft: string
      /** The user typed before the field armed, so arming leaves their text unselected. */
      readonly edited: boolean
    }
  | { readonly status: "editing"; readonly issued: number; readonly draft: string }

export type RenameEvent =
  /** `enabled` is false for a terminal that cannot be renamed. */
  | { readonly type: "start"; readonly title: string; readonly source: RenameSource; readonly enabled: boolean }
  /** The field took focus after the attempt's frame. */
  | { readonly type: "armed"; readonly attempt: number }
  | { readonly type: "change"; readonly value: string }
  /** Enter. */
  | { readonly type: "submit" }
  | { readonly type: "blur" }
  /** Escape. */
  | { readonly type: "cancel" }

export type RenameEffect =
  /** Focus the field: a double-click at once and again next frame, a menu pick once the menu has closed. */
  | { readonly type: "arm"; readonly attempt: number; readonly source: RenameSource }
  | { readonly type: "disarm" }
  /** `null` for an emptied field. */
  | { readonly type: "save"; readonly title: string | null }

export type RenameTransition = { readonly state: RenameState; readonly effects: readonly RenameEffect[] }

export const initialRenameState: RenameState = { status: "idle", issued: 0 }

const NONE: readonly RenameEffect[] = []

const DISARM: readonly RenameEffect[] = [{ type: "disarm" }]

export function transitionRename(state: RenameState, event: RenameEvent): RenameTransition {
  if (event.type === "start") {
    // A rename already open keeps its field, its draft and its blur handling.
    if (state.status !== "idle" || !event.enabled) return { state, effects: NONE }
    const attempt = state.issued + 1

    return {
      state: { status: "arming", issued: attempt, attempt, source: event.source, draft: event.title, edited: false },
      effects: [{ type: "arm", attempt, source: event.source }],
    }
  }

  if (state.status === "idle") return { state, effects: NONE }

  if (event.type === "armed")
    return {
      state:
        state.status === "arming" && state.attempt === event.attempt
          ? { status: "editing", issued: state.issued, draft: state.draft }
          : state,
      effects: NONE,
    }

  if (event.type === "change") {
    if (event.value === state.draft) return { state, effects: NONE }

    return {
      state:
        state.status === "arming" ? { ...state, draft: event.value, edited: true } : { ...state, draft: event.value },
      effects: NONE,
    }
  }

  if (event.type === "blur" && state.status === "arming") return { state, effects: NONE }

  const disarm = state.status === "arming" ? DISARM : NONE
  const idle: RenameState = { status: "idle", issued: state.issued }

  // Ending the edit unmounts the focused field, whose blur then finds nothing to save.
  if (event.type === "cancel") return { state: idle, effects: disarm }

  return { state: idle, effects: [...disarm, { type: "save", title: state.draft.trim() || null }] }
}

export function isRenaming(state: RenameState) {
  return state.status !== "idle"
}

export function renameDraft(state: RenameState) {
  return state.status === "idle" ? "" : state.draft
}
