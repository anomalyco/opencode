import type { ServerConnectionStatus } from "../client"

/**
 * The event stream as server sync sees it. A stream is live once the client reports it connected and its
 * `server.connected` handshake has arrived, in either order. `stale` means an earlier stream already reported
 * `connected`, whether or not it went live: the bootstrap query may hold a fetch it started, so going live restarts it.
 */
export type ConnectionSyncState =
  | { readonly type: "idle" }
  | { readonly type: "disconnected"; readonly stale: boolean; readonly handshake: boolean }
  | { readonly type: "awaiting-handshake"; readonly stale: boolean }
  | { readonly type: "live" }
  | { readonly type: "disposed" }

export type ConnectionSyncEvent =
  | { readonly type: "status.changed"; readonly status: ServerConnectionStatus }
  | { readonly type: "handshake.received" }
  | { readonly type: "disposed" }

export type ConnectionSyncEffect =
  | { readonly type: "invalidate" }
  | { readonly type: "sync"; readonly restart: boolean }

export type ConnectionSyncTransition = {
  readonly state: ConnectionSyncState
  readonly effects: readonly ConnectionSyncEffect[]
}

const INVALIDATE: readonly ConnectionSyncEffect[] = [{ type: "invalidate" }]

export function transitionConnectionSync(
  state: ConnectionSyncState,
  event: ConnectionSyncEvent,
): ConnectionSyncTransition {
  if (state.type === "disposed") return { state, effects: [] }

  if (event.type === "disposed") return { state: { type: "disposed" }, effects: [] }

  if (event.type === "handshake.received") {
    if (state.type === "idle") return { state: { type: "disconnected", stale: false, handshake: true }, effects: [] }

    if (state.type === "awaiting-handshake")
      return { state: { type: "live" }, effects: [{ type: "sync", restart: state.stale }] }

    if (state.type === "disconnected" && !state.handshake) return { state: { ...state, handshake: true }, effects: [] }

    return { state, effects: [] }
  }

  if (event.status === "connected") {
    if (state.type === "idle") return { state: { type: "awaiting-handshake", stale: false }, effects: [] }

    if (state.type !== "disconnected") return { state, effects: [] }

    if (state.handshake) return { state: { type: "live" }, effects: [{ type: "sync", restart: state.stale }] }

    return { state: { type: "awaiting-handshake", stale: state.stale }, effects: [] }
  }

  if (state.type === "disconnected") return { state, effects: [] }

  return {
    state: {
      type: "disconnected",
      stale: state.type !== "idle",
      handshake: false,
    },
    effects: INVALIDATE,
  }
}
