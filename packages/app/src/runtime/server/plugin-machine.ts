import type { ServerState } from "@opencode/plugin/gui"
import type { ServerConnection } from "./registry"

/** How long a sign-in may run before the server shows what its plugin reports again. */
export const PLUGIN_CONNECT_TIMEOUT_MS = 120_000

/** Where a contributed server stands. Only a ready server has an endpoint. */
export type PluginServerStatus =
  | { readonly type: "stopped" | "starting" | "auth" | "failed" | "incompatible" }
  | { readonly type: "ready"; readonly http: ServerConnection.HttpBase }

/** What the app reads from a plugin's `ServerEntry`, as plain values. */
export type PluginEntrySnapshot = { readonly state: ServerState; readonly http?: ServerConnection.HttpBase }

type Stage = Exclude<ServerState, "ready">

/**
 * One contributed server. `authenticating` starts when the user asks to sign in and lasts until the plugin reports the
 * server ready, the plugin's `connect` gives up, or the timeout runs out; meanwhile the server shows as starting.
 */
export type PluginServerState =
  | { readonly status: Stage; readonly attempt: number }
  | { readonly status: "ready"; readonly attempt: number; readonly http: ServerConnection.HttpBase }
  | {
      readonly status: "authenticating"
      readonly attempt: number
      /** What the plugin reports meanwhile; the server returns to it when sign-in ends without it ready. */
      readonly reported: "auth" | "starting"
      /** Run once the server is ready. */
      readonly callbacks: readonly (() => void)[]
    }

export type PluginServerEvent =
  | { readonly type: "entry.updated"; readonly entry: PluginEntrySnapshot }
  | { readonly type: "authenticate"; readonly onConnected?: () => void }
  | { readonly type: "connect.settled"; readonly attempt: number; readonly ready: boolean }
  | { readonly type: "connect.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type PluginServerEffect =
  | { readonly type: "connect"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "timeout.cancel" }
  | { readonly type: "notify.connected"; readonly callbacks: readonly (() => void)[] }

export type PluginServerTransition = {
  readonly state: PluginServerState
  readonly effects: readonly PluginServerEffect[]
}

export function createPluginServerState(entry: PluginEntrySnapshot): PluginServerState {
  return { ...target(entry), attempt: 0 }
}

export function transitionPluginServer(state: PluginServerState, event: PluginServerEvent): PluginServerTransition {
  if (event.type === "entry.updated") return updated(state, event.entry)

  if (event.type === "authenticate") {
    if (state.status === "auth") {
      const attempt = state.attempt + 1

      return {
        state: {
          status: "authenticating",
          attempt,
          reported: "auth",
          callbacks: event.onConnected ? [event.onConnected] : [],
        },
        effects: [{ type: "connect", attempt, timeoutMs: PLUGIN_CONNECT_TIMEOUT_MS }],
      }
    }

    // A second click joins the sign-in in progress instead of starting another.
    if (state.status === "authenticating" && event.onConnected)
      return { state: { ...state, callbacks: [...state.callbacks, event.onConnected] }, effects: [] }

    return unchanged(state)
  }

  // An unlisted server drops the callbacks of its sign-in; a late answer finds nothing to resume.
  if (event.type === "disposed") {
    if (state.status === "stopped") return unchanged(state)

    return {
      state: { status: "stopped", attempt: state.attempt },
      effects: state.status === "authenticating" ? [{ type: "timeout.cancel" }] : [],
    }
  }

  if (state.status !== "authenticating" || event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "connect.timed-out")
    return { state: { status: state.reported, attempt: state.attempt }, effects: [] }

  // The plugin reports the server ready on its own channel; until it does, the timeout bounds the wait.
  if (event.ready) return unchanged(state)

  return { state: { status: state.reported, attempt: state.attempt }, effects: [{ type: "timeout.cancel" }] }
}

/** What the app shows and connects to; a sign-in in progress shows as starting. */
export function selectPluginStatus(state: PluginServerState): PluginServerStatus {
  if (state.status === "ready") return { type: "ready", http: state.http }

  if (state.status === "authenticating") return stages.starting

  return stages[state.status]
}

/** The server waits for sign-in, or one is in progress that a new request joins. */
export function canAuthenticatePluginServer(state: PluginServerState) {
  return state.status === "auth" || state.status === "authenticating"
}

const stages = {
  stopped: { type: "stopped" },
  starting: { type: "starting" },
  auth: { type: "auth" },
  failed: { type: "failed" },
  incompatible: { type: "incompatible" },
} as const satisfies Record<Stage, PluginServerStatus>

function updated(state: PluginServerState, entry: PluginEntrySnapshot): PluginServerTransition {
  const next = target(entry)

  if (state.status === "authenticating") {
    if (next.status === "ready")
      return {
        state: { ...next, attempt: state.attempt },
        effects: [
          { type: "timeout.cancel" },
          ...(state.callbacks.length ? [{ type: "notify.connected" as const, callbacks: state.callbacks }] : []),
        ],
      }

    // A sign-in can report a prompt (`auth`) or progress (`starting`) before it settles.
    if (next.status === "auth" || next.status === "starting")
      return next.status === state.reported
        ? unchanged(state)
        : { state: { ...state, reported: next.status }, effects: [] }

    return { state: { ...next, attempt: state.attempt }, effects: [{ type: "timeout.cancel" }] }
  }

  if (
    next.status === state.status &&
    (next.status !== "ready" || (state.status === "ready" && same(next.http, state.http)))
  )
    return unchanged(state)

  return { state: { ...next, attempt: state.attempt }, effects: [] }
}

// A plugin that reports ready without an endpoint cannot be reached; it never reads as ready.
function target(
  entry: PluginEntrySnapshot,
): { readonly status: Stage } | { readonly status: "ready"; readonly http: ServerConnection.HttpBase } {
  if (entry.state !== "ready") return { status: entry.state }

  if (!entry.http) return { status: "failed" }

  return { status: "ready", http: { url: entry.http.url, password: entry.http.password } }
}

function same(a: ServerConnection.HttpBase, b: ServerConnection.HttpBase) {
  return a.url === b.url && a.password === b.password
}

function unchanged(state: PluginServerState): PluginServerTransition {
  return { state, effects: [] }
}
