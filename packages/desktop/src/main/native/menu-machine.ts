import type { MenubarEntry } from "./menu"

export type MenubarProvider = () => readonly MenubarEntry[]

/**
 * The macOS application menu. Main installs it once windows are restored; until then, and after the IPC layer closed,
 * a plugin contribution or a language change only records what the next build reads.
 */
export type MenuState<Deps> =
  | { readonly status: "uninstalled"; readonly provider: MenubarProvider }
  | { readonly status: "installed"; readonly deps: Deps; readonly provider: MenubarProvider }

export type MenuEvent<Deps> =
  | { readonly type: "installed"; readonly deps: Deps }
  | { readonly type: "provider.changed"; readonly provider: MenubarProvider }
  /** Contributions or translations changed. */
  | { readonly type: "refreshed" }
  | { readonly type: "disposed" }

export type MenuCommand<Deps> = { readonly type: "build"; readonly deps: Deps; readonly provider: MenubarProvider }

export type MenuTransition<Deps> = {
  readonly state: MenuState<Deps>
  readonly commands: readonly MenuCommand<Deps>[]
}

export function createMenuState<Deps>(): MenuState<Deps> {
  return { status: "uninstalled", provider: () => [] }
}

export function transitionMenu<Deps>(state: MenuState<Deps>, event: MenuEvent<Deps>): MenuTransition<Deps> {
  if (event.type === "installed") return build({ status: "installed", deps: event.deps, provider: state.provider })

  if (event.type === "provider.changed") {
    if (event.provider === state.provider) return { state, commands: [] }

    return state.status === "installed"
      ? build({ ...state, provider: event.provider })
      : { state: { ...state, provider: event.provider }, commands: [] }
  }

  if (state.status === "uninstalled") return { state, commands: [] }

  if (event.type === "refreshed") return build(state)

  return { state: { status: "uninstalled", provider: state.provider }, commands: [] }
}

function build<Deps>(state: Extract<MenuState<Deps>, { status: "installed" }>): MenuTransition<Deps> {
  return { state, commands: [{ type: "build", deps: state.deps, provider: state.provider }] }
}
