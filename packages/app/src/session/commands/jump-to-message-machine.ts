import type { JumpPrompt } from "./jump-to-message"

/**
 * The jump dialog browses the loaded timeline's prompts at once while older ones load, and opens an unloaded prompt by
 * paging the timeline back to it. `failed` is a history that did not load; `retry` loads it again. A failed open
 * returns to `ready` with `failed` set, and selecting the prompt again tries again.
 */
export type JumpToMessageState =
  | { readonly status: "loading"; readonly attempt: number }
  | { readonly status: "failed"; readonly attempt: number }
  | {
      readonly status: "ready"
      readonly attempt: number
      readonly history: readonly JumpPrompt[]
      readonly failed: boolean
    }
  | {
      readonly status: "opening"
      readonly attempt: number
      readonly history: readonly JumpPrompt[]
      readonly target: string
    }
  | { readonly status: "closed" }

export type JumpToMessageEvent =
  | {
      readonly type: "history.loaded"
      readonly attempt: number
      readonly history: readonly JumpPrompt[]
    }
  | { readonly type: "history.failed"; readonly attempt: number }
  | { readonly type: "retry" }
  | { readonly type: "selected"; readonly id: string; readonly loaded: boolean }
  | { readonly type: "opened"; readonly attempt: number }
  | { readonly type: "open.failed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type JumpToMessageEffect =
  | { readonly type: "history.load"; readonly attempt: number }
  | {
      readonly type: "open.load"
      readonly attempt: number
      readonly target: string
    }
  | { readonly type: "jump"; readonly id: string }
  | { readonly type: "cancel" }

export type JumpToMessageTransition = {
  readonly state: JumpToMessageState
  readonly effects: readonly JumpToMessageEffect[]
}

const NO_EFFECTS: readonly never[] = Object.freeze([])

export function startJumpToMessage(): JumpToMessageTransition {
  return {
    state: { status: "loading", attempt: 1 },
    effects: [{ type: "history.load", attempt: 1 }],
  }
}

export function transitionJumpToMessage(state: JumpToMessageState, event: JumpToMessageEvent): JumpToMessageTransition {
  if (state.status === "closed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed") return { state: { status: "closed" }, effects: [{ type: "cancel" }] }

  if (event.type === "selected") {
    if (state.status === "opening") return { state, effects: NO_EFFECTS }

    // Rows beyond the loaded timeline only exist once the older history has loaded.
    if (event.loaded)
      return {
        state: { status: "closed" },
        effects: [{ type: "cancel" }, { type: "jump", id: event.id }],
      }

    if (state.status !== "ready") return { state, effects: NO_EFFECTS }

    return {
      state: {
        status: "opening",
        attempt: state.attempt + 1,
        history: state.history,
        target: event.id,
      },
      effects: [{ type: "open.load", attempt: state.attempt + 1, target: event.id }],
    }
  }

  if (event.type === "retry") {
    if (state.status !== "failed") return { state, effects: NO_EFFECTS }

    return {
      state: { status: "loading", attempt: state.attempt + 1 },
      effects: [{ type: "history.load", attempt: state.attempt + 1 }],
    }
  }

  if (event.attempt !== state.attempt) return { state, effects: NO_EFFECTS }

  if (state.status === "loading") {
    if (event.type === "history.loaded")
      return {
        state: {
          status: "ready",
          attempt: state.attempt,
          history: event.history,
          failed: false,
        },
        effects: NO_EFFECTS,
      }

    if (event.type === "history.failed")
      return {
        state: { status: "failed", attempt: state.attempt },
        effects: NO_EFFECTS,
      }

    return { state, effects: NO_EFFECTS }
  }

  if (state.status !== "opening") return { state, effects: NO_EFFECTS }

  if (event.type === "opened")
    return {
      state: { status: "closed" },
      effects: [{ type: "jump", id: state.target }],
    }

  if (event.type === "open.failed")
    return {
      state: {
        status: "ready",
        attempt: state.attempt,
        history: state.history,
        failed: true,
      },
      effects: NO_EFFECTS,
    }

  return { state, effects: NO_EFFECTS }
}

export function selectJumpHistory(state: JumpToMessageState) {
  return state.status === "ready" || state.status === "opening" ? state.history : []
}

export function selectJumpOpening(state: JumpToMessageState) {
  return state.status === "opening"
}

/** The note the dialog shows beside its rows, if any. */
export function selectJumpStatus(state: JumpToMessageState) {
  if (state.status === "opening") return "opening"

  if (state.status === "failed") return "failed"

  if (state.status === "ready" && state.failed) return "openFailed"

  if (state.status === "loading") return "loading"
}
