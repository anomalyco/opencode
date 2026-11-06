// The window's browser model, loaded when the first session opens. Each load takes the next attempt number, so a load
// the plugin's cleanup or a retry overtook never hands out its model.

/** How long the model's chunk may take to load before the panel offers a retry. */
export const BROWSER_MODEL_LOAD_TIMEOUT_MS = 15_000

/**
 * - `unloaded`: no session opened yet; `issued` is the last attempt handed out.
 * - `loading`: the model's chunk loads.
 * - `loaded`: the model serves the panel, its tabs and commands.
 * - `failed`: the chunk failed to load or ran out of time; the panel shows why, with a retry.
 * - `disposed`: the plugin instance went away.
 */
export type BrowserModelState<M> =
  | { readonly status: "unloaded"; readonly issued: number }
  | { readonly status: "loading"; readonly attempt: number }
  | { readonly status: "loaded"; readonly model: M }
  | { readonly status: "failed"; readonly issued: number; readonly error: string }
  | { readonly status: "disposed" }

export type BrowserModelEvent<M> =
  /** The first session opened. */
  | { readonly type: "load.requested" }
  /** The user asks to load it again after a failure. */
  | { readonly type: "retry.requested" }
  | { readonly type: "load.succeeded"; readonly attempt: number; readonly model: M }
  /** The chunk failed to load or ran out of time. */
  | { readonly type: "load.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "disposed" }

export type BrowserModelEffect = { readonly type: "load-model"; readonly attempt: number }

export type BrowserModelTransition<M> = {
  readonly state: BrowserModelState<M>
  readonly effects: readonly BrowserModelEffect[]
}

export const createBrowserModelState = <M>(): BrowserModelState<M> => ({ status: "unloaded", issued: 0 })

export function transitionBrowserModel<M>(
  state: BrowserModelState<M>,
  event: BrowserModelEvent<M>,
): BrowserModelTransition<M> {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return unchanged({ status: "disposed" })

  if (
    (event.type === "load.requested" && state.status === "unloaded") ||
    (event.type === "retry.requested" && state.status === "failed")
  ) {
    const attempt = state.issued + 1

    return { state: { status: "loading", attempt }, effects: [{ type: "load-model", attempt }] }
  }

  if (event.type === "load.succeeded" && isLoadingBrowserModel(state, event.attempt))
    return unchanged({ status: "loaded", model: event.model })

  if (event.type === "load.failed" && isLoadingBrowserModel(state, event.attempt))
    return unchanged({ status: "failed", issued: event.attempt, error: event.error })

  return unchanged(state)
}

/** Whether a load that just imported its module should still create the model. */
export function isLoadingBrowserModel<M>(state: BrowserModelState<M>, attempt: number) {
  return state.status === "loading" && state.attempt === attempt
}

export function selectBrowserModel<M>(state: BrowserModelState<M>) {
  return state.status === "loaded" ? state.model : undefined
}

/** Why the model failed to load, while the panel offers a retry. */
export function selectBrowserModelError<M>(state: BrowserModelState<M>) {
  return state.status === "failed" ? state.error : undefined
}

/**
 * A stored tab stays listed but hidden until the model knows it. Once the load failed it shows, so the panel can say
 * why and offer a retry.
 */
export function selectBrowserTabHidden<M>(state: BrowserModelState<M>, known: (model: M) => boolean) {
  if (state.status === "failed") return false

  return state.status !== "loaded" || !known(state.model)
}

function unchanged<M>(state: BrowserModelState<M>): BrowserModelTransition<M> {
  return { state, effects: [] }
}
