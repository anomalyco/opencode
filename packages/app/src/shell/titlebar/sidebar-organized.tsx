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
import { useLayout } from "@/shell/state/layout"
import { createProjectSessionActions } from "@/shell/tabs/project-sessions"
import { useTabs, type Tab } from "@/shell/tabs/tabs"
import { pathKey } from "@/workspaces/path-key"
import "./tab-nav.css"
import { ProjectSessionRow } from "./project-session-row"
import { createSidebarSessionActivity, mergeSidebarSessions } from "./sidebar-sessions"

const SidebarState = Persistence.struct({
  projectsCollapsed: Schema.Boolean,
  expanded: Persistence.record(Schema.Boolean),
  order: Persistence.record(Schema.mutable(Schema.Array(Schema.String))),
})

export function SidebarOrganized(props: {
  currentTab: Tab | undefined
  children: (highlightActive: Accessor<boolean>, onNavigate: () => void) => JSX.Element
}) {
  const language = useLanguage()

  const tabs = useTabs()

  const global = useGlobal()

  const activity = createSidebarSessionActivity()

  createEffect(() => {
    global.servers.list().forEach((conn) => {
      const server = ServerConnection.key(conn)

      const ctx = global.serverCtx(server)

      if (!ctx) return
      onCleanup(
        ctx.data.listen(({ details: event }) => {
          const updated = activity.update(server, event)

          if (!updated) return
          const preview = tabs.preview()

          if (
            preview?.server === server &&
            (preview.sessionId === updated.data.sessionID ||
              preview.sessionId === ctx.data.session.root(updated.data.sessionID))
          )
            tabs.keepPreview()
        }),
      )
    })
  })

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
    expanded: {},
    order: {},
  })

  const isOpenTab = (server: ServerConnection.Key, sessionId: string) =>
    tabs.store.some((tab) => tab.type === "session" && tab.server === server && tab.sessionId === sessionId)

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
        <div class="flex flex-col gap-3">
          <section class="flex shrink-0 flex-col gap-2">
            <button
              type="button"
              class="flex h-6 w-full shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-start text-[13px] leading-4 font-medium text-v2-text-text-muted hover:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
              aria-expanded={!state.projectsCollapsed}
              onClick={() => setState("projectsCollapsed", (value) => !value)}
            >
              <span class="min-w-0 truncate">{language.t("sidebar.organize.projects")}</span>
              <Icon
                name="fill-triangle-down"
                size="small"
                class="shrink-0 text-v2-icon-icon-muted transition-transform"
                classList={{ "-rotate-90 rtl:rotate-90": state.projectsCollapsed }}
              />
            </button>
            <Show when={!state.projectsCollapsed}>
              <div class="flex min-w-0 flex-col gap-1">
                <ProjectList
                  currentTab={props.currentTab}
                  lastActivity={activity.get}
                  isOpenTab={isOpenTab}
                  highlightActive={projectSelected()}
                  onSelect={(session) => setLocal("projectSession", session)}
                  state={state}
                  ready={ready()}
                  onExpand={(key) => setState("expanded", key, (value) => !value)}
                  onReorder={(server, ids) => setState("order", server, ids)}
                />
              </div>
            </Show>
          </section>
          <div class="flex shrink-0 flex-col gap-3" classList={{ hidden: tabs.store.length === 0 }}>
            <Show when={!state.projectsCollapsed}>
              <div role="separator" class="mx-2 h-px shrink-0 bg-v2-border-border-muted" />
            </Show>
            {/* The empty strip still owns tab shortcuts; only its visual section is hidden. */}
            {props.children(() => !projectSelected(), selectTabs)}
          </div>
        </div>
      </ScrollView>
    </div>
  )
}

function ProjectList(props: {
  currentTab: Tab | undefined
  lastActivity: (server: ServerConnection.Key, sessionId: string) => number | undefined
  isOpenTab: (server: ServerConnection.Key, sessionId: string) => boolean
  highlightActive: boolean
  onSelect: (session: { server: ServerConnection.Key; sessionId: string }) => void
  state: typeof SidebarState.Type
  ready: boolean
  onExpand: (key: string) => void
  onReorder: (server: string, ids: string[]) => void
}) {
  const language = useLanguage()

  const servers = useServers()

  const layout = useLayout()

  const actions = createProjectSessionActions()

  const projectActions = createProjectActions()

  const [local, setLocal] = createStore<{ showAll: boolean; sessionLimits: Record<string, number> }>({
    showAll: false,
    sessionLimits: {},
  })

  const connection = createMemo(
    () =>
      servers.visible.find(
        (conn) => ServerConnection.key(conn) === (props.currentTab?.server ?? layout.home.selection().server),
      ) ?? servers.visible[0],
  )

  const ctx = useServerCtx(connection)

  const server = () => {
    const conn = connection()

    return conn ? ServerConnection.key(conn) : undefined
  }

  const projects = createMemo(() => {
    const list = ctx()?.projects.used() ?? []

    const order = props.state.order[server() ?? ""] ?? []

    return [
      ...order.flatMap((id) => list.find((project) => project.id === id) ?? []),
      ...list.filter((project) => !order.includes(project.id)),
    ]
  })

  const visible = () => (local.showAll ? projects() : projects().slice(0, 7))

  // Freeze the initial order, then append newly used projects instead of following last activity.
  createEffect(() => {
    const key = server()

    if (!props.ready || !servers.hydrated() || !key || !ctx()?.sync.project.ready()) return
    const ids = projects().map((project) => project.id)

    const saved = props.state.order[key] ?? []

    if (ids.length === saved.length && ids.every((id, index) => id === saved[index])) return
    untrack(() => props.onReorder(key, ids))
  })

  const sessions = useQuery(() => ({
    ...homeSessionsQuery(connection(), ctx()),
    enabled: ctx()?.sdk.connection.status() === "connected",
  }))

  const records = createMemo(() => {
    const current = ctx()

    if (!current) return []

    return buildHomeSessionRecords({
      sessions: () =>
        current.data.session.apply(
          mergeSidebarSessions(sessions.isPending ? [] : (sessions.data?.() ?? []), current.data.session.list(), (id) =>
            props.lastActivity(ServerConnection.key(current.sdk.server), id),
          ),
          { activity: false },
        ),
      projects,
      projectDirectories: () => undefined,
      resolveProject: current.projects.forSession,
    })
  })

  const grouped = createMemo(() => Map.groupBy(records(), (record) => pathKey(record.project.worktree)))

  return (
    <>
      <Show when={connection()}>
        {(conn) => (
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
                ServerConnection.key(conn()),
                arrayMove(
                  projects().map((project) => project.id),
                  source.initialIndex,
                  source.index,
                ),
              )
            }}
          >
            <Key each={visible()} by={(project) => `${ServerConnection.key(conn())}:${project.id}`}>
              {(project, index) => {
                const key = () => `${server()}:${project().id}`

                const projectSessions = () => grouped().get(pathKey(project().worktree)) ?? []

                const limit = () => local.sessionLimits[key()] ?? 5

                return (
                  <ProjectRow
                    project={project()}
                    server={conn()}
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
                          server={ServerConnection.key(conn())}
                          session={record().session}
                          openTab={props.isOpenTab(ServerConnection.key(conn()), record().session.id)}
                          active={
                            props.highlightActive &&
                            props.currentTab?.type === "session" &&
                            props.currentTab.server === ServerConnection.key(conn()) &&
                            props.currentTab.sessionId === record().session.id
                          }
                          onOpen={() => {
                            props.onSelect({
                              server: ServerConnection.key(conn()),
                              sessionId: record().session.id,
                            })
                            actions.openProjectSession(conn(), project().worktree, record().session, { preview: true })
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
        )}
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
                  canRevealProject={props.actions.canReveal}
                  onOpenProjectNewSession={props.actions.openNewSession}
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
