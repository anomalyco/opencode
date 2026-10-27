import { Tabs } from "@opencode/ui/tabs"
import { useDialog } from "@opencode/ui/context/dialog"
import { createEffect, createMemo, For, on, onCleanup, onMount, Show, Switch, Match, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useTabs } from "@/shell/tabs/tabs"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import type { LocalProject } from "@/shell/state/layout"
import { DialogServer } from "@/servers/connect/dialog"
import { LocationProvider } from "@/workspaces/location"
import { SettingsGeneral } from "./general/general"
import { SettingsAppearance } from "./appearance/appearance"
import { experimentalSettingsAvailable, SettingsExperimental } from "./experimental/experimental"
import { SettingsKeybinds } from "./keybinds/keybinds"
import { SettingsNotifications } from "./notifications/notifications"
import { SettingsProviders } from "./providers/providers"
import { SettingsModels } from "./models/models"
import { SettingsServerGeneral, SettingsServerList } from "./servers/servers"
import { SettingsServerSwitcher } from "./servers/switcher"
import { SettingsServerUnavailable } from "./servers/unavailable"
import { settingsServerReachable, useSettingsServers, useSettingsServersLoaded } from "./servers/inventory"
import { SettingsWorkspaces } from "./workspaces/workspaces"
import { useWorkspacesPrefetch } from "./workspaces/queries"
import { SettingsProjects } from "./workspaces/projects"
import { SettingsExtensions } from "./providers/extensions"
import { SettingsAbout } from "./about/about"
import { SettingsServerDataScope } from "./server-scope"
import { SettingsNavigation, type SettingsNavGroup } from "./navigation"
import { SettingsProjectGeneral } from "./workspaces/project"
import { ProjectSettingsExtensions } from "./workspaces/project-extensions"
import { useSettingsSurface } from "./surface"
import { settingsViewRedirect } from "./route"
import { pageIcons, pageLabels } from "./pages"
import { revealSettingsSearch } from "./search-reveal"
import { PluginSettingsPages } from "@/runtime/plugin/settings-page-view"
import "@/settings/settings.css"

const rootClientTabs = [
  { value: "general", icon: pageIcons.general, label: "settings.tab.preferences" },
  { value: "appearance", icon: pageIcons.appearance, label: "settings.general.section.appearance" },
  { value: "notifications", icon: pageIcons.notifications, label: "settings.tab.notifications" },
  { value: "shortcuts", icon: pageIcons.shortcuts, label: "settings.tab.shortcuts" },
] as const

const serverTabs = [
  { value: "providers", icon: pageIcons.providers, label: "settings.providers.title" },
  { value: "models", icon: pageIcons.models, label: "settings.models.title" },
  { value: "extensions", icon: pageIcons.extensions, label: "settings.tab.extensions" },
  { value: "projects", icon: pageIcons.projects, label: "settings.tab.projects" },
  { value: "workspaces", icon: pageIcons.workspaces, label: "settings.tab.workspaces" },
] as const

// The heading of each per-server page, which its unreachable state keeps.
const serverPages = {
  providers: { title: "settings.providers.title", description: "settings.providers.description" },
  models: { title: "settings.models.title", description: "settings.models.description" },
  extensions: { title: "settings.tab.extensions", description: "settings.extensions.description" },
  projects: { title: "settings.projects.title", description: "settings.projects.description" },
  workspaces: { title: "settings.tab.workspaces", description: "settings.workspaces.description" },
} as const

const experimentalTab = [
  { value: "experimental", icon: pageIcons.experimental, label: "settings.tab.experimental" },
] as const

const aboutTab = [{ value: "about", icon: pageIcons.about, label: "settings.tab.about" }] as const

const nestedProjectTabs = [
  { value: "general", icon: pageIcons.projects, label: "settings.general.section.general" },
  { value: "workspaces", icon: pageIcons.workspaces, label: "settings.tab.workspaces" },
  { value: "extensions", icon: pageIcons.extensions, label: "settings.tab.extensions" },
] as const

export function SettingsScreen() {
  const surface = useSettingsSurface()
  const dialog = useDialog()
  const servers = useSettingsServers()
  const loaded = useSettingsServersLoaded()
  const global = useGlobal()
  let root: HTMLDivElement | undefined
  let viewType = surface.view().type
  let activation = 0

  onMount(() => root?.focus({ preventScroll: true }))
  createEffect(() => {
    const next = surface.view().type

    if (next === viewType) return
    viewType = next
    queueMicrotask(() => {
      const target =
        surface.search.state.query.trim() && surface.search.state.expanded
          ? root?.querySelector<HTMLInputElement>(".settings-search input")
          : root

      target?.focus({ preventScroll: true })
    })
  })

  createEffect(
    on(
      () => [surface.view(), surface.search.state.selected] as const,
      ([view, selected]) => {
        if (
          !root ||
          !selected ||
          !view.searchActivation ||
          view.searchActivation !== surface.search.state.activation ||
          view.searchActivation === activation
        )
          return
        activation = view.searchActivation
        onCleanup(revealSettingsSearch(root, view))
      },
    ),
  )

  const connection = (key: string) => servers().find((item) => item.key === key)

  const project = (server: ServerConnection.Any, directory: string) =>
    global
      .ensureServerCtx(server)
      .projects.list()
      .find((item) => item.worktree === directory)

  const targetServer = createMemo(() => {
    const view = surface.view()

    if (view.type !== "project") return undefined

    return connection(view.server)
  })

  const targetProject = createMemo(() => {
    const view = surface.view()
    const server = targetServer()

    if (view.type !== "project" || !server) return undefined

    return server.connection && project(server.connection, view.project)
  })

  createEffect(() => {
    const next = settingsViewRedirect({
      view: surface.view(),
      loaded: loaded(),
      servers: servers().map((item) => ({
        key: item.key,
        connected: !!item.connection,
        starting: item.source?.entry.state === "starting",
      })),
    })

    if (next) surface.replace(next)
  })

  return (
    <div
      ref={root}
      data-testid="settings-screen"
      class="settings-screen"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || dialog.active) return
        event.preventDefault()

        if (surface.view().type !== "root" && surface.search.back()) return

        if (surface.search.state.query.trim()) {
          surface.search.clear()

          return
        }

        surface.back()
      }}
      onWheel={(event) => {
        if (!root || event.ctrlKey || !event.deltaY || !(event.target instanceof Element)) return

        // The page scrolls inside its panel, so a wheel over the gutters or sidebar would otherwise do nothing.
        if (event.target.closest(".settings-content") || scrollsNatively(event.target, root, event.deltaY)) return
        const panel = root.querySelector<HTMLElement>(".settings-content > .settings-panel")

        if (!panel) return

        const unit =
          event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? panel.clientHeight
            : event.deltaMode === WheelEvent.DOM_DELTA_LINE
              ? 16
              : 1

        panel.scrollBy({ top: event.deltaY * unit })
      }}
    >
      <Switch>
        <Match when={surface.view().type === "root"}>
          <RootSettings />
        </Match>
        <Match when={surface.view().type === "project"}>
          <Show when={targetServer()?.connection} keyed>
            {(server) => (
              <Show when={targetProject()}>{(project) => <ProjectSettings server={server} project={project()} />}</Show>
            )}
          </Show>
        </Match>
      </Switch>
    </div>
  )
}

function scrollsNatively(target: Element, root: Element, deltaY: number) {
  for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
    if (!/auto|scroll/.test(getComputedStyle(node).overflowY)) continue

    if (deltaY < 0 ? node.scrollTop > 0 : node.scrollHeight - node.clientHeight - node.scrollTop > 1) return true
  }

  return false
}

function RootSettings() {
  const language = useLanguage()
  const dialog = useDialog()
  const surface = useSettingsSurface()
  const global = useGlobal()
  const inventory = useSettingsServers()

  const [state, setState] = createStore<{ worktreeFilterReset: number; modelProvider: string | undefined }>({
    worktreeFilterReset: 0,
    modelProvider: undefined,
  })

  const multiple = createMemo(() => inventory().length > 1)

  // The selected server while its pages can load; an unreachable one shows its pages' unavailable state instead.
  const reachable = createMemo(() => {
    const entry = surface.server()

    return entry && settingsServerReachable(entry, global.servers.health[entry.key]) ? entry.connection : undefined
  })

  const prefetchWorkspaces = useWorkspacesPrefetch(reachable)
  const activeDirectory = useSettingsDirectory(reachable)
  createEffect(() => {
    const view = surface.view()

    if (view.type !== "root") return

    if (view.tab === "experimental" && !experimentalSettingsAvailable) surface.open("general")
  })

  const selectServer = (server: ServerConnection.Any) => surface.selectServer(ServerConnection.key(server))

  const addServer = () => void dialog.push(() => <DialogServer mode="add" onSave={selectServer} />)

  const pluginTabs = (group?: "about") =>
    surface.plugins
      .pages()
      .filter((item) => item.value.group === group)
      .map((item) => ({ value: item.value.id, icon: item.value.icon ?? pageIcons.extensions, label: item.value.title }))

  const groups = createMemo<SettingsNavGroup[]>(() => [
    {
      items: serverTabs.map((item) => ({
        ...item,
        label: language.t(item.label),
        onPrefetch: item.value === "workspaces" ? prefetchWorkspaces : undefined,
      })),
    },
    {
      items: [...rootClientTabs.map((item) => ({ ...item, label: language.t(item.label) })), ...pluginTabs()],
    },
    {
      items: [
        {
          value: "servers",
          icon: pageIcons.servers,
          label: language.t(multiple() ? "settings.tab.servers" : pageLabels.servers),
        },
      ],
    },
    ...(experimentalSettingsAvailable
      ? [{ items: experimentalTab.map((item) => ({ ...item, label: language.t(item.label) })) }]
      : []),
    {
      items: [...aboutTab.map((item) => ({ ...item, label: language.t(item.label) })), ...pluginTabs("about")],
    },
  ])

  const change = (value: string) => {
    if (value === "workspaces") setState("worktreeFilterReset", (current) => current + 1)
    surface.select(value)
  }

  return (
    <SettingsNavigation
      value={surface.view().tab}
      groups={groups()}
      backLabel={language.t("settings.backToApp")}
      onBack={() => surface.close()}
      onChange={change}
    >
      <Tabs.Content value="general" class="settings-panel">
        <SettingsGeneral />
      </Tabs.Content>
      <Tabs.Content value="appearance" class="settings-panel">
        <SettingsAppearance />
      </Tabs.Content>
      <Tabs.Content value="notifications" class="settings-panel">
        <SettingsNotifications />
      </Tabs.Content>
      <Tabs.Content value="shortcuts" class="settings-panel">
        <SettingsKeybinds active={surface.view().tab === "shortcuts"} />
      </Tabs.Content>
      <PluginSettingsPages />
      <Tabs.Content value="experimental" class="settings-panel">
        <SettingsExperimental />
      </Tabs.Content>
      <Tabs.Content value="about" class="settings-panel settings-about">
        <SettingsAbout active={surface.view().tab === "about"} />
      </Tabs.Content>
      <Show
        when={reachable()}
        keyed
        fallback={
          <Show when={surface.server()}>
            {(entry) => (
              <For each={serverTabs}>
                {(item) => (
                  <Tabs.Content value={item.value} class="settings-panel">
                    <SettingsServerUnavailable
                      entry={entry()}
                      title={language.t(serverPages[item.value].title)}
                      description={language.t(serverPages[item.value].description)}
                      headerAction={<SettingsServerSwitcher />}
                      onManage={() => surface.openServers(entry().key)}
                      onServerChange={selectServer}
                    />
                  </Tabs.Content>
                )}
              </For>
            )}
          </Show>
        }
      >
        {(server) => (
          <SettingsServerDataScope server={server}>
            <Tabs.Content value="providers" class="settings-panel">
              <SettingsProviders
                directory={undefined}
                headerAction={<SettingsServerSwitcher />}
                onSelectProvider={(providerID) => {
                  setState("modelProvider", providerID)
                  surface.select("models")
                }}
              />
            </Tabs.Content>
            <Tabs.Content value="models" class="settings-panel">
              <SettingsModels
                active={surface.view().tab === "models"}
                provider={state.modelProvider}
                headerAction={<SettingsServerSwitcher />}
                onReveal={() => setState("modelProvider", undefined)}
              />
            </Tabs.Content>
            <Tabs.Content value="extensions" class="settings-panel">
              <SettingsExtensions
                directory={activeDirectory()}
                subtab={surface.view().subtab}
                headerAction={<SettingsServerSwitcher />}
                onSubtab={(value) => surface.subtab(value)}
              />
            </Tabs.Content>
            <Tabs.Content value="projects" class="settings-panel">
              <SettingsProjects
                server={server}
                active={surface.view().tab === "projects"}
                headerAction={<SettingsServerSwitcher />}
                onOpenProject={(project) =>
                  surface.openProject({
                    server: ServerConnection.key(server),
                    project: project.worktree,
                  })
                }
              />
            </Tabs.Content>
            <Tabs.Content value="workspaces" class="settings-panel">
              <SettingsWorkspaces
                activeDirectory={activeDirectory()}
                resetProjectFilter={() => state.worktreeFilterReset}
                headerAction={<SettingsServerSwitcher />}
              />
            </Tabs.Content>
          </SettingsServerDataScope>
        )}
      </Show>
      <Tabs.Content value="servers" class="settings-panel">
        <Show
          when={multiple() ? undefined : inventory()[0]}
          fallback={
            <SettingsServerList
              servers={inventory()}
              selected={surface.server()?.key}
              onAddServer={addServer}
              onServerChange={selectServer}
            />
          }
        >
          {(entry) => <SettingsServerGeneral entry={entry()} onAddServer={addServer} />}
        </Show>
      </Tabs.Content>
    </SettingsNavigation>
  )
}

function ProjectSettings(props: { server: ServerConnection.Any; project: LocalProject }) {
  const language = useLanguage()
  const surface = useSettingsSurface()
  const activeDirectory = useSettingsDirectory(() => props.server)

  const prefetchWorkspaces = useWorkspacesPrefetch(
    () => props.server,
    () => props.project.id,
  )

  const groups: SettingsNavGroup[] = [
    {
      items: nestedProjectTabs.map((item) => ({
        ...item,
        label: language.t(item.label),
        onPrefetch: item.value === "workspaces" ? prefetchWorkspaces : undefined,
      })),
    },
  ]

  return (
    <SettingsServerDataScope server={props.server} directory={props.project.worktree}>
      <LocationProvider directory={props.project.worktree}>
        <SettingsNavigation
          value={surface.view().tab}
          groups={groups}
          backLabel={language.t("settings.backToProjects")}
          onBack={() => surface.back()}
          onChange={(value) => surface.select(value)}
        >
          <Tabs.Content value="general" class="settings-panel">
            <SettingsProjectGeneral
              server={props.server}
              project={props.project}
              onOpenServer={() => surface.openServers(ServerConnection.key(props.server))}
            />
          </Tabs.Content>
          <Tabs.Content value="workspaces" class="settings-panel">
            <SettingsWorkspaces projectID={props.project.id} activeDirectory={activeDirectory()} />
          </Tabs.Content>
          <Tabs.Content value="extensions" class="settings-panel">
            <ProjectSettingsExtensions subtab={surface.view().subtab} onSubtab={(value) => surface.subtab(value)} />
          </Tabs.Content>
        </SettingsNavigation>
      </LocationProvider>
    </SettingsServerDataScope>
  )
}

function useSettingsDirectory(server: Accessor<ServerConnection.Any | undefined>) {
  const surface = useSettingsSurface()
  const tabs = useTabs()
  const serverCtx = useServerCtx(server)

  return createMemo(() => {
    const current = server()

    if (!current) return undefined
    const key = ServerConnection.key(current)
    const route = surface.route()

    if (route.type === "session" && route.server === key)
      return serverCtx()?.data.session.get(route.sessionId)?.location.directory

    if (route.type !== "draft") return undefined
    const draft = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)

    return draft?.type === "draft" && draft.server === key ? draft.directory : undefined
  })
}
