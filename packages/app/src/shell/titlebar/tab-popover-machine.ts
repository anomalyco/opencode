// Initial hover delay before the preview appears, per design.
export const TAB_PREVIEW_OPEN_DELAY_MS = 750

// After a preview closes, hovering a neighbouring tab within this window skips the open delay, as the tooltip's
// skipDelayDuration does, so moving across tabs doesn't re-wait the full delay each time.
export const TAB_PREVIEW_SKIP_WINDOW_MS = 500

/** One tab's preview. `close` asks that tab to close its preview when another one takes over. */
export type TabPreviewOwner = {
  readonly close: () => void
}

/**
 * The one tab preview shared by every tab strip. `cold` waits the full open delay; `open` and `warm` (just closed)
 * open the next preview at once. `instant` marks a preview opened during such a streak, which shows without animating.
 */
export type TabPreviewState =
  | { readonly status: "cold"; readonly attempt: number }
  | {
      readonly status: "open"
      readonly attempt: number
      readonly owner: TabPreviewOwner
      readonly instant: boolean
    }
  | { readonly status: "warm"; readonly attempt: number; readonly instant: boolean }

export type TabPreviewEvent =
  | { readonly type: "preview.opened"; readonly owner: TabPreviewOwner }
  | { readonly type: "preview.closed"; readonly owner: TabPreviewOwner }
  | { readonly type: "owner.disposed"; readonly owner: TabPreviewOwner }
  | { readonly type: "warm.expired"; readonly attempt: number }

export type TabPreviewEffect =
  | { readonly type: "owner.close"; readonly owner: TabPreviewOwner }
  | { readonly type: "warm.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "warm.clear" }

export type TabPreviewTransition = {
  readonly state: TabPreviewState
  readonly effects: readonly TabPreviewEffect[]
}

export const INITIAL_TAB_PREVIEW_STATE: TabPreviewState = Object.freeze({ status: "cold", attempt: 0 })

const NONE: readonly never[] = []

export function transitionTabPreview(state: TabPreviewState, event: TabPreviewEvent): TabPreviewTransition {
  if (event.type === "preview.opened") {
    if (state.status === "open" && state.owner === event.owner) return unchanged(state)

    const next: TabPreviewState = {
      status: "open",
      attempt: state.attempt,
      owner: event.owner,
      instant: state.status !== "cold",
    }

    if (state.status === "cold") return { state: next, effects: NONE }

    if (state.status === "warm") return { state: next, effects: [{ type: "warm.clear" }] }

    // Another tab's preview takes over at once and closes the one that was up.
    return { state: next, effects: [{ type: "owner.close", owner: state.owner }] }
  }

  if (event.type === "preview.closed" || event.type === "owner.disposed") {
    if (state.status !== "open" || state.owner !== event.owner) return unchanged(state)
    const attempt = state.attempt + 1

    return {
      state: { status: "warm", attempt, instant: state.instant },
      effects: [{ type: "warm.start", attempt, delayMs: TAB_PREVIEW_SKIP_WINDOW_MS }],
    }
  }

  if (state.status !== "warm" || state.attempt !== event.attempt) return unchanged(state)

  return { state: { status: "cold", attempt: state.attempt }, effects: NONE }
}

/** Kobalte reads the open delay when the pointer enters a trigger, so a streak skips it. */
export function selectTabPreviewOpenDelay(state: TabPreviewState) {
  return state.status === "cold" ? TAB_PREVIEW_OPEN_DELAY_MS : 0
}

export function selectTabPreviewInstant(state: TabPreviewState) {
  return state.status !== "cold" && state.instant
}

function unchanged(state: TabPreviewState): TabPreviewTransition {
  return { state, effects: NONE }
}
