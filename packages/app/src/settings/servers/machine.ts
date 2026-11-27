import type { PluginServer } from "@/runtime/plugin/servers"
import type { ServerHealth } from "@/runtime/server/health-machine"
import type { ServerConnection } from "@/runtime/server/registry"

/** Longer than a health probe can take, so a Retry whose probe never answers still enables again. */
export const SERVER_RETRY_TIMEOUT_MS = 35_000

/** Whether one server's per-server pages can load; every Settings surface reads this instead of its own predicate. */
export type SettingsServerAvailability =
  | {
      readonly status: "ready"
      readonly connection: ServerConnection.Any
      readonly health: Extract<ServerHealth, { readonly type: "healthy" | "checking" }> | undefined
    }
  | { readonly status: "starting" }
  | { readonly status: "unauthorized"; readonly connection?: ServerConnection.Any }
  | {
      readonly status: "unreachable"
      readonly reason: "offline" | "incompatible" | "stopped"
      readonly connection?: ServerConnection.Any
    }

export type ServerAvailabilityInput = {
  readonly connection?: ServerConnection.Any
  readonly source?: PluginServer
  readonly health?: ServerHealth
  /** The server rejected our credentials, so it has no controller until it signs in again. */
  readonly signedOut?: boolean
}

/** The Retry button of an unavailable server's page, fenced to the server it shows. */
export type ServerRetryState =
  | { readonly status: "idle"; readonly server: ServerConnection.Key; readonly attempt: number }
  | { readonly status: "retrying"; readonly server: ServerConnection.Key; readonly attempt: number }

export type ServerRetryEvent =
  | { readonly type: "server.synced"; readonly server: ServerConnection.Key }
  | { readonly type: "retry.clicked" }
  | { readonly type: "retry.settled"; readonly attempt: number }
  | { readonly type: "retry.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type ServerRetryEffect =
  | { readonly type: "retry.run"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "timeout.cancel" }

export type ServerRetryTransition = {
  readonly state: ServerRetryState
  readonly effects: readonly ServerRetryEffect[]
}

type Stage = "stopped" | "starting" | "auth" | "failed" | "incompatible"

export function resolveServerAvailability(input: ServerAvailabilityInput): SettingsServerAvailability {
  // A listed plugin server's status already shows a sign-in in progress as starting, and a ready entry without an
  // endpoint as failed; the plugin entry speaks only for servers that are not listed yet.
  if (input.connection?.type === "plugin" && input.connection.status.type !== "ready")
    return staged(input.connection.status.type)

  if (!input.connection && input.source && input.source.entry.state !== "ready") return staged(input.source.entry.state)

  if (!input.connection) return { status: "unreachable", reason: "offline" }

  const connection = input.connection
  const health = input.health

  if (input.signedOut || health?.type === "unauthorized" || health?.type === "auth")
    return { status: "unauthorized", connection }

  if (health?.type === "starting") return { status: "starting" }

  if (health?.type === "incompatible") return { status: "unreachable", reason: "incompatible", connection }

  if (health?.type === "stopped") return { status: "unreachable", reason: "stopped", connection }

  if (health?.type === "unreachable") return { status: "unreachable", reason: "offline", connection }

  return { status: "ready", connection, health }
}

/** The connection per-server pages render with; undefined while they show the unavailable state. */
export function serverPagesConnection(availability: SettingsServerAvailability) {
  return availability.status === "ready" ? availability.connection : undefined
}

/** Search lists a server's settings and projects only while their pages can open. */
export function canIndexServerSettings(availability: SettingsServerAvailability) {
  return availability.status === "ready"
}

/** A starting server connects shortly, so a project page waits for it; any other unavailable server leaves. */
export function canHoldProjectRoute(status: SettingsServerAvailability["status"]) {
  return status === "ready" || status === "starting"
}

/** The health the switcher's status dot shows. */
export function selectSettingsServerHealth(availability: SettingsServerAvailability): ServerHealth | undefined {
  if (availability.status === "ready") return availability.health

  if (availability.status === "starting") return { type: "starting" }

  if (availability.status === "unauthorized") return { type: "unauthorized" }

  return { type: availability.reason === "offline" ? "unreachable" : availability.reason }
}

export function isSettingsServerUnreachable(availability: SettingsServerAvailability) {
  return availability.status === "unreachable" || availability.status === "unauthorized"
}

/** An HTTP server that rejects its saved credentials, which signs in again through the edit dialog. */
export function unauthorizedHttpServer(availability: SettingsServerAvailability) {
  return availability.status === "unauthorized" && availability.connection?.type === "http"
    ? availability.connection
    : undefined
}

export function createServerRetryState(server: ServerConnection.Key): ServerRetryState {
  return { status: "idle", server, attempt: 0 }
}

export function transitionServerRetry(state: ServerRetryState, event: ServerRetryEvent): ServerRetryTransition {
  if (event.type === "server.synced") {
    if (event.server === state.server) return unchanged(state)

    // Another server's page: its Retry starts enabled, and the previous server's retry can no longer settle it.
    return {
      state: { status: "idle", server: event.server, attempt: state.attempt },
      effects: state.status === "retrying" ? CANCEL : NO_EFFECTS,
    }
  }

  if (event.type === "retry.clicked") {
    if (state.status === "retrying") return unchanged(state)
    const attempt = state.attempt + 1

    return {
      state: { status: "retrying", server: state.server, attempt },
      effects: [{ type: "retry.run", attempt, timeoutMs: SERVER_RETRY_TIMEOUT_MS }],
    }
  }

  if (state.status !== "retrying") return unchanged(state)

  if (event.type === "disposed") return { state: idle(state), effects: CANCEL }

  if (event.attempt !== state.attempt) return unchanged(state)

  return { state: idle(state), effects: event.type === "retry.settled" ? CANCEL : NO_EFFECTS }
}

export function isServerRetrying(state: ServerRetryState) {
  return state.status === "retrying"
}

const NO_EFFECTS: readonly ServerRetryEffect[] = Object.freeze([])

const CANCEL: readonly ServerRetryEffect[] = Object.freeze([{ type: "timeout.cancel" }])

function staged(stage: Stage): SettingsServerAvailability {
  if (stage === "starting") return { status: "starting" }

  if (stage === "auth") return { status: "unauthorized" }

  if (stage === "failed") return { status: "unreachable", reason: "offline" }

  return { status: "unreachable", reason: stage }
}

function idle(state: ServerRetryState): ServerRetryState {
  return { status: "idle", server: state.server, attempt: state.attempt }
}

function unchanged(state: ServerRetryState): ServerRetryTransition {
  return { state, effects: NO_EFFECTS }
}
