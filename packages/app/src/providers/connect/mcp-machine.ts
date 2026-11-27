/** How long one connect, disconnect or sign-in may run before it gives up with an error. */
export const MCP_TOGGLE_TIMEOUT_MS = 60_000

/** An MCP server's status, as the server lists it. */
export type McpServerStatus =
  | { readonly status: "connected" | "pending" | "disabled" }
  | { readonly status: "failed" | "needs_auth"; readonly error: string }

/** A sign-in that also accepts the redirect URL pasted from the browser. */
export type McpSignIn = {
  readonly integrationID: string
  readonly attemptID: string
  readonly url: string
  /** The attempt's lifetime in milliseconds. */
  readonly lifetime: number
}

/** One server's connect, disconnect or sign-in in flight. */
export type McpToggle = { readonly name: string; readonly attempt: number }

/** The MCPs dialog's inline error view of one failed server. */
export type McpDetailState =
  | { readonly status: "closed" }
  /** Opened on a server before the server list loaded. */
  | { readonly status: "opening"; readonly attempt: number; readonly name: string }
  /**
   * `error` is the server's latest failure, kept while a retry runs; `copied` is the error text the user last copied.
   */
  | {
      readonly status: "open"
      readonly attempt: number
      readonly name: string
      readonly error: string
      readonly copied: string | undefined
    }

/**
 * The MCP servers of one server connection and directory: their toggles in flight and the MCPs dialog's error view,
 * shared by the MCPs dialog, Settings › Extensions and the new-session composer. It lives while one of them is mounted,
 * a toggle runs or the error view shows. Toggles and error views take attempts from `issued`, so a result whose attempt
 * the state no longer holds is stale.
 */
export type McpState =
  | {
      readonly status: "active"
      readonly mounts: number
      readonly issued: number
      readonly toggles: readonly McpToggle[]
      readonly detail: McpDetailState
    }
  | { readonly status: "disposed" }

export type McpEvent =
  /** A row's switch or sign-in button, or the error view's Disable or Try again. */
  | {
      readonly type: "toggle.requested"
      readonly name: string
      readonly enabled: boolean
      readonly status: McpServerStatus["status"] | undefined
    }
  /** The server started an OAuth sign-in; the toggle goes on to refresh the server's resources. */
  | {
      readonly type: "toggle.authorizing"
      readonly name: string
      readonly attempt: number
      readonly url: string
      readonly signIn: McpSignIn | undefined
    }
  | { readonly type: "toggle.succeeded"; readonly name: string; readonly attempt: number }
  /** `server` is true when the refreshed status failed, false when a request threw. */
  | {
      readonly type: "toggle.failed"
      readonly name: string
      readonly attempt: number
      readonly error: string
      readonly server: boolean
    }
  | { readonly type: "toggle.timed-out"; readonly name: string; readonly attempt: number }
  /** `focus` is true when opened from the list, so focus moves to the view's Back button. */
  | {
      readonly type: "detail.opened"
      readonly name: string
      readonly loaded: boolean
      readonly status: McpServerStatus | undefined
      readonly focus: boolean
    }
  /** Back or Escape in the error view; focus returns to the search field. */
  | { readonly type: "detail.dismissed"; readonly attempt: number }
  /** The dialog that showed the error view unmounted. */
  | { readonly type: "detail.closed"; readonly attempt: number }
  | { readonly type: "detail.copied"; readonly attempt: number; readonly error: string }
  /** The error view's server changed in the server list. `loaded` is false while the list is not known. */
  | {
      readonly type: "server.synced"
      readonly attempt: number
      readonly loaded: boolean
      readonly status: McpServerStatus | undefined
    }
  | { readonly type: "mounted" }
  | { readonly type: "unmounted" }
  | { readonly type: "disposed" }

export type McpEffect =
  /** Starts the attempt's controller and timeout, then runs the toggle. */
  | {
      readonly type: "run-toggle"
      readonly name: string
      readonly attempt: number
      readonly enabled: boolean
      readonly timeoutMs: number
    }
  /** Ends the attempt's controller and timeout; `ok` tells whoever awaits the toggle whether it succeeded. */
  | { readonly type: "end-toggle"; readonly attempt: number; readonly ok: boolean }
  | { readonly type: "open-external"; readonly url: string }
  | { readonly type: "open-sign-in"; readonly name: string; readonly signIn: McpSignIn }
  | { readonly type: "focus-detail"; readonly attempt: number }
  | { readonly type: "focus-list"; readonly attempt: number }
  | { readonly type: "toast-failed"; readonly message: string }
  | { readonly type: "toast-timed-out"; readonly name: string }

export type McpTransition = { readonly state: McpState; readonly effects: readonly McpEffect[] }

const NONE: readonly McpEffect[] = []

type Live = Exclude<McpState, { status: "disposed" }>

export function createMcpState(): McpState {
  return { status: "active", mounts: 0, issued: 0, toggles: [], detail: { status: "closed" } }
}

export function transitionMcp(state: McpState, event: McpEvent): McpTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects: state.toggles.map((toggle): McpEffect => ({ type: "end-toggle", attempt: toggle.attempt, ok: false })),
    }

  return release(step(state, event))
}

/** What a row shows: `busy` while its own toggle runs, `pending` while it takes no new toggle. */
export function mcpRowView(state: McpState, name: string, status: McpServerStatus["status"] | undefined) {
  const busy = toggling(state, name)

  return { busy, pending: busy || status === "pending" }
}

/** What the open error view shows, or undefined while it is closed. */
export function mcpDetailView(state: McpState, status: McpServerStatus["status"] | undefined) {
  if (state.status === "disposed" || state.detail.status !== "open") return
  const detail = state.detail

  return {
    attempt: detail.attempt,
    name: detail.name,
    error: detail.error,
    copied: detail.copied === detail.error,
    busy: toggling(state, detail.name) || status === "pending",
  }
}

/** The error view's attempt while it is opening or open. */
export function mcpDetailAttempt(state: McpState) {
  if (state.status === "disposed" || state.detail.status === "closed") return

  return { attempt: state.detail.attempt, name: state.detail.name }
}

export function isMcpToggling(state: McpState) {
  return state.status === "active" && state.toggles.length > 0
}

function step(state: Live, event: Exclude<McpEvent, { type: "disposed" }>): McpTransition {
  if (event.type === "mounted") return { state: { ...state, mounts: state.mounts + 1 }, effects: NONE }

  if (event.type === "unmounted") return { state: { ...state, mounts: Math.max(0, state.mounts - 1) }, effects: NONE }

  if (event.type === "toggle.requested") {
    // One toggle per server at a time, from its row and its error view alike; other servers stay free.
    if (toggling(state, event.name) || event.status === "pending") return { state, effects: NONE }
    const attempt = state.issued + 1

    return {
      state: { ...state, issued: attempt, toggles: [...state.toggles, { name: event.name, attempt }] },
      effects: [
        { type: "run-toggle", name: event.name, attempt, enabled: event.enabled, timeoutMs: MCP_TOGGLE_TIMEOUT_MS },
      ],
    }
  }

  if (
    event.type === "toggle.authorizing" ||
    event.type === "toggle.succeeded" ||
    event.type === "toggle.failed" ||
    event.type === "toggle.timed-out"
  )
    return settled(state, event)

  if (event.type === "detail.opened") return opened(state, event)

  const detail = state.detail

  if (detail.status === "closed" || detail.attempt !== event.attempt) return { state, effects: NONE }

  if (event.type === "detail.closed") return { state: { ...state, detail: { status: "closed" } }, effects: NONE }

  if (event.type === "detail.dismissed")
    return detail.status === "open"
      ? {
          state: { ...state, detail: { status: "closed" } },
          effects: [{ type: "focus-list", attempt: detail.attempt }],
        }
      : { state, effects: NONE }

  if (event.type === "detail.copied")
    return detail.status === "open"
      ? { state: { ...state, detail: { ...detail, copied: event.error } }, effects: NONE }
      : { state, effects: NONE }

  if (!event.loaded) return { state, effects: NONE }
  const status = event.status

  if (detail.status === "opening") {
    if (status?.status !== "failed") return { state: { ...state, detail: { status: "closed" } }, effects: NONE }

    return {
      state: {
        ...state,
        detail: { status: "open", attempt: detail.attempt, name: detail.name, error: status.error, copied: undefined },
      },
      effects: NONE,
    }
  }

  // A reconnect, a disable or a removal, here or elsewhere, leaves nothing to show.
  if (!status || status.status === "connected" || status.status === "disabled")
    return {
      state: { ...state, detail: { status: "closed" } },
      effects: [{ type: "focus-list", attempt: detail.attempt }],
    }

  // A retry stays open while it connects or asks to sign in, and a new failure replaces the error in place.
  if (status.status !== "failed" || status.error === detail.error) return { state, effects: NONE }

  return { state: { ...state, detail: { ...detail, error: status.error } }, effects: NONE }
}

function opened(state: Live, event: Extract<McpEvent, { type: "detail.opened" }>): McpTransition {
  const attempt = state.issued + 1

  if (!event.loaded)
    return {
      state: { ...state, issued: attempt, detail: { status: "opening", attempt, name: event.name } },
      effects: NONE,
    }

  // Only a failed server has an error to show.
  if (event.status?.status !== "failed") return { state: { ...state, detail: { status: "closed" } }, effects: NONE }

  return {
    state: {
      ...state,
      issued: attempt,
      detail: { status: "open", attempt, name: event.name, error: event.status.error, copied: undefined },
    },
    effects: event.focus ? [{ type: "focus-detail", attempt }] : NONE,
  }
}

function settled(
  state: Live,
  event: Extract<McpEvent, { type: "toggle.authorizing" | "toggle.succeeded" | "toggle.failed" | "toggle.timed-out" }>,
): McpTransition {
  if (!state.toggles.some((toggle) => toggle.name === event.name && toggle.attempt === event.attempt))
    return { state, effects: NONE }
  const detail = state.detail
  const shown = detail.status === "open" && detail.name === event.name
  const back: readonly McpEffect[] = shown ? [{ type: "focus-list", attempt: detail.attempt }] : NONE

  // The browser takes over from the error view; the toggle still refreshes the server's resources.
  if (event.type === "toggle.authorizing")
    return {
      state: shown ? { ...state, detail: { status: "closed" } } : state,
      effects: [
        ...back,
        { type: "open-external", url: event.url },
        ...(event.signIn ? [{ type: "open-sign-in", name: event.name, signIn: event.signIn } as const] : NONE),
      ],
    }

  const next = { ...state, toggles: state.toggles.filter((toggle) => toggle.attempt !== event.attempt) }

  if (event.type === "toggle.succeeded")
    return {
      state: shown ? { ...next, detail: { status: "closed" } } : next,
      effects: [{ type: "end-toggle", attempt: event.attempt, ok: true }, ...back],
    }

  const end: McpEffect = { type: "end-toggle", attempt: event.attempt, ok: false }

  if (event.type === "toggle.timed-out")
    return { state: next, effects: [end, { type: "toast-timed-out", name: event.name }] }

  // The open error view shows the server's new failure itself.
  if (shown && event.server && detail.status === "open")
    return { state: { ...next, detail: { ...detail, error: event.error } }, effects: [end] }

  return {
    state: next,
    effects: [end, { type: "toast-failed", message: event.server ? `${event.name}: ${event.error}` : event.error }],
  }
}

// The list ends once nothing uses it: nothing lists it, no toggle runs and no error view shows.
function release(transition: McpTransition): McpTransition {
  const state = transition.state

  if (state.status !== "active" || state.mounts > 0 || state.toggles.length > 0 || state.detail.status !== "closed")
    return transition

  return { state: { status: "disposed" }, effects: transition.effects }
}

function toggling(state: McpState, name: string) {
  return state.status !== "disposed" && state.toggles.some((toggle) => toggle.name === name)
}
