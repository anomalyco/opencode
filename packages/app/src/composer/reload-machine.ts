/**
 * `/reload`: one server-wide configuration reload at a time. The request queue already ends a reload whose server
 * stops answering, and the reply carries no body, so `reloading` always settles.
 */
export type ConfigReloadState =
  | { readonly status: "idle"; readonly issued: number }
  | { readonly status: "reloading"; readonly attempt: number }

export type ConfigReloadEvent =
  | { readonly type: "reload.requested" }
  | { readonly type: "reload.succeeded"; readonly attempt: number }
  | { readonly type: "reload.failed"; readonly attempt: number; readonly cause: unknown }

export type ConfigReloadEffect =
  | { readonly type: "reload.run"; readonly attempt: number }
  | { readonly type: "toast.pending.show" }
  | { readonly type: "toast.pending.dismiss" }
  | { readonly type: "toast.succeeded" }
  | { readonly type: "toast.failed"; readonly cause: unknown }

export type ConfigReloadTransition = {
  readonly state: ConfigReloadState
  readonly effects: readonly ConfigReloadEffect[]
}

export function createConfigReloadState(): ConfigReloadState {
  return { status: "idle", issued: 0 }
}

export function transitionConfigReload(state: ConfigReloadState, event: ConfigReloadEvent): ConfigReloadTransition {
  if (event.type === "reload.requested") {
    // A second `/reload` while one runs joins it: the server is already rebuilding every location.
    if (state.status === "reloading") return { state, effects: [] }
    const attempt = state.issued + 1

    return {
      state: { status: "reloading", attempt },
      effects: [{ type: "toast.pending.show" }, { type: "reload.run", attempt }],
    }
  }

  if (state.status !== "reloading" || state.attempt !== event.attempt) return { state, effects: [] }

  return {
    state: { status: "idle", issued: state.attempt },
    effects: [
      { type: "toast.pending.dismiss" },
      event.type === "reload.succeeded" ? { type: "toast.succeeded" } : { type: "toast.failed", cause: event.cause },
    ],
  }
}
