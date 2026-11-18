import { Schema } from "effect"
import { createEffect, createMemo, Show, onCleanup, untrack, type Accessor, type JSX } from "solid-js"
import { Key } from "@solid-primitives/keyed"
import { createStore } from "solid-js/store"
import { useQuery } from "@tanstack/solid-query"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { ScrollView } from "@opencode/ui/scroll-view"
import { displayName } from "@opencode/ui/project-avatar"
import { homeSessionsQuery } from "@/home/sessions/queries"
import { createProjectActions } from "@/home/projects/actions"
import { ProjectMenuItems } from "@/home/projects/menu"
import { buildHomeSessionRecords } from "@/home/sessions/records"
import { arrayMove } from "@/runtime/array-move"
import { useLanguage } from "@/runtime/i18n/language"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import type { Project } from "@/runtime/server/types"
import { ProjectIcon } from "@/shell/layout/project-icon"
import { useProjectBrowser, type ProjectBrowserTarget } from "@/home/projects/browse"
import { ServerLabel } from "@/servers/registry/label"
import { useProjectNavigation } from "@/shell/project-navigation"
import { useLayout } from "@/shell/state/layout"
import { createProjectSessionActions } from "@/shell/tabs/project-sessions"
import { useTabs, type Tab } from "@/shell/tabs/tabs"
import { pathKey } from "@/workspaces/path-key"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { addProjects } from "@/home/projects/add"
import { homeProjectDirectories } from "@/shell/layout/helpers"
import "./tab-nav.css"
import { ProjectSessionRow } from "./project-session-row"
import type { SidebarStripGrouping } from "./sidebar-customized"
import {
  createPinnedSessions,
  createSessionPins,
  PinMuteMenuItems,
  SidebarSectionLabel,
  type SessionPins,
} from "./sidebar-pins"
import { isSidebarSessionActivity, mergeSidebarSessions } from "./sidebar-sessions"

const SidebarState = Persistence.struct({
  projectsCollapsed: Schema.Boolean,
  collapsedServers: Persistence.record(Schema.Boolean),
  expanded: Persistence.record(Schema.Boolean),
  order: Persistence.record(Schema.mutable(Schema.Array(Schema.String))),
})

/** Tracks session activity on every server, and keeps a preview tab once its session does something. */
export function createSidebarActivityListener() {
  const tabs = useTabs()

  const global = useGlobal()

  // Keep a preview tab once its session shows activity. Ordering comes from the shared data layer, so this listener
  // only decides when a preview has become worth keeping.
  createEffect(() => {
    global.servers.list().forEach((conn) => {
      const server = ServerConnection.key(conn)
      const ctx = global.serverCtx(server)

      if (!ctx) return
      onCleanup(
        ctx.data.listen(({ details }) => {
          if (!isSidebarSessionActivity(details)) return
          const sessionID = details.data.sessionID
          const preview = tabs.preview()

          if (
            preview?.server === server &&
            (preview.sessionId === sessionID || preview.sessionId === ctx.data.session.root(sessionID))
          )
            tabs.keepPreview()
        }),
      )
    })
  })
}

export function SidebarOrganized(props: {
  currentTab: Tab | undefined
  children: (highlightActive: Accessor<boolean>, onNavigate: () => void, grouping: SidebarStripGrouping) => JSX.Element
}) {
  const language = useLanguage()

  const global = useGlobal()

  const tabs = useTabs()

  const servers = useServers()

  const layout = useLayout()

  const projectNavigation = useProjectNavigation()

  const browse = useProjectBrowser()

  const connections = createMemo(() => {
    if (projectNavigation()) return servers.visible
    const server = props.currentTab?.server ?? layout.home.selection().server

    const connection = servers.visible.find((conn) => ServerConnection.key(conn) === server) ?? servers.visible[0]

    return connection ? [connection] : []
  })

  const grouped = () => connections().length > 1

  const pickDirectory = useDirectoryPicker()

  const addTarget = () => {
    const server = props.currentTab?.server ?? layout.home.selection().server

    return connections().find((conn) => ServerConnection.key(conn) === server) ?? connections()[0]
  }

  const addProject = (conn: ServerConnection.Any) =>
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const ctx = global.serverCtx(ServerConnection.key(conn))

        if (ctx) void addProjects(ctx, homeProjectDirectories(result))
      },
    })

  createSidebarActivityListener()

  const [local, setLocal] = createStore<{
    projectSession: { server: ServerConnection.Key; sessionId: string } | undefined
    thumbTrack: HTMLDivElement | undefined
    hoverTarget: HTMLDivElement | undefined
  }>({ projectSession: undefined, thumbTrack: undefined, hoverTarget: undefined })

  const selectTabs = () => setLocal("projectSession", undefined)

  const projectSelected = () => {
    const tab = props.currentTab

    return (
      tab?.type === "session" &&
      tab.server === local.projectSession?.server &&
      tab.sessionId === local.projectSession?.sessionId
    )
  }

  const [state, setState, , ready] = persisted(Persist.global("sidebar.organize"), SidebarState, {
    projectsCollapsed: false,
    collapsedServers: {},
    expanded: {},
    order: {},
  })

  const isOpenTab = (server: ServerConnection.Key, sessionId: string) =>
    tabs.store.some((tab) => tab.type === "session" && tab.server === server && tab.sessionId === sessionId)

  const pins = createSessionPins()

  const pinned = createPinnedSessions({
    pins,
    currentTab: () => props.currentTab,
    highlightActive: () => !projectSelected(),
    onSelect: selectTabs,
  })

  // Pinned sessions leave the tab list, which keeps the rest of the open tabs under Recent.
  const recentTabs = createMemo(() => tabs.store.filter((tab) => !pinned.holds(tab)))

  const recentHeader = (
    <Show when={recentTabs().length > 0}>
      <SidebarSectionLabel label={language.t("sidebar.recent.section.recent")} class="mb-px" />
    </Show>
  )

  const sections = createMemo(() => [{ key: "recent", tabs: recentTabs(), header: recentHeader }])

  const leading = createMemo(() => pinned.leading())

  const grouping: SidebarStripGrouping = {
    get sections() {
      return sections()
    },
    get leading() {
      return leading()
    },
    tabMenu: (tab) => <PinMuteMenuItems pins={pins} server={tab.server} sessionID={tab.sessionId} />,
    tabMuted: (tab) => global.sessionPreferences.muted(tab.server, tab.sessionId),
  }

  return (
    <div
      ref={(element) => setLocal("hoverTarget", element)}
      class="relative flex min-h-0 flex-1 flex-col [app-region:no-drag]"
    >
      <div
        ref={(element) => setLocal("thumbTrack", element)}
        class="pointer-events-none absolute inset-y-0 z-10 w-3"
        style={{
          "inset-inline-end": "calc(-1 * (var(--sidebar-inset-end, 3px) + var(--shell-inline-inset, 8px)))",
        }}
      />
      <ScrollView class="min-h-0 flex-1" thumbContainer={local.thumbTrack} thumbHoverTarget={local.hoverTarget}>
        <div class="flex flex-col gap-2">
          <section class="flex shrink-0 flex-col gap-1">
            <div class="group/projects flex h-7 min-w-0 shrink-0 items-center rounded-[6px] pe-1 hover:bg-v2-overlay-simple-overlay-hover has-[:focus-visible]:bg-v2-overlay-simple-overlay-hover">
              <button
                type="button"
                class="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-2 text-start text-[13px] leading-[var(--line-height-compact)] font-medium text-v2-text-text-muted group-hover/projects:text-v2-text-text-base focus-visible:text-v2-text-text-base focus-visible:outline-none"
                aria-expanded={!state.projectsCollapsed}
                onClick={() => setState("projectsCollapsed", (value) => !value)}
              >
                <span class="min-w-0 truncate">{language.t("sidebar.organize.projects")}</span>
                <Icon
                  name="fill-triangle-down"
                  class="shrink-0 text-v2-icon-icon-muted transition-transform motion-reduce:transition-none"
                  classList={{ "-rotate-90 rtl:rotate-90": state.projectsCollapsed }}
                />
              </button>
              <Show when={addTarget()}>
                {(conn) => (
                  <span class="hover-reveal flex shrink-0 items-center group-hover/projects:opacity-100 focus-within:opacity-100">
                    <IconButton
                      icon={<Icon name="folder-add-left" />}
                      variant="ghost-muted"
                      size="small"
                      aria-label={language.t("home.project.add")}
                      onClick={() => addProject(conn())}
                    />
                  </span>
                )}
              </Show>
            </div>
            <Show when={!state.projectsCollapsed}>
              <Key each={connections()} by={ServerConnection.key}>
                {(conn) => {
                  const key = ServerConnection.key(conn())

                  const expanded = () => !state.collapsedServers[key]

                  return (
                    <div
                      role={grouped() ? "group" : undefined}
                      aria-label={grouped() ? servers.label(conn()) : undefined}
                      class="flex min-w-0 flex-col gap-1"
                    >
                      <Show when={grouped()}>
                        <button
                          type="button"
                          class="flex h-6 min-w-0 items-center gap-1.5 rounded-[6px] px-2 text-start text-12-regular text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover"
                          aria-expanded={expanded()}
                          onClick={() => setState("collapsedServers", key, (collapsed) => !collapsed)}
                        >
                          <Icon
                            name="fill-triangle-down"
                            class="shrink-0 text-v2-icon-icon-muted"
                            classList={{ "-rotate-90 rtl:rotate-90": !expanded() }}
                          />
                          <ServerLabel server={conn()} />
                        </button>
                      </Show>
                      <Show when={!grouped() || expanded()}>
                        <div class="flex min-w-0 flex-col gap-1" classList={{ "ps-3": grouped() }}>
                          <ProjectList
                            connection={conn()}
                            grouped={grouped()}
                            onViewHistory={projectNavigation() ? browse : undefined}
                            currentTab={props.currentTab}
                            isOpenTab={isOpenTab}
                            highlightActive={projectSelected()}
                            onSelect={(session) => setLocal("projectSession", session)}
                            state={state}
                            pins={pins}
                            ready={ready()}
                            onExpand={(key) => setState("expanded", key, (value) => !value)}
                            onReorder={(server, ids) => setState("order", server, ids)}
                          />
                        </div>
                      </Show>
                    </div>
                  )
                }}
              </Key>
            </Show>
          </section>
          <div class="flex shrink-0 flex-col" classList={{ hidden: tabs.store.length === 0 && pinned.count() === 0 }}>
            {/* The empty strip still owns tab shortcuts; only its visual section is hidden. */}
            {props.children(() => !projectSelected(), selectTabs, grouping)}
          </div>
        </div>
      </ScrollView>
    </div>
  )
}

function ProjectList(props: {
  connection: ServerConnection.Any
  grouped: boolean
  onViewHistory?: (target: ProjectBrowserTarget) => void
  currentTab: Tab | undefined
  isOpenTab: (server: ServerConnection.Key, sessionId: string) => boolean
  highlightActive: boolean
  onSelect: (session: { server: ServerConnection.Key; sessionId: string }) => void
  state: typeof SidebarState.Type
  pins: SessionPins
  ready: boolean
  onExpand: (key: string) => void
  onReorder: (server: string, ids: string[]) => void
}) {
  const language = useLanguage()

  const servers = useServers()

  const actions = createProjectSessionActions()

  const projectActions = createProjectActions()

  const [local, setLocal] = createStore<{ showAll: boolean; sessionLimits: Record<string, number> }>({
    showAll: false,
    sessionLimits: {},
  })

  const server = ServerConnection.key(props.connection)

  const global = useGlobal()

  const ctx = useServerCtx(() => props.connection)

  const projects = createMemo(() => {
    const list = ctx()?.projects.used() ?? []

    const order = props.state.order[server] ?? []

    return [
      ...order.flatMap((id) => list.find((project) => project.id === id) ?? []),
      ...list.filter((project) => !order.includes(project.id)),
    ]
  })

  const visible = () => (local.showAll ? projects() : projects().slice(0, 7))

  // Freeze the initial order, then append newly used projects instead of following last activity.
  createEffect(() => {
    if (!props.ready || !servers.hydrated() || !ctx()?.sync.project.ready()) return
    const ids = projects().map((project) => project.id)

    const saved = props.state.order[server] ?? []

    if (ids.length === saved.length && ids.every((id, index) => id === saved[index])) return
    untrack(() => props.onReorder(server, ids))
  })

  const sessions = useQuery(() => ({
    ...homeSessionsQuery(props.connection, ctx()),
    enabled:
      ctx()?.sdk.connection.status() === "connected" &&
      (!props.grouped || visible().some((project) => props.state.expanded[`${server}:${project.id}`])),
  }))

  const records = createMemo(() => {
    const current = ctx()

    if (!current) return []

    return buildHomeSessionRecords({
      sessions: () =>
        current.data.session.apply(
          mergeSidebarSessions(sessions.isPending ? [] : (sessions.data?.() ?? []), current.data.session.known()),
        ),
      projects,
      projectDirectories: () => undefined,
      resolveProject: current.projects.forSession,
    })
  })

  const grouped = createMemo(() => Map.groupBy(records(), (record) => pathKey(record.project.worktree)))

  return (
    <>
      <DragDropProvider
        sensors={[
          PointerSensor.configure({
            activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
            preventActivation: (event) =>
              event.target instanceof Element && !!event.target.closest("[data-project-action]"),
          }),
        ]}
        modifiers={[RestrictToVerticalAxis]}
        plugins={(defaults) => [
          ...defaults.filter((plugin) => plugin !== Accessibility),
          Feedback.configure({ dropAnimation: null }),
        ]}
        onDragEnd={(event) => {
          const source = event.operation.source

          if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return
          props.onReorder(
            server,
            arrayMove(
              projects().map((project) => project.id),
              source.initialIndex,
              source.index,
            ),
          )
        }}
      >
        <Key each={visible()} by={(project) => project.id}>
          {(project, index) => {
            const key = () => `${server}:${project().id}`

            const projectSessions = () => grouped().get(pathKey(project().worktree)) ?? []

            const limit = () => local.sessionLimits[key()] ?? 5

            return (
              <ProjectRow
                project={project()}
                server={props.connection}
                onViewHistory={props.onViewHistory}
                actions={projectActions}
                index={index()}
                expanded={!!props.state.expanded[key()]}
                onToggle={() => {
                  if (props.state.expanded[key()]) setLocal("sessionLimits", key(), 5)
                  props.onExpand(key())
                }}
              >
                <Key
                  each={projectSessions().slice(0, limit())}
                  by={(record) => record.session.id}
                  fallback={
                    <div class="ps-8 pe-2 py-2 text-12-regular text-v2-text-text-faint">
                      {language.t("sidebar.organize.empty")}
                    </div>
                  }
                >
                  {(record) => (
                    <ProjectSessionRow
                      server={server}
                      session={record().session}
                      openTab={props.isOpenTab(server, record().session.id)}
                      muted={global.sessionPreferences.muted(server, record().session.id)}
                      menuItems={() => (
                        <PinMuteMenuItems pins={props.pins} server={server} sessionID={record().session.id} />
                      )}
                      active={
                        props.highlightActive &&
                        props.currentTab?.type === "session" &&
                        props.currentTab.server === server &&
                        props.currentTab.sessionId === record().session.id
                      }
                      onOpen={() => {
                        props.onSelect({
                          server,
                          sessionId: record().session.id,
                        })
                        actions.openProjectSession(props.connection, project().worktree, record().session, {
                          preview: true,
                        })
                      }}
                    />
                  )}
                </Key>
                <Show when={projectSessions().length > limit()}>
                  <Button
                    variant="ghost-muted"
                    size="small"
                    class="ms-[23px] self-start"
                    onClick={() => setLocal("sessionLimits", key(), (value) => (value ?? 5) + 5)}
                  >
                    {language.t("sidebar.organize.showMore")}
                  </Button>
                </Show>
              </ProjectRow>
            )
          }}
        </Key>
      </DragDropProvider>
      <Show when={props.grouped && ctx()?.sync.project.ready() && !projects().length}>
        <span class="px-2 text-12-regular text-v2-text-text-faint">{language.t("settings.projects.empty.title")}</span>
      </Show>
      <Show when={projects().length > 7}>
        <Button
          variant="ghost-muted"
          size="small"
          class="ms-[23px] self-start"
          onClick={() => setLocal("showAll", (value) => !value)}
        >
          {language.t(local.showAll ? "sidebar.organize.showLess" : "sidebar.organize.showMore")}
        </Button>
      </Show>
    </>
  )
}

function ProjectRow(props: {
  onViewHistory?: (target: ProjectBrowserTarget) => void
  project: Project
  server: ServerConnection.Any
  actions: ReturnType<typeof createProjectActions>
  index: number
  expanded: boolean
  onToggle: () => void
  children: JSX.Element
}) {
  const language = useLanguage()

  const [menu, setMenu] = createStore({ open: false })

  const sortable = useSortable({
    get id() {
      return props.project.id
    },
    get index() {
      return props.index
    },
  })

  return (
    <div ref={sortable.ref} class="relative shrink-0">
      <div
        class="group/project relative flex h-7 min-w-0 shrink-0 items-center rounded-[6px] pe-1 hover:bg-v2-overlay-simple-overlay-hover has-[:focus-visible]:bg-v2-overlay-simple-overlay-hover"
        onContextMenu={(event) => {
          event.preventDefault()
          setMenu("open", true)
        }}
        onKeyDown={(event) => {
          if (event.key !== "ContextMenu" && (event.key !== "F10" || !event.shiftKey)) return
          event.preventDefault()
          setMenu("open", true)
        }}
      >
        <button
          type="button"
          class="flex h-full min-w-0 flex-1 shrink-0 cursor-default items-center gap-2 rounded-[6px] bg-transparent px-2 text-start text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted [font-weight:440] transition-colors duration-[120ms] ease-in-out group-hover/project:text-v2-text-text-base focus-visible:text-v2-text-text-base focus-visible:outline-none"
          aria-expanded={props.expanded}
          onClick={props.onToggle}
        >
          <span class="flex size-4 shrink-0 items-center justify-center">
            <ProjectIcon project={props.project} />
          </span>
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap" dir="auto">
            {displayName(props.project)}
          </span>
        </button>
        <span
          data-project-action
          data-menu={menu.open}
          class="hover-reveal flex shrink-0 items-center gap-1 group-hover/project:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100"
        >
          <Menu
            gutter={6}
            modal={false}
            placement="bottom-end"
            open={menu.open}
            onOpenChange={(open) => setMenu("open", open)}
          >
            <Menu.Trigger
              as={IconButton}
              variant="ghost-muted"
              size="small"
              icon={<Icon name="outline-dots" />}
              aria-label={language.t("common.moreOptions")}
            />
            <Menu.Portal>
              <Menu.Content>
                <ProjectMenuItems
                  server={props.server}
                  project={props.project}
                  unread={props.actions.hasUnread(props.server, props.project)}
                  canImportSession={props.actions.canImportSession}
                  importingSession={props.actions.importingSession()}
                  canRevealProject={props.actions.canReveal}
                  onOpenProjectNewSession={props.actions.openNewSession}
                  onViewHistory={props.onViewHistory}
                  onImportSession={props.actions.importSession}
                  onEditProject={props.actions.edit}
                  onRevealProject={props.actions.reveal}
                  onClearNotifications={props.actions.clearNotifications}
                  onHideProject={props.actions.hide}
                />
              </Menu.Content>
            </Menu.Portal>
          </Menu>
          <IconButton
            icon={<Icon name="edit" />}
            variant="ghost-muted"
            size="small"
            aria-label={language.t("command.session.new")}
            onClick={() => props.actions.openNewSession(props.server, props.project.worktree)}
          />
        </span>
      </div>
      <Show when={props.expanded}>
        <div data-project-action class="flex flex-col gap-[3px] pb-1">
          {props.children}
        </div>
      </Show>
    </div>
  )
}
