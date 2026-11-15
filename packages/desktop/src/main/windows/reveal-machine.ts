/** How long a hidden window waits for its content and theme before it shows anyway. */
export const REVEAL_TIMEOUT_MS = 3_000

export type RevealReason = "ready" | "timeout" | "recovery"

/**
 * A new window stays hidden until its content has loaded and the renderer has applied its theme, so it never
 * flashes unthemed. The early window was shown before adoption and starts `shown`.
 */
export type RevealState =
  | { readonly status: "loading" }
  | { readonly status: "content-ready" }
  | { readonly status: "theme-ready" }
  | { readonly status: "shown" }
  | { readonly status: "closed" }

export type RevealEvent =
  | { readonly type: "content.ready" }
  | { readonly type: "theme.ready" }
  | { readonly type: "reveal.timed-out" }
  | { readonly type: "recovery.requested" }
  | { readonly type: "window.closed" }

export type RevealCommand =
  | { readonly type: "show"; readonly reason: RevealReason }
  | { readonly type: "cancel-timeout" }

export type RevealTransition = {
  readonly state: RevealState
  readonly commands: readonly RevealCommand[]
}

const LOADING: RevealState = Object.freeze({ status: "loading" })

const CONTENT_READY: RevealState = Object.freeze({ status: "content-ready" })

const THEME_READY: RevealState = Object.freeze({ status: "theme-ready" })

const SHOWN: RevealState = Object.freeze({ status: "shown" })

const CLOSED: RevealState = Object.freeze({ status: "closed" })

export function initialRevealState(early: boolean): RevealState {
  return early ? SHOWN : LOADING
}

export function transitionReveal(state: RevealState, event: RevealEvent): RevealTransition {
  if (state.status === "closed") return unchanged(state)

  if (event.type === "window.closed")
    return { state: CLOSED, commands: state.status === "shown" ? [] : [{ type: "cancel-timeout" }] }

  if (state.status === "shown") return unchanged(state)

  if (event.type === "reveal.timed-out") return show("timeout")

  // A recovery dialog is modal to the window, so the window has to be visible for the user to see it.
  if (event.type === "recovery.requested") return show("recovery")

  if (event.type === "content.ready") {
    if (state.status === "theme-ready") return show("ready")

    // Linux reports content readiness twice (`ready-to-show` and `did-finish-load`).
    return state.status === "content-ready" ? unchanged(state) : { state: CONTENT_READY, commands: [] }
  }

  if (state.status === "content-ready") return show("ready")

  return state.status === "theme-ready" ? unchanged(state) : { state: THEME_READY, commands: [] }
}

function show(reason: RevealReason): RevealTransition {
  return { state: SHOWN, commands: [{ type: "cancel-timeout" }, { type: "show", reason }] }
}

function unchanged(state: RevealState): RevealTransition {
  return { state, commands: [] }
}

/** Runs one window's reveal machine and owns its fallback timer. */
export function createRevealDriver(input: { readonly early: boolean; readonly show: (reason: RevealReason) => void }) {
  const current = { state: initialRevealState(input.early) }

  const dispatch = (event: RevealEvent) => {
    const next = transitionReveal(current.state, event)
    current.state = next.state
    next.commands.forEach(perform)
  }

  const timer = input.early ? undefined : setTimeout(() => dispatch({ type: "reveal.timed-out" }), REVEAL_TIMEOUT_MS)

  const perform = (command: RevealCommand) => {
    if (command.type === "cancel-timeout") return clearTimeout(timer)

    input.show(command.reason)
  }

  return { dispatch }
}
