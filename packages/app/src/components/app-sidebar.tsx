import type { Session } from "@opencode-ai/sdk/v2/client"
import { useLocation, useNavigate } from "@solidjs/router"
import { useQuery } from "@tanstack/solid-query"
import { createEffect, createMemo, For, Show, startTransition, type Accessor, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Logo, Mark } from "@opencode-ai/ui/logo"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useSettingsCommand } from "@/components/settings-dialog"
import { useCommand } from "@/context/command"
import { useGlobal } from "@/context/global"
import {
  loadHomeSessionIndex,
  retainHomeSessions,
  type HomeSessionEvents,
} from "@/context/global-sync/home-session-index"
import { getProjectAvatarVariant, useLayout, type HomeProjectSelection, type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { usePlatform } from "@/context/platform"
import { ServerConnection, useServer } from "@/context/server"
import { sessionHasOpenTab, useTabs } from "@/context/tabs"
import { shouldOpenSessionInBackground } from "@/pages/home-session-open"
import {
  buildHomeSessionRecords,
  HomeSessionStatusController,
  type OpenSessionOptions,
} from "@/pages/home/home-sessions-controller"
import {
  displayName,
  getProjectAvatarSource,
  projectForSession,
  toggleHomeProjectSelection,
} from "@/pages/layout/helpers"
import { SessionTabAvatarView } from "@/pages/layout/session-tab-avatar"
import { sessionTitle } from "@/utils/session-title"
import { sidebarSessionIdFromPath } from "@/utils/sidebar-route"
import { pathKey } from "@/utils/path-key"
import { Persist, persisted } from "@/utils/persist"

const SIDEBAR_SESSION_LIMIT = 40

function isBackgroundOpen(event: MouseEvent) {
  return shouldOpenSessionInBackground({
    button: event.button,
    mac: typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform),
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  })
}

function projectDirectories(project: LocalProject) {
  return [project.worktree, ...(project.sandboxes ?? [])]
}

export function AppSidebar() {
  const tabs = useTabs()
  const layout = useLayout()
  const global = useGlobal()
  const server = useServer()
  const language = useLanguage()
  const notification = useNotification()
  const platform = usePlatform()
  const location = useLocation()
  const navigate = useNavigate()
  const command = useCommand()
  const dialog = useDialog()
  const openSettings = useSettingsCommand()
  const [state, setState] = persisted(Persist.window("app.sidebar"), createStore({ collapsed: false }))
  // Native macOS traffic lights overlay the top-left when the titlebar is
  // hidden, so clear them with extra top padding on desktop macOS.
  const trafficLights = () => platform.platform === "desktop" && platform.os === "macos"

  const selection = layout.home.selection
  const focusedConn = createMemo(
    () => global.servers.list().find((conn) => ServerConnection.key(conn) === selection().server) ?? server.current,
  )
  const focusedCtx = createMemo(() => {
    const conn = focusedConn()
    if (!conn) return undefined
    return global.ensureServerCtx(conn)
  })
  const projects = createMemo(() => focusedCtx()?.projects.list() ?? layout.projects.list())
  const selectedProject = createMemo(() => projects().find((project) => project.worktree === selection().directory))
  const servers = global.servers.list
  const multiServer = createMemo(() => servers().length > 1)

  const homeSessions = () => focusedCtx()?.sync.homeSessions
  const sessionEventLoad = useQuery(() => ({
    queryKey: homeSessions()?.eventsKey ?? ["app-sidebar", "session-events"],
    queryFn: async (): Promise<HomeSessionEvents> => ({ sequence: 0, entries: [] }),
    initialData: { sequence: 0, entries: [] } satisfies HomeSessionEvents,
    enabled: false,
  }))
  const sessionLoad = useQuery(() => ({
    queryKey: homeSessions()?.indexKey ?? ["app-sidebar", "session-index"],
    enabled: !!focusedCtx(),
    queryFn: async ({ signal }) => {
      const ctx = focusedCtx()
      const cache = homeSessions()
      if (!ctx || !cache) return { sessions: [], eventSequence: 0 }
      const eventSequence = cache.eventSequence()
      const index = await loadHomeSessionIndex(
        (input, options) => ctx.sdk.client.v2.session.list(input, options),
        eventSequence,
        signal,
      )
      cache.complete(eventSequence)
      return index
    },
    retry: false,
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnReconnect: true,
  }))

  const projectDirs = createMemo(() => {
    const selected = selectedProject()
    if (selected) return projectDirectories(selected)
    return projects().flatMap(projectDirectories)
  })
  const projectByID = createMemo(
    () => new Map(projects().flatMap((project) => (project.id ? [[project.id, project] as const] : []))),
  )
  const indexedSessions = createMemo(() => {
    const cache = homeSessions()
    if (!cache) return []
    return retainHomeSessions(
      cache.sessions(sessionLoad.data, sessionEventLoad.data),
      SIDEBAR_SESSION_LIMIT,
      Date.now(),
    )
  })
  const records = createMemo(() =>
    buildHomeSessionRecords({
      sessions: indexedSessions,
      projectDirectories: projectDirs,
      projects,
      projectByID,
    }).slice(0, SIDEBAR_SESSION_LIMIT),
  )

  const activeSessionId = createMemo(() => sidebarSessionIdFromPath(location.pathname))
  const serverKey = createMemo(() => {
    const conn = focusedConn()
    return conn ? ServerConnection.key(conn) : selection().server
  })

  const openSession = (session: Session, options?: OpenSessionOptions) => {
    const directoryKey = pathKey(session.directory)
    const project =
      projects().find(
        (item) =>
          pathKey(item.worktree) === directoryKey ||
          item.sandboxes?.some((sandbox) => pathKey(sandbox) === directoryKey),
      ) ?? projectForSession(session, projects(), projectByID())
    const conn = focusedConn()
    const ctx = focusedCtx()
    if (!conn || !ctx) return
    const directory = project?.worktree ?? session.directory
    ctx.projects.open(directory)
    if (options?.background) {
      tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })
      return
    }
    ctx.projects.touch(directory)
    void startTransition(() => {
      const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })
      tabs.select(tab)
    })
  }

  const openProjectNewSession = (conn: ServerConnection.Any, directory: string) => {
    const ctx = global.ensureServerCtx(conn)
    ctx.projects.open(directory)
    ctx.projects.touch(directory)
    void tabs.newDraft({ server: ServerConnection.key(conn), directory })
  }

  const newChatTarget = createMemo(() => {
    const conn = focusedConn()
    if (!conn) return undefined
    const list = projects()
    const target =
      selectedProject() ??
      list.find((project) => project.worktree === focusedCtx()?.projects.last()) ??
      list[0]
    if (!target) return undefined
    return { conn, directory: target.worktree }
  })

  const openNewChat = () => {
    const target = newChatTarget()
    if (!target) return
    openProjectNewSession(target.conn, target.directory)
  }

  const goHome = () => {
    if (location.pathname !== "/") navigate("/")
  }

  const openSearch = () => {
    goHome()
    // The home route registers the focus command on mount; retry in case it
    // is not registered yet. Unknown ids are a safe no-op.
    const trigger = () => command.trigger("home.sessions.search.focus")
    setTimeout(trigger, 120)
    setTimeout(trigger, 600)
  }

  const openMe = () => {
    void dialog.show(() => <MeDialog onHome={goHome} onSettings={openSettings} />)
  }

  let started = false
  createEffect(() => {
    if (started || !tabs.ready() || location.pathname !== "/") return
    if (tabs.store.length > 0) {
      started = true
      const last = tabs.store[tabs.store.length - 1]
      if (last) tabs.select(last)
      return
    }
    if (!newChatTarget()) return
    started = true
    openNewChat()
  })

  const selectProject = (conn: ServerConnection.Any, directory: string) => {
    const key = ServerConnection.key(conn)
    if (global.servers.health[key]?.healthy === false) return
    if (!global.ensureServerCtx(conn).projects.list().some((project) => project.worktree === directory)) return
    layout.home.setSelection(toggleHomeProjectSelection(selection(), key, directory))
    if (location.pathname !== "/") navigate("/")
  }

  const unseenCount = (conn: ServerConnection.Any, project: LocalProject) => {
    const state = notification.ensureServerState(ServerConnection.key(conn))
    return projectDirectories(project).reduce((total, directory) => total + state.project.unseenCount(directory), 0)
  }

  return (
    <Show
      when={!state.collapsed}
      fallback={
        <aside
          data-component="app-sidebar"
          data-collapsed="true"
          class="hidden shrink-0 flex-col items-center gap-1 bg-v2-background-bg-base/70 py-2 backdrop-blur-xl lg:flex"
          classList={{ "w-14": !trafficLights(), "w-24": trafficLights() }}
          style={trafficLights() ? { "padding-top": "36px" } : undefined}
        >
          <TooltipV2 placement="right" value={language.t("home.title")}>
            <button
              type="button"
              data-action="sidebar-home"
              class="flex size-9 shrink-0 items-center justify-center rounded-[6px] transition-[background-color] duration-[120ms] ease-in-out hover:bg-v2-background-bg-layer-01"
              aria-label={language.t("home.title")}
              onClick={goHome}
            >
              <Mark class="h-5 w-auto" />
            </button>
          </TooltipV2>
          <TooltipV2 placement="right" value={language.t("command.session.new")}>
            <IconButtonV2
              variant="ghost-muted"
              size="large"
              icon={<IconV2 name="edit" />}
              aria-label={language.t("command.session.new")}
              disabled={!newChatTarget()}
              onClick={openNewChat}
            />
          </TooltipV2>
          <TooltipV2 placement="right" value="Me">
            <IconButtonV2
              variant="ghost-muted"
              size="large"
              icon={<IconV2 name="settings-gear" />}
              aria-label="Me"
              onClick={openMe}
            />
          </TooltipV2>
          <div class="mt-auto">
            <TooltipV2 placement="right" value={language.t("sidebar.menu.toggle")}>
              <IconButtonV2
                variant="ghost-muted"
                size="large"
                icon={<IconV2 name="chevron-down" size="small" style={{ transform: "rotate(-90deg)" }} />}
                aria-label={language.t("sidebar.menu.toggle")}
                onClick={() => setState("collapsed", false)}
              />
            </TooltipV2>
          </div>
        </aside>
      }
    >
      <aside
        data-component="app-sidebar"
        class="hidden w-64 shrink-0 flex-col bg-v2-background-bg-base/70 backdrop-blur-xl lg:flex"
        aria-label={language.t("sidebar.nav.projectsAndSessions")}
      >
        <div class="flex h-9 shrink-0 items-center justify-end px-2">
          <TooltipV2 placement="bottom" value={language.t("sidebar.menu.toggle")}>
            <IconButtonV2
              variant="ghost-muted"
              size="large"
              icon={<IconV2 name="chevron-down" size="small" style={{ transform: "rotate(90deg)" }} />}
              aria-label={language.t("sidebar.menu.toggle")}
              onClick={() => setState("collapsed", true)}
            />
          </TooltipV2>
        </div>
        <div
          class="flex shrink-0 items-center px-3 pb-3 pt-1"
        >
          <button
            type="button"
            data-action="sidebar-home"
            onClick={goHome}
            class="flex min-w-0 items-center rounded-[6px] px-1.5 py-2 focus-visible:bg-v2-background-bg-layer-01 focus-visible:outline-none"
            aria-label={language.t("home.title")}
          >
            <Logo class="h-5 w-auto" />
          </button>
        </div>
        <div class="shrink-0 px-2 pb-1">
          <SidebarNavButton data-action="sidebar-new-chat" onClick={openNewChat} disabled={!newChatTarget()}>
            <IconV2 name="edit" size="small" />
            <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {language.t("command.session.new")}
            </span>
          </SidebarNavButton>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-2">
          <section class="flex min-w-0 flex-col gap-1" aria-label={language.t("home.projects")}>
            <div class="flex h-7 min-w-0 shrink-0 items-center px-1.5">
              <div class="text-v2-text-text-muted [font-weight:530]">{language.t("home.projects")}</div>
            </div>
            <Show
              when={projects().length > 0}
              fallback={
                <div class="px-1.5 py-1 text-v2-text-text-faint [font-weight:440]">
                  {language.t("sidebar.projects.empty")}
                </div>
              }
            >
              <Show
                when={!multiServer()}
                fallback={
                  <For each={servers()}>
                    {(conn) => (
                      <SidebarServerProjects
                        conn={conn}
                        projects={projects().filter(
                          (project) =>
                            global.ensureServerCtx(conn).projects.list().some((item) => item.worktree === project.worktree),
                        )}
                        selection={selection}
                        language={language}
                        unseenCount={unseenCount}
                        onSelectProject={selectProject}
                        onOpenProjectNewSession={openProjectNewSession}
                      />
                    )}
                  </For>
                }
              >
                <For each={projects()}>
                  {(project) => (
                    <SidebarProjectRow
                      project={project}
                      conn={focusedConn()}
                      selected={selection().directory === project.worktree}
                      language={language}
                      unseenCount={unseenCount}
                      onSelectProject={selectProject}
                      onOpenProjectNewSession={openProjectNewSession}
                    />
                  )}
                </For>
              </Show>
            </Show>
          </section>
          <section class="flex min-w-0 flex-col gap-1" aria-label={language.t("sidebar.project.recentSessions")}>
            <div class="flex h-7 min-w-0 shrink-0 items-center justify-between px-1.5">
              <div class="text-v2-text-text-muted [font-weight:530]">
                {language.t("sidebar.project.recentSessions")}
              </div>
              <TooltipV2 placement="bottom" value={language.t("home.sessions.search.placeholder")}>
                <IconButtonV2
                  data-action="sidebar-search-sessions"
                  variant="ghost-muted"
                  size="small"
                  icon={<IconV2 name="magnifying-glass" />}
                  aria-label={language.t("home.sessions.search.placeholder")}
                  onClick={openSearch}
                />
              </TooltipV2>
            </div>
            <Show
              when={records().length > 0}
              fallback={
                <div class="px-1.5 py-1 text-v2-text-text-faint [font-weight:440]">
                  {language.t("home.sessions.empty")}
                </div>
              }
            >
              <For each={records()}>
                {(record) => (
                  <div class="group/session relative flex h-8 min-w-0 items-center rounded-[6px]">
                    <button
                      type="button"
                      data-component="sidebar-session-row"
                      class={`
                        flex h-8 min-w-0 w-full shrink-0 cursor-default items-center gap-2 rounded-[6px] border-0
                        bg-transparent px-1.5 text-left text-v2-text-text-muted [font-weight:440]
                        transition-[background-color,color] duration-[120ms] ease-in-out
                        hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base
                        data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base
                        focus-visible:bg-v2-background-bg-layer-01 focus-visible:outline-none
                      `}
                      data-selected={activeSessionId() === record.session.id ? "" : undefined}
                      onMouseDown={(event) => {
                        if (event.button === 1) event.preventDefault()
                      }}
                      onClick={(event) => openSession(record.session, { background: isBackgroundOpen(event) })}
                      onAuxClick={(event) => {
                        if (!isBackgroundOpen(event)) return
                        event.preventDefault()
                        openSession(record.session, { background: true })
                      }}
                    >
                      <HomeSessionStatusController
                        server={serverKey}
                        record={record}
                        isOpenTab={(entry) => sessionHasOpenTab(tabs.store, serverKey(), entry.session)}
                        render={(status) => (
                          <SessionTabAvatarView
                            project={record.project}
                            directory={record.session.directory}
                            revealProjectOnHover={!selectedProject()}
                            unread={status.unread()}
                            loading={status.loading()}
                          />
                        )}
                      />
                      <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base [font-weight:440]">
                        {sessionTitle(record.session.title) || record.session.id}
                      </span>
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </section>
        </div>
        <div class="flex shrink-0 flex-col gap-1 border-t border-v2-border-border-base/60 p-2">
          <SidebarNavButton onClick={openMe}>
            <Mark class="h-4 w-auto shrink-0" />
            <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">Me</span>
          </SidebarNavButton>
        </div>
      </aside>
    </Show>
  )
}

function MeDialog(props: { onHome: () => void; onSettings: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const close = () => dialog.close()
  return (
    <div class="flex w-64 flex-col gap-1 rounded-[12px] bg-v2-background-bg-base p-2 shadow-[var(--v2-elevation-floating)]">
      <div class="px-2 py-1 text-v2-text-text-muted [font-weight:530]">Me</div>
      <SidebarNavButton
        onClick={() => {
          close()
          props.onHome()
        }}
      >
        <Mark class="h-4 w-auto shrink-0" />
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {language.t("home.title")}
        </span>
      </SidebarNavButton>
      <SidebarNavButton
        onClick={() => {
          close()
          props.onSettings()
        }}
      >
        <IconV2 name="settings-gear" size="small" />
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {language.t("sidebar.settings")}
        </span>
      </SidebarNavButton>
    </div>
  )
}

function SidebarServerProjects(props: {
  conn: ServerConnection.Any
  projects: LocalProject[]
  selection: Accessor<HomeProjectSelection>
  language: ReturnType<typeof useLanguage>
  unseenCount: (conn: ServerConnection.Any, project: LocalProject) => number
  onSelectProject: (conn: ServerConnection.Any, directory: string) => void
  onOpenProjectNewSession: (conn: ServerConnection.Any, directory: string) => void
}) {
  if (props.projects.length === 0) return null
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <div class="px-1.5 pt-1 text-v2-text-text-faint [font-weight:530]">
        {props.conn.displayName ?? props.conn.http.url}
      </div>
      <For each={props.projects}>
        {(project) => (
          <SidebarProjectRow
            project={project}
            conn={props.conn}
            selected={
              props.selection().server === ServerConnection.key(props.conn) &&
              props.selection().directory === project.worktree
            }
            language={props.language}
            unseenCount={props.unseenCount}
            onSelectProject={props.onSelectProject}
            onOpenProjectNewSession={props.onOpenProjectNewSession}
          />
        )}
      </For>
    </div>
  )
}

function SidebarProjectRow(props: {
  project: LocalProject
  conn: ServerConnection.Any | undefined
  selected: boolean
  language: ReturnType<typeof useLanguage>
  unseenCount: (conn: ServerConnection.Any, project: LocalProject) => number
  onSelectProject: (conn: ServerConnection.Any, directory: string) => void
  onOpenProjectNewSession: (conn: ServerConnection.Any, directory: string) => void
}) {
  const name = () => displayName(props.project)
  const unseen = () => (props.conn ? props.unseenCount(props.conn, props.project) : 0)
  return (
    <div class="group/project relative flex h-7 min-w-0 items-center rounded-[6px]">
      <button
        type="button"
        data-component="sidebar-project-row"
        class={`
          flex h-7 min-w-0 w-full shrink-0 cursor-default items-center gap-2 rounded-[6px] bg-transparent px-1.5
          text-left text-v2-text-text-muted [font-weight:440]
          transition-[background-color,color] duration-[120ms] ease-in-out
          hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base
          data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base
          focus-visible:bg-v2-background-bg-layer-01 focus-visible:outline-none
        `}
        data-selected={props.selected ? "" : undefined}
        aria-current={props.selected ? "page" : undefined}
        onClick={() => {
          if (props.conn) props.onSelectProject(props.conn, props.project.worktree)
        }}
      >
        <ProjectAvatar
          fallback={name()}
          src={getProjectAvatarSource(props.project.id, props.project.icon)}
          variant={getProjectAvatarVariant(props.project.icon?.color)}
        />
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{name()}</span>
        <Show when={unseen() > 0}>
          <span class="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-v2-background-bg-layer-04 px-1 text-[10px] text-v2-text-text-base">
            {unseen()}
          </span>
        </Show>
      </button>
      <Show when={props.conn}>
        {(conn) => (
          <div class="hover-reveal absolute right-1 top-1/2 hidden -translate-y-1/2 items-center group-hover/project:flex">
            <TooltipV2 placement="bottom" value={props.language.t("command.session.new")}>
              <IconButtonV2
                data-action="sidebar-project-new-session"
                variant="ghost-muted"
                size="small"
                icon={<IconV2 name="edit" />}
                aria-label={props.language.t("command.session.new")}
                onClick={() => props.onOpenProjectNewSession(conn(), props.project.worktree)}
              />
            </TooltipV2>
          </div>
        )}
      </Show>
    </div>
  )
}

function SidebarNavButton(props: ParentProps<{ onClick: () => void; disabled?: boolean }>) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      class={`
        flex h-7 min-w-0 w-full shrink-0 cursor-default items-center gap-2 rounded-[6px] bg-transparent px-1.5
        text-left text-v2-text-text-faint [font-weight:440]
        transition-[background-color,color] duration-[120ms] ease-in-out
        hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base
        disabled:opacity-40
        focus-visible:bg-v2-background-bg-layer-01 focus-visible:outline-none
      `}
    >
      {props.children}
    </button>
  )
}
