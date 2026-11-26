/**
 * Whether a store change must render the prompt into the editable DOM. Runs on every keystroke, so states, events
 * and results are frozen singletons.
 * - `synced`: a store change renders whenever its inline parts differ from what the DOM shows.
 * - `local-blank`: the user's input left only line breaks or zero-width spaces, which the parser reads as an empty
 *   prompt. The store's empty echo of that input keeps them, so Shift+Enter on an empty prompt and deleting its last
 *   character keep their line and native undo; any later empty update renders.
 */
export type EditorSyncState = { readonly status: "synced" } | { readonly status: "local-blank" }

export type EditorSyncEvent =
  /** The user edited the DOM; `blank` when the parser normalized what is left to an empty prompt. */
  | { readonly type: "input.parsed"; readonly blank: boolean }
  /**
   * The store's prompt changed. `matches` when the DOM already shows its inline parts; `blank` when both the DOM and
   * the prompt are empty apart from line breaks and zero-width spaces.
   */
  | { readonly type: "store.changed"; readonly matches: boolean; readonly blank: boolean }

export type EditorSyncTransition = {
  readonly state: EditorSyncState
  readonly render: boolean
}

const SYNCED: EditorSyncState = Object.freeze({ status: "synced" })

const LOCAL_BLANK: EditorSyncState = Object.freeze({ status: "local-blank" })

export const INITIAL_EDITOR_SYNC_STATE: EditorSyncState = SYNCED

export const INPUT_PARSED = Object.freeze({ type: "input.parsed", blank: false }) satisfies EditorSyncEvent

export const INPUT_PARSED_BLANK = Object.freeze({ type: "input.parsed", blank: true }) satisfies EditorSyncEvent

const STORE_MATCHES = Object.freeze({ type: "store.changed", matches: true, blank: false }) satisfies EditorSyncEvent

const STORE_BLANK = Object.freeze({ type: "store.changed", matches: false, blank: true }) satisfies EditorSyncEvent

const STORE_DIFFERS = Object.freeze({ type: "store.changed", matches: false, blank: false }) satisfies EditorSyncEvent

const STAY_SYNCED: EditorSyncTransition = Object.freeze({ state: SYNCED, render: false })

const STAY_LOCAL_BLANK: EditorSyncTransition = Object.freeze({ state: LOCAL_BLANK, render: false })

const RENDER: EditorSyncTransition = Object.freeze({ state: SYNCED, render: true })

/** The reused `store.changed` event for one comparison of the store's prompt with the DOM. */
export function storeChanged(matches: boolean, blank: boolean): EditorSyncEvent {
  if (matches) return STORE_MATCHES

  return blank ? STORE_BLANK : STORE_DIFFERS
}

export function transitionEditorSync(state: EditorSyncState, event: EditorSyncEvent): EditorSyncTransition {
  if (event.type === "input.parsed") return event.blank ? STAY_LOCAL_BLANK : STAY_SYNCED

  if (event.matches) return STAY_SYNCED

  // The blank echo of the user's own input, consumed once.
  if (state.status === "local-blank" && event.blank) return STAY_SYNCED

  return RENDER
}
