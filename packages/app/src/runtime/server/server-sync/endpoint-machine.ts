import type { ServerConnection } from "../registry"

/**
 * The endpoint a server's transport uses. The event stream's reconnect resolves one, and a plugin can report another at
 * any time; a resolution the plugin overtook while it ran must not replace the newer endpoint.
 */
export type EndpointSyncState =
  | { readonly type: "idle"; readonly http: ServerConnection.HttpBase; readonly attempt: number }
  | { readonly type: "resolving"; readonly http: ServerConnection.HttpBase; readonly attempt: number }
  | { readonly type: "disposed" }

export type EndpointSyncEvent =
  | { readonly type: "endpoint.reported"; readonly http: ServerConnection.HttpBase }
  | { readonly type: "resolve.started" }
  | { readonly type: "resolve.succeeded"; readonly attempt: number; readonly http: ServerConnection.HttpBase }
  | { readonly type: "resolve.failed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type EndpointSyncEffect =
  | { readonly type: "transport.update"; readonly http: ServerConnection.HttpBase }
  | { readonly type: "stream.resync" }

export type EndpointSyncTransition = {
  readonly state: EndpointSyncState
  readonly effects: readonly EndpointSyncEffect[]
}

export function createEndpointSyncState(http: ServerConnection.HttpBase): EndpointSyncState {
  return { type: "idle", http: { url: http.url, password: http.password }, attempt: 0 }
}

export function transitionEndpointSync(state: EndpointSyncState, event: EndpointSyncEvent): EndpointSyncTransition {
  if (state.type === "disposed") return { state, effects: [] }

  if (event.type === "disposed") return { state: { type: "disposed" }, effects: [] }

  if (event.type === "resolve.started")
    return { state: { type: "resolving", http: state.http, attempt: state.attempt + 1 }, effects: [] }

  if (event.type === "endpoint.reported") {
    if (sameEndpoint(state.http, event.http)) return { state, effects: [] }
    const http = { url: event.http.url, password: event.http.password }

    // A resolution still running is now stale: its result arrives in `idle` and is ignored.
    return {
      state: { type: "idle", http, attempt: state.attempt },
      effects: [{ type: "transport.update", http }, { type: "stream.resync" }],
    }
  }

  if (state.type !== "resolving" || event.attempt !== state.attempt) return { state, effects: [] }

  if (event.type === "resolve.failed" || sameEndpoint(state.http, event.http))
    return { state: { type: "idle", http: state.http, attempt: state.attempt }, effects: [] }
  const http = { url: event.http.url, password: event.http.password }

  return { state: { type: "idle", http, attempt: state.attempt }, effects: [{ type: "transport.update", http }] }
}

function sameEndpoint(a: ServerConnection.HttpBase, b: ServerConnection.HttpBase) {
  return a.url === b.url && a.password === b.password
}
