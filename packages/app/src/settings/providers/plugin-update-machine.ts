/** One package update on its way; `id` tells it apart from an update of the same package on an earlier server. */
export type RunningPluginUpdate = { readonly id: number; readonly target: string }

/** What a check or update learned about one package; `at` is that operation's id, so an older result never wins. */
export type PluginUpdateFinding = { readonly outdated: boolean; readonly at: number }

/**
 * Checking for and installing plugin package updates from Settings › Extensions. `findings` holds what checks and
 * updates learned per package. The server reloads its plugins after both return, so a list read in between still
 * carries the old flags; a finding stays until a settled list agrees with it.
 */
export type PluginUpdateState =
  | {
      readonly status: "idle"
      readonly nextId: number
      readonly findings: Readonly<Record<string, PluginUpdateFinding>>
      readonly updating: readonly RunningPluginUpdate[]
    }
  | {
      readonly status: "checking"
      readonly attempt: number
      readonly nextId: number
      readonly findings: Readonly<Record<string, PluginUpdateFinding>>
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
  /**
   * The plugin list loaded again; `outdated` maps each listed package to its flag. A list read while the server still
   * reloads its plugins can predate the latest check or update, so a finding is only dropped once a list agrees with it.
   */
  | { readonly type: "list.loaded"; readonly outdated: Readonly<Record<string, boolean>> }
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
  return { status: "idle", nextId: 0, findings: {}, updating: [] }
}

export function transitionPluginUpdate(state: PluginUpdateState, event: PluginUpdateEvent): PluginUpdateTransition {
  if (state.status === "disposed") return step(state)

  if (event.type === "disposed") return step({ status: "disposed" })

  if (event.type === "server.changed") return step({ status: "idle", nextId: state.nextId, findings: {}, updating: [] })

  if (event.type === "list.loaded") {
    const settled = Object.keys(state.findings).filter(
      (target) => !(target in event.outdated) || event.outdated[target] === state.findings[target]?.outdated,
    )

    if (settled.length === 0) return step(state)

    const findings = { ...state.findings }

    for (const target of settled) delete findings[target]

    return step({ ...state, findings })
  }

  if (event.type === "check.requested") {
    if (state.status === "checking") return step(state)

    const attempt = state.nextId

    return step({ ...state, status: "checking", attempt, nextId: attempt + 1 }, [{ type: "check", attempt }])
  }

  if (event.type === "check.succeeded" || event.type === "check.failed") {
    if (state.status !== "checking" || state.attempt !== event.attempt) return step(state)

    const idle = { status: "idle", nextId: state.nextId, findings: state.findings, updating: state.updating } as const

    if (event.type === "check.failed") return step(idle, [{ type: "failed", message: event.message }])

    // An update that started or finished after this check began knows more about its package than the check does.
    const findings = { ...state.findings }

    for (const [target, outdated] of Object.entries(event.outdated)) {
      const newer =
        (findings[target]?.at ?? -1) > event.attempt || state.updating.some((item) => item.target === target)

      if (!newer) findings[target] = { outdated, at: event.attempt }
    }

    return step({ ...idle, findings })
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

  return step(
    { ...state, updating, findings: { ...state.findings, [running.target]: { outdated: false, at: running.id } } },
    [{ type: "refresh" }],
  )
}

export type PluginUpdateView = { readonly outdated: boolean; readonly updating: boolean }

/** What the Plugins tab shows for a package, given the flags the listed plugin carries. */
export function pluginUpdateView(
  state: PluginUpdateState,
  source: { readonly target: string; readonly outdated?: true; readonly updating?: true },
): PluginUpdateView {
  if (state.status === "disposed") return { outdated: false, updating: false }

  const updating = source.updating === true || state.updating.some((item) => item.target === source.target)

  return { outdated: state.findings[source.target]?.outdated ?? source.outdated === true, updating }
}

export const pluginUpdateChecking = (state: PluginUpdateState) => state.status === "checking"
