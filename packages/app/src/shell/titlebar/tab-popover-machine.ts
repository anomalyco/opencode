// Initial hover delay before the preview appears, per design.
export const TAB_PREVIEW_OPEN_DELAY_MS = 750

// After a preview closes, hovering a neighbouring tab within this window skips the open delay, as the tooltip's
// skipDelayDuration does, so moving across tabs doesn't re-wait the full delay each time.
export const TAB_PREVIEW_SKIP_WINDOW_MS = 500

/** One tab's preview. `close` asks that tab to close its preview when another one takes over. */
export type TabPreviewOwner = {
  readonly close: () => void
}

/** The vertical row a card follows the pointer over, and the card itself. */
export type TabPreviewFollow<El> = {
  readonly trigger: El
  readonly card: El
}

/**
 * The one tab preview shared by every tab strip. `cold` waits the full open delay; `open` and `warm` (just closed)
 * open the next preview at once. `instant` marks a preview opened during such a streak, which shows without animating.
 */
export type TabPreviewState<El = HTMLElement> =
  | { readonly status: "cold"; readonly attempt: number }
  | {
      readonly status: "open"
      readonly attempt: number
      readonly owner: TabPreviewOwner
      readonly instant: boolean
      readonly follow: TabPreviewFollow<El> | undefined
    }
  | { readonly status: "warm"; readonly attempt: number; readonly instant: boolean }

export type TabPreviewEvent<El = HTMLElement> =
  | { readonly type: "preview.opened"; readonly owner: TabPreviewOwner }
  | { readonly type: "preview.closed"; readonly owner: TabPreviewOwner }
  | { readonly type: "owner.disposed"; readonly owner: TabPreviewOwner }
  | {
      readonly type: "follow.attached"
      readonly owner: TabPreviewOwner
      readonly trigger: El
      readonly card: El
      readonly reducedMotion: boolean
    }
  | { readonly type: "warm.expired"; readonly attempt: number }

export type TabPreviewEffect<El = HTMLElement> =
  | { readonly type: "owner.close"; readonly owner: TabPreviewOwner }
  | { readonly type: "follow.start"; readonly trigger: El; readonly card: El }
  | { readonly type: "follow.stop" }
  | { readonly type: "warm.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "warm.clear" }

export type TabPreviewTransition<El = HTMLElement> = {
  readonly state: TabPreviewState<El>
  readonly effects: readonly TabPreviewEffect<El>[]
}

export const INITIAL_TAB_PREVIEW_STATE: TabPreviewState<never> = Object.freeze({ status: "cold", attempt: 0 })

const NONE: readonly never[] = []

const STOP: readonly TabPreviewEffect<never>[] = [{ type: "follow.stop" }]

export function transitionTabPreview<El>(
  state: TabPreviewState<El>,
  event: TabPreviewEvent<El>,
): TabPreviewTransition<El> {
  if (event.type === "preview.opened") {
    if (state.status === "open" && state.owner === event.owner) return unchanged(state)

    return {
      state: {
        status: "open",
        attempt: state.attempt,
        owner: event.owner,
        instant: state.status !== "cold",
        follow: undefined,
      },
      effects:
        state.status === "warm"
          ? [{ type: "warm.clear" }]
          : state.status === "open"
            ? [...stop(state), { type: "owner.close", owner: state.owner }]
            : NONE,
    }
  }

  if (event.type === "preview.closed" || event.type === "owner.disposed") {
    if (state.status !== "open" || state.owner !== event.owner) return unchanged(state)
    const attempt = state.attempt + 1

    return {
      state: { status: "warm", attempt, instant: state.instant },
      effects: [...stop(state), { type: "warm.start", attempt, delayMs: TAB_PREVIEW_SKIP_WINDOW_MS }],
    }
  }

  if (event.type === "follow.attached") {
    if (state.status !== "open" || state.owner !== event.owner) return unchanged(state)

    if (event.reducedMotion)
      return state.follow ? { state: { ...state, follow: undefined }, effects: STOP } : unchanged(state)

    if (state.follow?.trigger === event.trigger && state.follow.card === event.card) return unchanged(state)

    return {
      state: { ...state, follow: { trigger: event.trigger, card: event.card } },
      effects: [...stop(state), { type: "follow.start", trigger: event.trigger, card: event.card }],
    }
  }

  if (state.status !== "warm" || state.attempt !== event.attempt) return unchanged(state)

  return { state: { status: "cold", attempt: state.attempt }, effects: NONE }
}

/** Kobalte reads the open delay when the pointer enters a trigger, so a streak skips it. */
export function selectTabPreviewOpenDelay(state: TabPreviewState<unknown>) {
  return state.status === "cold" ? TAB_PREVIEW_OPEN_DELAY_MS : 0
}

export function selectTabPreviewInstant(state: TabPreviewState<unknown>) {
  return state.status !== "cold" && state.instant
}

/** The card that follows the pointer over `trigger`, when `trigger` owns the open preview in the vertical strip. */
export function selectTabPreviewFollowCard<El>(state: TabPreviewState<El>, trigger: El | undefined) {
  if (state.status !== "open" || state.follow === undefined || state.follow.trigger !== trigger) return

  return state.follow.card
}

function stop<El>(state: Extract<TabPreviewState<El>, { status: "open" }>): readonly TabPreviewEffect<El>[] {
  return state.follow ? STOP : NONE
}

function unchanged<El>(state: TabPreviewState<El>): TabPreviewTransition<El> {
  return { state, effects: NONE }
}
