import type { ServerConnectionStatus } from "../client"

/**
 * The event stream as server sync sees it. A stream is live once the client reports it connected and its
 * `server.connected` handshake has arrived, in either order. `connectedOnce` tells a reconnect from the first connect.
 */
export type ConnectionSyncState =
  | { readonly type: "idle" }
  | { readonly type: "disconnected"; readonly connectedOnce: boolean; readonly handshake: boolean }
  | { readonly type: "awaiting-handshake"; readonly connectedOnce: boolean }
  | { readonly type: "live" }
  | { readonly type: "disposed" }

export type ConnectionSyncEvent =
  | { readonly type: "status.changed"; readonly status: ServerConnectionStatus }
  | { readonly type: "handshake.received" }
  | { readonly type: "disposed" }

export type ConnectionSyncEffect =
  | { readonly type: "invalidate" }
  | { readonly type: "sync"; readonly reconnect: boolean }

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
    if (state.type === "idle")
      return { state: { type: "disconnected", connectedOnce: false, handshake: true }, effects: [] }

    if (state.type === "awaiting-handshake")
      return { state: { type: "live" }, effects: [{ type: "sync", reconnect: state.connectedOnce }] }

    if (state.type === "disconnected" && !state.handshake) return { state: { ...state, handshake: true }, effects: [] }

    return { state, effects: [] }
  }

  if (event.status === "connected") {
    if (state.type === "idle") return { state: { type: "awaiting-handshake", connectedOnce: false }, effects: [] }

    if (state.type !== "disconnected") return { state, effects: [] }

    if (state.handshake) return { state: { type: "live" }, effects: [{ type: "sync", reconnect: state.connectedOnce }] }

    return { state: { type: "awaiting-handshake", connectedOnce: state.connectedOnce }, effects: [] }
  }

  if (state.type === "disconnected") return { state, effects: [] }

  return {
    state: {
      type: "disconnected",
      connectedOnce: state.type === "live" || (state.type === "awaiting-handshake" && state.connectedOnce),
      handshake: false,
    },
    effects: INVALIDATE,
  }
}
