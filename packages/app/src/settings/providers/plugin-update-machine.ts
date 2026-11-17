/** One package update on its way; `id` tells it apart from an update of the same package on an earlier server. */
export type RunningPluginUpdate = { readonly id: number; readonly target: string }

/**
 * Checking for and installing plugin package updates from Settings › Extensions. `outdated` holds what the latest
 * check or update learned per package, which is fresher than the listed plugins until the list loads again.
 */
export type PluginUpdateState =
  | {
      readonly status: "idle"
      readonly nextId: number
      readonly outdated: Readonly<Record<string, boolean>>
      readonly updating: readonly RunningPluginUpdate[]
    }
  | {
      readonly status: "checking"
      readonly attempt: number
      readonly nextId: number
      readonly outdated: Readonly<Record<string, boolean>>
      readonly updating: readonly RunningPluginUpdate[]
    }
  | { readonly status: "disposed" }

export type PluginUpdateEvent =
  | { readonly type: "check.requested" }
  /** `outdated` maps every package the check covered to whether it has a newer version. */
  | { readonly type: "check.succeeded"; readonly attempt: number; readonly outdated: Readonly<Record<string, boolean>> }
  | { readonly type: "check.failed"; readonly attempt: number; readonly message: string }
  | { readonly type: "update.requested"; readonly target: string }
  | { readonly type: "update.succeeded"; readonly id: number }
  | { readonly type: "update.failed"; readonly id: number; readonly message: string }
  /** The plugin list loaded again, so its own flags are current. */
  | { readonly type: "list.loaded" }
  /** Another server: forget what this one's checks and updates learned. */
  | { readonly type: "server.changed" }
  | { readonly type: "disposed" }

export type PluginUpdateEffect =
  | { readonly type: "check"; readonly attempt: number }
  | { readonly type: "update"; readonly id: number; readonly target: string }
  | { readonly type: "refresh" }
  | { readonly type: "failed"; readonly message: string }

export type PluginUpdateTransition = {
  readonly state: PluginUpdateState
  readonly effects: readonly PluginUpdateEffect[]
}

const none: readonly PluginUpdateEffect[] = []

const step = (state: PluginUpdateState, effects = none): PluginUpdateTransition => ({ state, effects })

export function createPluginUpdateState(): PluginUpdateState {
  return { status: "idle", nextId: 0, outdated: {}, updating: [] }
}

export function transitionPluginUpdate(state: PluginUpdateState, event: PluginUpdateEvent): PluginUpdateTransition {
  if (state.status === "disposed") return step(state)

  if (event.type === "disposed") return step({ status: "disposed" })

  if (event.type === "server.changed") return step({ status: "idle", nextId: state.nextId, outdated: {}, updating: [] })

  if (event.type === "list.loaded") {
    if (Object.keys(state.outdated).length === 0) return step(state)

    return step({ ...state, outdated: {} })
  }

  if (event.type === "check.requested") {
    if (state.status === "checking") return step(state)

    const attempt = state.nextId

    return step({ ...state, status: "checking", attempt, nextId: attempt + 1 }, [{ type: "check", attempt }])
  }

  if (event.type === "check.succeeded" || event.type === "check.failed") {
    if (state.status !== "checking" || state.attempt !== event.attempt) return step(state)

    const idle = { status: "idle", nextId: state.nextId, outdated: state.outdated, updating: state.updating } as const

    if (event.type === "check.failed") return step(idle, [{ type: "failed", message: event.message }])

    return step({ ...idle, outdated: event.outdated })
  }

  if (event.type === "update.requested") {
    if (state.updating.some((item) => item.target === event.target)) return step(state)

    const id = state.nextId

    return step({ ...state, nextId: id + 1, updating: [...state.updating, { id, target: event.target }] }, [
      { type: "update", id, target: event.target },
    ])
  }

  const running = state.updating.find((item) => item.id === event.id)

  if (!running) return step(state)

  const updating = state.updating.filter((item) => item !== running)

  if (event.type === "update.failed") return step({ ...state, updating }, [{ type: "failed", message: event.message }])

  return step({ ...state, updating, outdated: { ...state.outdated, [running.target]: false } }, [{ type: "refresh" }])
}

export type PluginUpdateView = { readonly outdated: boolean; readonly updating: boolean }

/** What the Plugins tab shows for a package, given the flags the listed plugin carries. */
export function pluginUpdateView(
  state: PluginUpdateState,
  source: { readonly target: string; readonly outdated?: true; readonly updating?: true },
): PluginUpdateView {
  if (state.status === "disposed") return { outdated: false, updating: false }

  const updating = source.updating === true || state.updating.some((item) => item.target === source.target)

  return { outdated: state.outdated[source.target] ?? source.outdated === true, updating }
}

export const pluginUpdateChecking = (state: PluginUpdateState) => state.status === "checking"
