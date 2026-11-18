export type TrayDeps = {
  readonly iconPath: string
  /** Shows the last window, or opens one when every window is gone. */
  readonly show: () => void
  readonly quit: () => void
}

/**
 * The notification-area icon. Main installs it with the IPC layer; the setting creates and destroys
 * it while the app runs, and a language change rebuilds its menu.
 */
export type TrayState =
  | { readonly status: "uninstalled" }
  | { readonly status: "installed"; readonly deps: TrayDeps; readonly enabled: boolean }

export type TrayEvent =
  | { readonly type: "installed"; readonly deps: TrayDeps; readonly enabled: boolean }
  | { readonly type: "enabled.changed"; readonly enabled: boolean }
  /** Translations changed. */
  | { readonly type: "refreshed" }
  | { readonly type: "disposed" }

export type TrayCommand =
  | { readonly type: "create"; readonly deps: TrayDeps }
  | { readonly type: "rebuild"; readonly deps: TrayDeps }
  | { readonly type: "destroy" }

export type TrayTransition = {
  readonly state: TrayState
  readonly commands: readonly TrayCommand[]
}

export function createTrayState(): TrayState {
  return { status: "uninstalled" }
}

export function transitionTray(state: TrayState, event: TrayEvent): TrayTransition {
  if (event.type === "installed") {
    const next = { status: "installed", deps: event.deps, enabled: event.enabled } as const

    return { state: next, commands: event.enabled ? [{ type: "create", deps: event.deps }] : [] }
  }

  if (state.status === "uninstalled") return { state, commands: [] }

  if (event.type === "enabled.changed") {
    if (event.enabled === state.enabled) return { state, commands: [] }

    return {
      state: { ...state, enabled: event.enabled },
      commands: [event.enabled ? { type: "create", deps: state.deps } : { type: "destroy" }],
    }
  }

  if (event.type === "refreshed")
    return { state, commands: state.enabled ? [{ type: "rebuild", deps: state.deps }] : [] }

  return { state: { status: "uninstalled" }, commands: state.enabled ? [{ type: "destroy" }] : [] }
}
