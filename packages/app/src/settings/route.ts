export type SettingsRootTab =
  | "general"
  | "appearance"
  | "notifications"
  | "shortcuts"
  | "projects"
  | "workspaces"
  | "providers"
  | "models"
  | "extensions"
  | "servers"
  | "experimental"
  | "gui-extensions"
  | "about"

declare const extensionTab: unique symbol

/** A root page a GUI extension contributes; the value is its SettingsPage id. */
export type SettingsExtensionTab = string & { readonly [extensionTab]: true }

/** Root pages that show one server's settings: the selected server, or the default one. */
export type SettingsServerTab = "projects" | "workspaces" | "providers" | "models" | "extensions"

export type SettingsProjectTab = "general" | "workspaces" | "extensions"

type SettingsViewState = {
  target?: string
  subtab?: "mcps" | "plugins" | "skills" | "lsps"
  searchActivation?: number
}

type SettingsProjectView = { type: "project"; server: string; project: string; tab: SettingsProjectTab }

/** `server` on a root view is the server its per-server pages show; without it they show the default server. */
export type SettingsView = (
  | { type: "root"; tab: SettingsRootTab | SettingsExtensionTab; server?: string }
  | SettingsProjectView
) &
  SettingsViewState

/** A view of a page the host owns. */
export type SettingsHostView = ({ type: "root"; tab: SettingsRootTab; server?: string } | SettingsProjectView) &
  SettingsViewState

export type SettingsTransientView = Pick<SettingsView, "target" | "searchActivation">

const rootTabs: Record<SettingsRootTab, true> = {
  general: true,
  appearance: true,
  notifications: true,
  shortcuts: true,
  projects: true,
  workspaces: true,
  providers: true,
  models: true,
  extensions: true,
  servers: true,
  experimental: true,
  "gui-extensions": true,
  about: true,
}

const projectTabs: Record<SettingsProjectTab, true> = {
  general: true,
  workspaces: true,
  extensions: true,
}

const subtabs: Record<NonNullable<SettingsView["subtab"]>, true> = {
  mcps: true,
  plugins: true,
  skills: true,
  lsps: true,
}

export function parseSettingsView(
  search: string,
  transient?: SettingsTransientView,
  extensionTabs?: ReadonlySet<string>,
): SettingsView {
  const params = new URLSearchParams(search)
  const tab = params.get("tab") ?? "general"
  const server = params.get("server") ?? undefined
  const project = params.get("project")
  const subtab = params.get("subtab")
  const nested = subtab && isSubtab(subtab) && tab === "extensions" ? subtab : undefined

  if (project && server && isProjectTab(tab))
    return { type: "project", server, project, tab, subtab: nested, ...transient }

  // Links to a server's own page, which the Servers page replaced, name a server without a tab.
  if (!project && server && !params.has("tab")) return { type: "root", tab: "servers", server, ...transient }

  if (!project && isRootTab(tab))
    return { type: "root", tab, server, subtab: nested === "lsps" ? undefined : nested, ...transient }

  if (!project && extensionTabs && isExtensionTab(tab, extensionTabs))
    return { type: "root", tab, server, subtab: undefined, ...transient }

  return { type: "root", tab: "general", ...transient }
}

export function settingsViewUrl(view: SettingsView) {
  const params = new URLSearchParams()

  if (view.server) params.set("server", view.server)

  if (view.type === "project") params.set("project", view.project)

  // A server without a tab names the Servers page, so a root view with a server always names its tab.
  if (view.tab !== "general" || (view.type === "root" && view.server)) params.set("tab", view.tab)

  if (view.tab === "extensions" && view.subtab) params.set("subtab", view.subtab)
  const search = params.toString()

  return search ? `/settings?${search}` : "/settings"
}

type RedirectServer = { key: string; connected: boolean; starting: boolean }

/** Where a view must go when the server it names is gone, or a project's server is unavailable. */
export function settingsViewRedirect(input: {
  view: SettingsView
  /** False while the saved, WSL, and SSH server lists load; a restored route waits for them. */
  loaded: boolean
  servers: readonly RedirectServer[]
}): SettingsView | undefined {
  const view = input.view

  if (!view.server || !input.loaded) return
  const server = input.servers.find((item) => item.key === view.server)

  if (view.type === "root") return server ? undefined : { ...view, server: undefined }

  if (!server) return { type: "root", tab: "projects" }

  // A starting WSL or SSH server connects shortly; only an unavailable one leaves the project page.
  if (!server.connected && !server.starting) return { type: "root", tab: "projects", server: server.key }
}

export function isRootTab(value: string): value is SettingsRootTab {
  return Object.hasOwn(rootTabs, value)
}

/** Host tabs win over an extension page with the same id. */
export function isExtensionTab(value: string, tabs: ReadonlySet<string>): value is SettingsExtensionTab {
  return !isRootTab(value) && tabs.has(value)
}

export function isProjectTab(value: string): value is SettingsProjectTab {
  return Object.hasOwn(projectTabs, value)
}

function isSubtab(value: string): value is NonNullable<SettingsView["subtab"]> {
  return Object.hasOwn(subtabs, value)
}
