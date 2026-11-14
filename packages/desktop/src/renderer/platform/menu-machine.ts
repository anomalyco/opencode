export type MenuCommandHandler = (id: string) => void

/**
 * Where native menu commands go. Before the app interface first mounts they wait in `queued`, and its command context
 * runs them once it binds. After it unmounted (the error boundary tripped), they are dropped: a later remount must not
 * replay what the user pressed on the error screen.
 */
export type MenuRouterState =
  | { readonly status: "starting"; readonly queued: readonly string[] }
  | { readonly status: "bound"; readonly handler: MenuCommandHandler }
  | { readonly status: "unbound" }

export type MenuRouterEvent =
  | { readonly type: "command.received"; readonly id: string }
  | { readonly type: "bound"; readonly handler: MenuCommandHandler }
  /** Names the handler its owner bound, so a cleanup that runs after another owner bound changes nothing. */
  | { readonly type: "unbound"; readonly handler: MenuCommandHandler }

export type MenuRouterCommand = {
  readonly type: "trigger"
  readonly handler: MenuCommandHandler
  readonly ids: readonly string[]
}

export type MenuRouterTransition = {
  readonly state: MenuRouterState
  readonly commands: readonly MenuRouterCommand[]
}

export function createMenuRouterState(): MenuRouterState {
  return { status: "starting", queued: [] }
}

export function transitionMenuRouter(state: MenuRouterState, event: MenuRouterEvent): MenuRouterTransition {
  if (event.type === "command.received") {
    if (state.status === "starting")
      return { state: { status: "starting", queued: [...state.queued, event.id] }, commands: [] }

    if (state.status === "unbound") return { state, commands: [] }

    return { state, commands: [{ type: "trigger", handler: state.handler, ids: [event.id] }] }
  }

  if (event.type === "bound") {
    if (state.status === "bound" && state.handler === event.handler) return { state, commands: [] }
    const queued = state.status === "starting" ? state.queued : []

    return {
      state: { status: "bound", handler: event.handler },
      commands: queued.length ? [{ type: "trigger", handler: event.handler, ids: queued }] : [],
    }
  }

  if (state.status !== "bound" || state.handler !== event.handler) return { state, commands: [] }

  return { state: { status: "unbound" }, commands: [] }
}
