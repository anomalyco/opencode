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

export type McpErrorDialog =
  | { readonly status: "closed" }
  /**
   * One server's failure. `error` is its latest failure, kept while a retry runs; `copied` is the error text the user
   * last copied.
   */
  | {
      readonly status: "open"
      readonly attempt: number
      readonly name: string
      readonly error: string
      readonly copied: string | undefined
    }

/**
 * The MCP list of one server and directory: its toggles in flight and its error dialog. Toggles and dialogs take
 * attempt numbers from `issued`, so a result whose attempt the state no longer holds is stale.
 */
export type McpState =
  | {
      /**
       * - `attached`: the popover that lists the servers is mounted.
       * - `detached`: the popover closed; the state lives until its last toggle settles and its dialog closes.
       */
      readonly status: "attached" | "detached"
      readonly issued: number
      readonly toggles: readonly McpToggle[]
      readonly dialog: McpErrorDialog
    }
  | { readonly status: "disposed" }

export type McpEvent =
  /** A row's switch or sign-in button, or the error dialog's Disable or Try again. */
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
  | { readonly type: "error.opened"; readonly name: string; readonly error: string }
  /** The dialog closed, by the user or by the machine. */
  | { readonly type: "error.dismissed"; readonly attempt: number }
  | { readonly type: "error.copied"; readonly attempt: number; readonly error: string }
  /** The dialog's server changed in the server's list. `loaded` is false while the list is not known. */
  | {
      readonly type: "server.synced"
      readonly attempt: number
      readonly loaded: boolean
      readonly status: McpServerStatus | undefined
    }
  /** The popover that lists the servers unmounted. */
  | { readonly type: "detached" }
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
  /** Ends the attempt's controller and timeout. */
  | { readonly type: "abort-toggle"; readonly attempt: number }
  | { readonly type: "open-external"; readonly url: string }
  | { readonly type: "open-sign-in"; readonly name: string; readonly signIn: McpSignIn }
  | { readonly type: "open-dialog"; readonly attempt: number; readonly name: string }
  | { readonly type: "close-dialog"; readonly attempt: number }
  | { readonly type: "toast-failed"; readonly message: string }
  | { readonly type: "toast-timed-out"; readonly name: string }

export type McpTransition = { readonly state: McpState; readonly effects: readonly McpEffect[] }

export const initialMcpState: McpState = { status: "attached", issued: 0, toggles: [], dialog: { status: "closed" } }

const NONE: readonly McpEffect[] = []

const CLOSED: McpErrorDialog = { status: "closed" }

type Live = Exclude<McpState, { status: "disposed" }>

export function transitionMcp(state: McpState, event: McpEvent): McpTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects: [
        ...state.toggles.map((toggle): McpEffect => ({ type: "abort-toggle", attempt: toggle.attempt })),
        ...closeDialog(state.dialog),
      ],
    }

  return release(step(state, event))
}

/** What a row shows: `busy` while its own toggle runs, `pending` while it takes no new toggle. */
export function mcpRowView(state: McpState, name: string, status: McpServerStatus["status"]) {
  const busy = toggling(state, name)

  return { busy, pending: busy || status === "pending" }
}

/** What an open error dialog shows, or undefined once it closed. */
export function mcpDialogView(state: McpState, attempt: number, status: McpServerStatus["status"] | undefined) {
  if (state.status === "disposed" || state.dialog.status !== "open" || state.dialog.attempt !== attempt) return

  return {
    name: state.dialog.name,
    error: state.dialog.error,
    copied: state.dialog.copied === state.dialog.error,
    busy: toggling(state, state.dialog.name) || status === "pending",
  }
}

function step(state: Live, event: Exclude<McpEvent, { type: "disposed" }>): McpTransition {
  if (event.type === "detached") {
    if (state.status === "detached") return { state, effects: NONE }

    return { state: { ...state, status: "detached" }, effects: NONE }
  }

  if (event.type === "toggle.requested") {
    // One toggle per server at a time, from its row and its dialog alike.
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

  if (event.type === "error.opened") {
    const attempt = state.issued + 1

    return {
      state: {
        ...state,
        issued: attempt,
        dialog: { status: "open", attempt, name: event.name, error: event.error, copied: undefined },
      },
      effects: [...closeDialog(state.dialog), { type: "open-dialog", attempt, name: event.name }],
    }
  }

  const dialog = state.dialog

  if (dialog.status !== "open" || dialog.attempt !== event.attempt) return { state, effects: NONE }

  if (event.type === "error.dismissed") return { state: { ...state, dialog: CLOSED }, effects: NONE }

  if (event.type === "error.copied")
    return { state: { ...state, dialog: { ...dialog, copied: event.error } }, effects: NONE }

  if (!event.loaded) return { state, effects: NONE }
  const status = event.status

  // A reconnect, a disable or a removal, here or elsewhere, leaves nothing to show.
  if (!status || status.status === "connected" || status.status === "disabled")
    return { state: { ...state, dialog: CLOSED }, effects: closeDialog(dialog) }

  // A retry stays open while it connects, and a new failure replaces the error in place.
  if (status.status !== "failed" || status.error === dialog.error) return { state, effects: NONE }

  return { state: { ...state, dialog: { ...dialog, error: status.error } }, effects: NONE }
}

function settled(
  state: Live,
  event: Extract<McpEvent, { type: "toggle.authorizing" | "toggle.succeeded" | "toggle.failed" | "toggle.timed-out" }>,
): McpTransition {
  if (!state.toggles.some((toggle) => toggle.name === event.name && toggle.attempt === event.attempt))
    return { state, effects: NONE }
  const dialog = state.dialog
  const shown = dialog.status === "open" && dialog.name === event.name

  // The browser takes over from the dialog; the toggle still refreshes the server's resources.
  if (event.type === "toggle.authorizing")
    return {
      state: shown ? { ...state, dialog: CLOSED } : state,
      effects: [
        ...(shown ? closeDialog(dialog) : NONE),
        { type: "open-external", url: event.url },
        ...(event.signIn ? [{ type: "open-sign-in", name: event.name, signIn: event.signIn } as const] : []),
      ],
    }

  const next = { ...state, toggles: state.toggles.filter((toggle) => toggle.attempt !== event.attempt) }
  const abort: McpEffect = { type: "abort-toggle", attempt: event.attempt }

  if (event.type === "toggle.succeeded")
    return shown
      ? { state: { ...next, dialog: CLOSED }, effects: [abort, ...closeDialog(dialog)] }
      : { state: next, effects: [abort] }

  if (event.type === "toggle.timed-out")
    return { state: next, effects: [abort, { type: "toast-timed-out", name: event.name }] }

  // The open dialog shows the server's new failure itself.
  if (shown && event.server) return { state: { ...next, dialog: { ...dialog, error: event.error } }, effects: [abort] }

  return {
    state: next,
    effects: [abort, { type: "toast-failed", message: event.server ? `${event.name}: ${event.error}` : event.error }],
  }
}

// A detached list ends once nothing of it is left: no toggle runs and no dialog shows.
function release(transition: McpTransition): McpTransition {
  const state = transition.state

  if (state.status !== "detached" || state.toggles.length > 0 || state.dialog.status === "open") return transition

  return { state: { status: "disposed" }, effects: transition.effects }
}

function closeDialog(dialog: McpErrorDialog): readonly McpEffect[] {
  return dialog.status === "open" ? [{ type: "close-dialog", attempt: dialog.attempt }] : NONE
}

function toggling(state: McpState, name: string) {
  return state.status !== "disposed" && state.toggles.some((toggle) => toggle.name === name)
}
