import type { HistorySeekStatus } from "./history-machine"

const SHELL_PREFIX = "sh_"

/**
 * The most older pages one search loads. A shell that a Code Mode script started has a notice but no call, and nothing
 * in the transcript says where its call would be: an ID does not, because IDs do not sort in the transcript's order.
 * Without a limit a click on such a notice would load the whole session. In four real sessions a call was a median 9
 * messages before its notice and 672 at the 99th percentile; ten pages are 200 messages, and the reader's next click
 * searches ten more.
 */
const REVEAL_SEEK_PAGES = 10

/**
 * The search for a shell's tool call that is older than the loaded messages. A route or a shell notice asked for it,
 * and history pages toward it until it loads, history ends, or the search has loaded its share of pages.
 */
export type RevealSeekState =
  | { readonly status: "idle" }
  | { readonly status: "seeking"; readonly target: string; /** Older pages asked for so far. */ readonly pages: number }

export type RevealSeekEvent =
  /** The route or a row asked for `target`. `found`: it is among the loaded messages and now revealed. */
  | { readonly type: "reveal.requested"; readonly target: string; readonly found: boolean }
  /**
   * The timeline looked again. `found`: the call is loaded and now revealed. Otherwise history paging decides
   * whether an older page can still hold it.
   */
  | { readonly type: "seek.synced"; readonly found: boolean; readonly history: HistorySeekStatus }
  /**
   * The reader moved the view, gave scroll input, pressed in the timeline, or asked to go somewhere else. A call found
   * later would take the view from where they are.
   */
  | { readonly type: "seek.cancelled" }

/** Load the next older page toward the call. */
export type RevealSeekEffect = { readonly type: "history.seek" }

export type RevealSeekTransition = {
  readonly state: RevealSeekState
  readonly effects: readonly RevealSeekEffect[]
}

// Shared, so ending a seek allocates no event.
export const SEEK_CANCELLED_EVENT: RevealSeekEvent = Object.freeze({ type: "seek.cancelled" })

const IDLE: RevealSeekState = Object.freeze({ status: "idle" })

const NO_EFFECTS: readonly RevealSeekEffect[] = Object.freeze([])

const HISTORY_SEEK: readonly RevealSeekEffect[] = Object.freeze([{ type: "history.seek" }])

export function createRevealSeekState(): RevealSeekState {
  return IDLE
}

export function transitionRevealSeek(state: RevealSeekState, event: RevealSeekEvent): RevealSeekTransition {
  if (event.type === "reveal.requested") {
    // A found call ends a seek for another one. A call named by its own ID is looked for among the loaded messages
    // only: no code path asks for one that is not loaded.
    if (event.found || !event.target.startsWith(SHELL_PREFIX)) return settled(IDLE)

    if (state.status === "seeking" && state.target === event.target) return settled(state)

    return settled({ status: "seeking", target: event.target, pages: 0 })
  }

  if (state.status === "idle") return settled(state)

  if (event.type === "seek.cancelled" || event.found) return settled(IDLE)

  if (event.history === "loading") return settled(state)

  // History ran out or a page failed, so the call cannot load; or this search has loaded its share.
  if (event.history !== "seekable" || state.pages >= REVEAL_SEEK_PAGES) return settled(IDLE)

  return { state: { status: "seeking", target: state.target, pages: state.pages + 1 }, effects: HISTORY_SEEK }
}

/** The call history pages toward, while one is sought. */
export function revealSeekTarget(state: RevealSeekState) {
  return state.status === "seeking" ? state.target : undefined
}

function settled(state: RevealSeekState): RevealSeekTransition {
  return { state, effects: NO_EFFECTS }
}
