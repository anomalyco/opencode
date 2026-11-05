export type MenuCommandHandler = (id: string) => void

/**
 * Where native menu commands go. Until the app interface mounts, and after it unmounted, they wait in `queued`; the
 * interface's command context runs them once it binds.
 */
export type MenuRouterState =
  | { readonly status: "unbound"; readonly queued: readonly string[] }
  | { readonly status: "bound"; readonly handler: MenuCommandHandler }

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
  return { status: "unbound", queued: [] }
}

export function transitionMenuRouter(state: MenuRouterState, event: MenuRouterEvent): MenuRouterTransition {
  if (event.type === "command.received") {
    if (state.status === "unbound") return { state: { status: "unbound", queued: [...state.queued, event.id] }, commands: [] }

    return { state, commands: [{ type: "trigger", handler: state.handler, ids: [event.id] }] }
  }

  if (event.type === "bound") {
    if (state.status === "bound" && state.handler === event.handler) return { state, commands: [] }
    const queued = state.status === "unbound" ? state.queued : []

    return {
      state: { status: "bound", handler: event.handler },
      commands: queued.length ? [{ type: "trigger", handler: event.handler, ids: queued }] : [],
    }
  }

  if (state.status !== "bound" || state.handler !== event.handler) return { state, commands: [] }

  return { state: createMenuRouterState(), commands: [] }
}
