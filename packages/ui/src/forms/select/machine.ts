/**
 * The preview a `<Select>` shows for its highlighted option (`onHighlight`, which may return an undo). Unlike a one-shot
 * palette, a select opens and closes repeatedly: choosing the previewed option keeps its preview, choosing another
 * reverts it first, and closing without a choice reverts it. Nothing previews while the menu is closed or closing.
 */
export type SelectHighlightState =
  | { readonly status: "closed" }
  | { readonly status: "idle" }
  | { readonly status: "previewing"; readonly key: string }
  | { readonly status: "committed" }
  | { readonly status: "disposed" }

export type SelectHighlightEvent =
  | { readonly type: "open.changed"; readonly open: boolean }
  | { readonly type: "highlight.changed"; readonly key: string; readonly previewable: boolean }
  /** `closing` is whether the menu closes on this choice (`closeOnSelection`). */
  | { readonly type: "option.selected"; readonly key: string | undefined; readonly closing: boolean }
  | { readonly type: "disposed" }

export type SelectHighlightEffect =
  | { readonly type: "preview.apply"; readonly key: string }
  | { readonly type: "preview.revert" }

export type SelectHighlightTransition = {
  readonly state: SelectHighlightState
  readonly effects: readonly SelectHighlightEffect[]
}

const CLOSED: SelectHighlightState = Object.freeze({ status: "closed" })

const IDLE: SelectHighlightState = Object.freeze({ status: "idle" })

const COMMITTED: SelectHighlightState = Object.freeze({ status: "committed" })

const DISPOSED: SelectHighlightState = Object.freeze({ status: "disposed" })

const NONE: readonly SelectHighlightEffect[] = Object.freeze([])

const REVERT: readonly SelectHighlightEffect[] = Object.freeze([{ type: "preview.revert" }])

export function createSelectHighlightState(open: boolean): SelectHighlightState {
  return open ? IDLE : CLOSED
}

export function transitionSelectHighlight(
  state: SelectHighlightState,
  event: SelectHighlightEvent,
): SelectHighlightTransition {
  if (state.status === "disposed") return { state, effects: NONE }
  const previewing = state.status === "previewing"

  if (event.type === "disposed") return { state: DISPOSED, effects: previewing ? REVERT : NONE }

  if (event.type === "open.changed") {
    if (event.open)
      return { state: state.status === "closed" || state.status === "committed" ? IDLE : state, effects: NONE }

    return { state: CLOSED, effects: previewing ? REVERT : NONE }
  }

  if (event.type === "option.selected") {
    // The chosen option's preview is the committed value; any other preview reverts before the caller commits.
    const effects = previewing && (event.key === undefined || state.key !== event.key) ? REVERT : NONE

    if (!event.closing) return { state: IDLE, effects }

    return { state: state.status === "closed" ? CLOSED : COMMITTED, effects }
  }

  // A closed or closing menu still delivers focus and pointer events to its items (forceMount, exit animation).
  if (state.status === "closed" || state.status === "committed") return { state, effects: NONE }

  if (!event.previewable) return previewing ? { state: IDLE, effects: REVERT } : { state, effects: NONE }

  if (previewing && state.key === event.key) return { state, effects: NONE }

  return {
    state: { status: "previewing", key: event.key },
    effects: [...(previewing ? REVERT : NONE), { type: "preview.apply", key: event.key }],
  }
}
