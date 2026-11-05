/**
 * The preview a palette shows for its highlighted command, such as a theme. Choosing an entry commits the palette:
 * the chosen entry's preview stays, any other preview reverts, and nothing previews while the dialog closes.
 */
export type PaletteHighlightState =
  | { readonly status: "idle" }
  | { readonly status: "previewing"; readonly entryID: string }
  | { readonly status: "committed" }
  | { readonly status: "disposed" }

export type PaletteHighlightEvent =
  | { readonly type: "highlight.changed"; readonly entryID: string | undefined; readonly previewable: boolean }
  | { readonly type: "entry.selected"; readonly entryID: string }
  | { readonly type: "disposed" }

export type PaletteHighlightEffect = { readonly type: "preview.apply"; readonly entryID: string } | { readonly type: "preview.revert" }

export type PaletteHighlightTransition = {
  readonly state: PaletteHighlightState
  readonly effects: readonly PaletteHighlightEffect[]
}

export const INITIAL_PALETTE_HIGHLIGHT_STATE: PaletteHighlightState = Object.freeze({ status: "idle" })

const COMMITTED: PaletteHighlightState = Object.freeze({ status: "committed" })

const DISPOSED: PaletteHighlightState = Object.freeze({ status: "disposed" })

const REVERT: readonly PaletteHighlightEffect[] = [{ type: "preview.revert" }]

export function transitionPaletteHighlight(
  state: PaletteHighlightState,
  event: PaletteHighlightEvent,
): PaletteHighlightTransition {
  if (state.status === "committed" || state.status === "disposed") return { state, effects: [] }
  const previewing = state.status === "previewing"

  if (event.type === "disposed") return { state: DISPOSED, effects: previewing ? REVERT : [] }

  if (event.type === "entry.selected")
    return { state: COMMITTED, effects: previewing && state.entryID !== event.entryID ? REVERT : [] }

  if (!event.entryID || !event.previewable)
    return previewing ? { state: INITIAL_PALETTE_HIGHLIGHT_STATE, effects: REVERT } : { state, effects: [] }

  if (previewing && state.entryID === event.entryID) return { state, effects: [] }

  return {
    state: { status: "previewing", entryID: event.entryID },
    effects: [...(previewing ? REVERT : []), { type: "preview.apply", entryID: event.entryID }],
  }
}
