// The main-process pane, loaded when a window first registers one. Each load takes the next attempt number, so a
// load that failed returns to `unloaded` and the next register tries again, and a load the plugin's cleanup overtook
// never hands out its pane.

export type MainPaneState<Pane> =
  /** `issued` is the last attempt handed out. */
  | { readonly status: "unloaded"; readonly issued: number }
  | { readonly status: "loading"; readonly attempt: number }
  | { readonly status: "loaded"; readonly pane: Pane }
  | { readonly status: "disposed" }

export type MainPaneEvent<Pane> =
  /** A window registers a binding and needs the pane. */
  | { readonly type: "load.requested" }
  | { readonly type: "load.succeeded"; readonly attempt: number; readonly pane: Pane }
  | { readonly type: "load.failed"; readonly attempt: number; readonly cause: unknown }
  /** The plugin instance is going away. */
  | { readonly type: "disposed" }

export type MainPaneEffect<Pane> =
  | { readonly type: "load-pane"; readonly attempt: number }
  | { readonly type: "resolve-load"; readonly attempt: number; readonly pane: Pane }
  | { readonly type: "reject-load"; readonly attempt: number; readonly cause: unknown }
  | { readonly type: "dispose-pane"; readonly pane: Pane }

export type MainPaneTransition<Pane> = {
  readonly state: MainPaneState<Pane>
  readonly effects: readonly MainPaneEffect<Pane>[]
}

/** How a call that needs the pane gets it. */
export type PaneLookup<Pane> =
  | { readonly kind: "ready"; readonly pane: Pane }
  | { readonly kind: "pending"; readonly attempt: number }
  | { readonly kind: "unavailable" }

export const createMainPaneState = <Pane>(): MainPaneState<Pane> => ({ status: "unloaded", issued: 0 })

export function transitionMainPane<Pane>(
  state: MainPaneState<Pane>,
  event: MainPaneEvent<Pane>,
): MainPaneTransition<Pane> {
  switch (event.type) {
    case "load.requested":
      if (state.status !== "unloaded") return unchanged(state)

      return {
        state: { status: "loading", attempt: state.issued + 1 },
        effects: [{ type: "load-pane", attempt: state.issued + 1 }],
      }
    case "load.succeeded":
      // A pane nobody can use any more still owns a runtime; dispose it rather than leak it.
      if (state.status !== "loading" || event.attempt !== state.attempt)
        return { state, effects: [{ type: "dispose-pane", pane: event.pane }] }

      return {
        state: { status: "loaded", pane: event.pane },
        effects: [{ type: "resolve-load", attempt: event.attempt, pane: event.pane }],
      }
    case "load.failed":
      if (state.status !== "loading" || event.attempt !== state.attempt) return unchanged(state)

      return {
        state: { status: "unloaded", issued: state.attempt },
        effects: [{ type: "reject-load", attempt: event.attempt, cause: event.cause }],
      }
    case "disposed":
      if (state.status === "disposed") return unchanged(state)

      if (state.status === "loading")
        return {
          state: { status: "disposed" },
          effects: [{ type: "reject-load", attempt: state.attempt, cause: new Error("browser.pane.unavailable") }],
        }

      if (state.status === "loaded")
        return { state: { status: "disposed" }, effects: [{ type: "dispose-pane", pane: state.pane }] }

      return { state: { status: "disposed" }, effects: [] }
  }
}

/** The pane a call waits for: a register reads it after requesting a load, every other call without one. */
export function selectPane<Pane>(state: MainPaneState<Pane>): PaneLookup<Pane> {
  if (state.status === "loaded") return { kind: "ready", pane: state.pane }

  if (state.status === "loading") return { kind: "pending", attempt: state.attempt }

  return { kind: "unavailable" }
}

/** Whether a load that just imported its module should still create the pane. */
export function isLoadingPaneAttempt<Pane>(state: MainPaneState<Pane>, attempt: number) {
  return state.status === "loading" && state.attempt === attempt
}

function unchanged<Pane>(state: MainPaneState<Pane>): MainPaneTransition<Pane> {
  return { state, effects: [] }
}
