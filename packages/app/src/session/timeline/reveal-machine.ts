import type { HistorySeekStatus } from "./history-machine"

const SHELL_PREFIX = "sh_"

const MESSAGE_PREFIX = "msg_"

/**
 * The search for a shell's tool call that is older than the loaded messages. A route or a shell notice asked for it,
 * and history pages toward it until it loads or the loaded messages reach back to where it would be.
 */
export type RevealSeekState =
  | { readonly status: "idle" }
  | { readonly status: "seeking"; readonly target: string }

export type RevealSeekEvent =
  /** The route or a row asked for `target`. `found`: it is among the loaded messages and now revealed. */
  | { readonly type: "reveal.requested"; readonly target: string; readonly found: boolean }
  /**
   * The timeline looked again. `found`: the call is loaded and now revealed. Otherwise the oldest loaded assistant
   * message and history paging decide whether an older page can still hold it.
   */
  | {
      readonly type: "seek.synced"
      readonly found: boolean
      readonly oldestAssistantID: string | undefined
      readonly history: HistorySeekStatus
    }
  /** The reader scrolled or pressed in the timeline, so a call found later would move the view against them. */
  | { readonly type: "seek.cancelled" }

/** Load the next older page toward the call. */
export type RevealSeekEffect = { readonly type: "history.seek" }

export type RevealSeekTransition = {
  readonly state: RevealSeekState
  readonly effects: readonly RevealSeekEffect[]
}

// Shared for the dispatch on every scroll gesture, so it allocates nothing.
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
    // only: nothing says how far back it is, so one that does not exist would page through the whole session.
    if (event.found || !event.target.startsWith(SHELL_PREFIX)) return settled(IDLE)

    if (state.status === "seeking" && state.target === event.target) return settled(state)

    return settled({ status: "seeking", target: event.target })
  }

  if (state.status === "idle") return settled(state)

  if (event.type === "seek.cancelled" || event.found) return settled(IDLE)

  if (reachesShell(event.oldestAssistantID, state.target)) return settled(IDLE)

  if (event.history === "seekable") return { state, effects: HISTORY_SEEK }

  if (event.history === "loading") return settled(state)

  // History ran out or a page failed, so the call cannot load.
  return settled(IDLE)
}

/** The call history pages toward, while one is sought. */
export function revealSeekTarget(state: RevealSeekState) {
  return state.status === "seeking" ? state.target : undefined
}

// A shell's call runs in the newest assistant message created before the shell, and IDs ascend with creation. Once an
// assistant message older than the shell is loaded, the call is among the loaded messages or does not exist, as for
// a shell that a Code Mode script started.
function reachesShell(oldestAssistantID: string | undefined, shellID: string) {
  return (
    oldestAssistantID !== undefined &&
    oldestAssistantID.slice(MESSAGE_PREFIX.length) < shellID.slice(SHELL_PREFIX.length)
  )
}

function settled(state: RevealSeekState): RevealSeekTransition {
  return { state, effects: NO_EFFECTS }
}
