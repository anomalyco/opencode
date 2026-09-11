import { createMemo, createSignal, For, onCleanup, Show, startTransition } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useQuery } from "@tanstack/solid-query"
import type { GlobalSession } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@opencode-ai/core/util/binary"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import {
  loadHomeSessionIndex,
  retainHomeSessions,
  type HomeSessionEvents,
} from "@/context/global-sync/home-session-index"
import type { LocalProject } from "@/context/layout"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/server"
import { useSettings } from "@/context/settings"
import { usePlatform } from "@/context/platform"
import { sessionHasOpenTab, useTabs } from "@/context/tabs"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeProjectsController } from "@/pages/home/home-projects-controller"
import { archiveHomeSession } from "@/pages/home-session-archive"
import { shouldOpenSessionInBackground } from "@/pages/home-session-open"
import { errorMessage } from "@/pages/layout/helpers"
import {
  buildSidebarRecords,
  groupSidebarRecords,
  matchesSidebarFilter,
  partitionSidebarRecords,
  type SidebarProjectGroup,
  type SidebarSessionRecord,
} from "@/pages/layout/navigation-sidebar-visibility"
import { useSessionTabAvatarState } from "@/pages/layout/project-avatar-state"
import { SessionTabAvatarView } from "@/pages/layout/session-tab-avatar"
import { fileManagerApp } from "@/utils/file-manager"
import { pathKey } from "@/utils/path-key"
import { Persist, persisted } from "@/utils/persist"
import { sessionTitle, withTimestampedFallback } from "@/utils/session-title"
import { showToast } from "@/utils/toast"

type SidebarProjectSection = SidebarProjectGroup & {
  visible: SidebarSessionRecord[]
  hidden: SidebarSessionRecord[]
}

const SESSION_LIMIT = 64
const ARCHIVED_LIMIT = 100
const AGE_TICK = 60_000
const SECTION_LABEL = "px-3 pb-1 pt-3 text-v2-text-text-muted [font-weight:440]"
const ROW =
  "group/row relative flex h-7 min-w-0 w-full shrink-0 cursor-default items-center gap-2 rounded-[6px] bg-transparent px-1.5 text-start text-v2-text-text-muted [font-weight:440] transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base data-[selected=true]:bg-v2-background-bg-layer-03 data-[selected=true]:text-v2-text-text-base data-[selected=true]:hover:bg-v2-background-bg-layer-03 focus-visible:bg-v2-background-bg-layer-01 focus-visible:text-v2-text-text-base focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]"
const ROW_ACTIONS =
  "hover-reveal absolute end-1 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100"

function titleOf(session: { title?: string; parentID?: string; time: { created: number } }) {
  return sessionTitle(session.title) ?? withTimestampedFallback(session)
}

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

export function NavigationSidebar() {
  const language = useLanguage()
  const layout = useLayout()
  const settings = useSettings()
  const tabs = useTabs()
  const home = createHomeController()
  const projects = createHomeProjectsController(home)

  const [filter, setFilter] = createSignal("")
  const [now, setNow] = createSignal(Date.now())
  const [state, setState] = persisted(
    Persist.global("sidebar.navigation", ["sidebar.navigation.v1"]),
    createStore({ collapsed: {} as Record<string, boolean>, settledOpen: false }),
  )

  const ticker = setInterval(() => setNow(Date.now()), AGE_TICK)
  onCleanup(() => clearInterval(ticker))

  const homeSessions = () => home.server.focusedSync().homeSessions

  const sessionEvents = useQuery(() => ({
    queryKey: homeSessions().eventsKey,
    queryFn: async (): Promise<HomeSessionEvents> => ({ sequence: 0, entries: [] }),
    initialData: { sequence: 0, entries: [] } satisfies HomeSessionEvents,
    enabled: false,
  }))

  const sessionIndex = useQuery(() => ({
    queryKey: homeSessions().indexKey,
    enabled: !!home.server.focusedContext(),
    queryFn: async ({ signal }) => {
      const ctx = home.server.focusedContext()
      if (!ctx) return { sessions: [], eventSequence: 0 }
      const cache = homeSessions()
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

  const sessions = createMemo(() =>
    retainHomeSessions(homeSessions().sessions(sessionIndex.data, sessionEvents.data), SESSION_LIMIT, now()),
  )

  const serverKey = createMemo(() => home.selection.value().server ?? ServerConnection.Key.make(""))
  const route = createMemo(() => layout.route())
  const currentSession = createMemo(() => {
    const value = route()
    return value.type === "session" ? value.sessionId : undefined
  })
  const working = (sessionID: string) => home.server.focusedSync().session.data.session_working(sessionID)

  const groups = createMemo((): SidebarProjectSection[] => {
    const records = buildSidebarRecords({ sessions: sessions(), projects: home.project.list() }).filter((record) =>
      matchesSidebarFilter(record, filter()),
    )
    return groupSidebarRecords(records).map((group) => ({
      ...group,
      ...partitionSidebarRecords({
        records: group.records,
        pinned: (record) => isPinned(record),
        days: settings.general.sidebarSessionDays() ?? 3,
        now: now(),
      }),
    }))
  })

  const settled = createMemo(() => groups().flatMap((group) => group.hidden))
  const visibleGroups = createMemo(() => groups().filter((group) => group.visible.length > 0))
  const empty = createMemo(() => visibleGroups().length === 0 && settled().length === 0)

  const archivedOpen = () => state.settledOpen
  const archived = useQuery(() => ({
    queryKey: ["sidebar", "settled", serverKey()],
    enabled: archivedOpen() && !!home.server.focusedContext(),
    queryFn: async ({ signal }): Promise<GlobalSession[]> => {
      const ctx = home.server.focusedContext()
      if (!ctx) return []
      const response = await ctx.sdk.client.experimental.session.list(
        { archived: true, roots: true, limit: ARCHIVED_LIMIT },
        { signal },
      )
      return response.data ?? []
    },
    retry: false,
    staleTime: 30_000,
  }))

  function isPinned(record: SidebarSessionRecord) {
    if (record.session.id === currentSession()) return true
    if (working(record.session.id)) return true
    return sessionHasOpenTab(tabs.store, serverKey(), record.session)
  }

  function projectOf(session: { directory: string }) {
    const directory = pathKey(session.directory)
    return home.project.list().find((item) => pathKey(item.worktree) === directory)
  }

  function open(session: { id: string; directory: string }, project: LocalProject | undefined, event?: MouseEvent) {
    const conn = home.server.focused()
    const ctx = home.server.focusedContext()
    if (!conn || !ctx) return
    const directory = project?.worktree ?? session.directory
    ctx.projects.open(directory)
    if (event && isBackgroundOpen(event)) {
      tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })
      return
    }
    ctx.projects.touch(directory)
    void startTransition(() => {
      const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })
      tabs.select(tab)
    })
  }

  function requestFailed(cause: unknown) {
    showToast({
      title: language.t("common.requestFailed"),
      description: errorMessage(cause, language.t("common.requestFailed")),
    })
  }

  function settle(record: SidebarSessionRecord) {
    void (async () => {
      const conn = home.server.focused()
      const ctx = home.server.focusedContext()
      if (!conn || !ctx) return
      if ((await ctx.sdk.protocol) !== "v1") return
      const [, setStore] = ctx.sync.child(record.session.directory)
      await archiveHomeSession({
        server: ServerConnection.key(conn),
        session: record.session,
        archive: (sessionID) =>
          ctx.sdk.client.session.update({
            sessionID,
            directory: record.session.directory,
            time: { archived: Date.now() },
          }),
        remove: () => {
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, record.session.id, (item) => item.id)
              if (match.found) draft.session.splice(match.index, 1)
            }),
          )
          homeSessions().remove(record.session.id)
        },
        onError: requestFailed,
      })
    })()
  }

  function unsettle(session: GlobalSession) {
    void (async () => {
      const conn = home.server.focused()
      const ctx = home.server.focusedContext()
      if (!conn || !ctx) return
      if ((await ctx.sdk.protocol) !== "v1") return
      const result = await ctx.sdk.client.session
        .update({
          sessionID: session.id,
          directory: session.directory,
          // The server clears the archive timestamp on null; the generated type only models the
          // positive case because the OpenAPI emitter drops nullable members of optional fields.
          time: { archived: null as unknown as number },
        })
        .catch((cause) => {
          requestFailed(cause)
          return undefined
        })
      if (!result) return
      void sessionIndex.refetch()
      void archived.refetch()
    })()
  }

  function closeTab(record: SidebarSessionRecord) {
    tabs.removeSessionTab({ server: serverKey(), sessionId: record.session.id })
  }

  const canCreate = createMemo(() => !!home.project.newSession())
  const connection = createMemo(() => home.server.focused())

  return (
    <aside
      aria-label={language.t("settings.shortcuts.group.navigation")}
      class="my-2 ms-2 flex w-[268px] shrink-0 flex-col overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
    >
      <div class="flex shrink-0 flex-col gap-2 px-2 pt-2">
        <div class="flex items-center gap-1">
          <button
            type="button"
            data-action="sidebar-new-session"
            disabled={!canCreate()}
            onClick={() => home.project.openNewSession()}
            class="flex h-7 min-w-0 flex-1 cursor-default items-center gap-2 rounded-[6px] bg-v2-background-bg-layer-01 px-2 text-start text-v2-text-text-base [font-weight:530] transition-[background-color,color] duration-[120ms] ease-in-out hover:bg-v2-background-bg-layer-02 focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)] disabled:opacity-50"
          >
            <IconV2 name="edit" class="size-3.5 shrink-0 text-v2-icon-icon-muted" />
            <span class="truncate">{language.t("command.session.new")}</span>
          </button>
          <TooltipV2 value={language.t("home.project.add")} placement="bottom-end">
            <IconButtonV2
              data-action="sidebar-add-project"
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="folder-add-left" />}
              aria-label={language.t("home.project.add")}
              onClick={() => {
                const conn = home.server.focused()
                if (conn) projects.project.choose(conn)
              }}
            />
          </TooltipV2>
        </div>
        <TextInputV2
          value={filter()}
          autocomplete="off"
          spellcheck={false}
          showClearButton={!!filter()}
          clearLabel={language.t("common.close")}
          onClearClick={() => setFilter("")}
          placeholder={language.t("home.sessions.search.placeholder")}
          leadingIcon={<IconV2 name="magnifying-glass" />}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
      </div>

      <ScrollView class="min-h-0 flex-1">
        <div class="flex flex-col gap-0.5 px-2 pb-2">
          <Show when={sessionIndex.isLoading}>
            <div class="flex items-center justify-center gap-2 py-6 text-v2-text-text-faint">
              <Spinner class="size-3.5 shrink-0" />
              <span class="text-xs">{language.t("common.loading")}</span>
            </div>
          </Show>

          <Show when={!sessionIndex.isLoading && empty()}>
            <div class="flex flex-col gap-1 px-3 py-6 text-center">
              <span class="text-v2-text-text-base [font-weight:530]">
                {filter()
                  ? language.t("home.sessions.search.noResults", { query: filter() })
                  : language.t("sidebar.empty.title")}
              </span>
              <Show when={!filter()}>
                <span class="text-xs text-v2-text-text-faint">{language.t("sidebar.empty.description")}</span>
              </Show>
            </div>
          </Show>

          <Show when={visibleGroups().length > 0}>
            <div class={SECTION_LABEL}>{language.t("home.projects")}</div>
          </Show>

          <For each={visibleGroups()}>
            {(group) => (
              <SidebarProject
                group={group}
                server={serverKey()}
                collapsed={state.collapsed[group.key] === true}
                current={currentSession()}
                working={working}
                unseen={() => {
                  const conn = connection()
                  if (!conn) return 0
                  return projects.project.unseenCount(conn, group.project)
                }}
                canReveal={() => {
                  const conn = connection()
                  return !!conn && projects.project.canReveal(conn)
                }}
                onToggleCollapsed={() => setState("collapsed", group.key, (value) => !value)}
                onOpen={open}
                onSettle={settle}
                onCloseTab={closeTab}
                onNewSession={() => {
                  const conn = connection()
                  if (conn) home.project.openProjectNewSession(conn, group.project.worktree)
                }}
                onEdit={() => {
                  const conn = connection()
                  if (conn) projects.project.edit(conn, group.project)
                }}
                onReveal={() => {
                  const conn = connection()
                  if (conn) projects.project.reveal(conn, group.project)
                }}
                onClearNotifications={() => {
                  const conn = connection()
                  if (conn) projects.project.clearNotifications(conn, group.project)
                }}
                onClose={() => {
                  const conn = connection()
                  if (conn) projects.project.close(conn, group.project.worktree)
                }}
              />
            )}
          </For>

          <div class={SECTION_LABEL}>{language.t("sidebar.archived")}</div>

          <button
            type="button"
            data-action="sidebar-settled-toggle"
            aria-expanded={archivedOpen()}
            onClick={() => setState("settledOpen", (value) => !value)}
            class={ROW}
          >
            <IconV2
              name="chevron-down"
              class={`size-3 shrink-0 text-v2-icon-icon-muted transition-transform duration-[120ms] ${archivedOpen() ? "" : "-rotate-90"}`}
            />
            <IconV2 name="archive" class="size-3.5 shrink-0 text-v2-icon-icon-muted" />
            <span class="min-w-0 flex-1 truncate">{language.t("sidebar.archived")}</span>
          </button>

          <Show when={archivedOpen()}>
            <Show when={archived.isLoading}>
              <div class="flex items-center justify-center py-3 text-v2-text-text-faint">
                <Spinner class="size-3.5 shrink-0" />
              </div>
            </Show>
            <Show when={!archived.isLoading && (archived.data ?? []).length === 0 && settled().length === 0}>
              <div class="px-3 py-2 text-xs text-v2-text-text-faint">{language.t("sidebar.empty.description")}</div>
            </Show>
            <For each={settled()}>
              {(record) => (
                <SidebarSessionRow
                  record={record}
                  server={serverKey()}
                  current={currentSession() === record.session.id}
                  onOpen={open}
                  onSettle={() => settle(record)}
                  onCloseTab={() => closeTab(record)}
                />
              )}
            </For>
            <For each={archived.data ?? []}>
              {(session) => (
                <div class="flex min-w-0 items-center gap-1">
                  <button
                    type="button"
                    data-action="sidebar-settled-session"
                    onClick={(event) => open(session, projectOf(session), event)}
                    class={`${ROW} min-w-0 flex-1`}
                  >
                    <span class="min-w-0 flex-1 truncate">{titleOf(session)}</span>
                  </button>
                  <div class="shrink-0">
                    <TooltipV2 value={language.t("sidebar.archived.restore")} placement="top-end">
                      <IconButtonV2
                        data-action="sidebar-unsettle"
                        variant="ghost-muted"
                        size="small"
                        icon={<IconV2 name="outline-reset" />}
                        aria-label={language.t("sidebar.archived.restore")}
                        onClick={() => unsettle(session)}
                      />
                    </TooltipV2>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </ScrollView>

      <div class="flex shrink-0 items-center justify-between gap-1 border-t border-v2-border-border-muted px-2 py-1.5">
        <IconButtonV2
          data-action="sidebar-settings"
          variant="ghost-muted"
          size="small"
          icon={<IconV2 name="settings-gear" />}
          aria-label={language.t("sidebar.settings")}
          onClick={() => projects.utility.settings()}
        />
        <IconButtonV2
          data-action="sidebar-help"
          variant="ghost-muted"
          size="small"
          icon={<IconV2 name="help" />}
          aria-label={language.t("sidebar.help")}
          onClick={() => projects.utility.help()}
        />
      </div>
    </aside>
  )
}

function SidebarProject(props: {
  group: SidebarProjectSection
  server: ServerConnection.Key
  collapsed: boolean
  current: string | undefined
  working: (sessionID: string) => boolean
  unseen: () => number
  canReveal: () => boolean
  onToggleCollapsed: () => void
  onOpen: (session: { id: string; directory: string }, project: LocalProject | undefined, event?: MouseEvent) => void
  onSettle: (record: SidebarSessionRecord) => void
  onCloseTab: (record: SidebarSessionRecord) => void
  onNewSession: () => void
  onEdit: () => void
  onReveal: () => void
  onClearNotifications: () => void
  onClose: () => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const [menuOpen, setMenuOpen] = createSignal(false)
  const projectWorking = createMemo(() => props.group.visible.some((record) => props.working(record.session.id)))

  return (
    <div class="flex min-w-0 flex-col">
      <div class="group/row relative flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          data-action="sidebar-project"
          aria-expanded={!props.collapsed}
          onClick={props.onToggleCollapsed}
          class={`${ROW} min-w-0 flex-1`}
        >
          <IconV2
            name="chevron-down"
            class={`size-3 shrink-0 text-v2-icon-icon-muted transition-transform duration-[120ms] ${props.collapsed ? "-rotate-90" : ""}`}
          />
          <SessionTabAvatarView
            project={props.group.project}
            directory={props.group.project.worktree}
            unread={props.unseen() > 0}
            loading={projectWorking()}
          />
          <span class="min-w-0 flex-1 truncate [font-weight:530] text-v2-text-text-base">{props.group.name}</span>
          <Show when={props.group.visible.length > 0}>
            <span class="shrink-0 text-xs text-v2-text-text-faint">{props.group.visible.length}</span>
          </Show>
        </button>
        <div class={ROW_ACTIONS} data-menu={menuOpen()}>
          <TooltipV2 value={language.t("command.session.new")} placement="top-end">
            <IconButtonV2
              data-action="sidebar-project-new-session"
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="edit" />}
              aria-label={language.t("command.session.new")}
              onClick={props.onNewSession}
            />
          </TooltipV2>
          <MenuV2
            gutter={6}
            modal={false}
            placement="bottom-end"
            open={menuOpen()}
            onOpenChange={(open) => setMenuOpen(open)}
          >
            <MenuV2.Trigger
              as={IconButtonV2}
              data-action="sidebar-project-menu"
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="outline-dots" />}
              aria-label={language.t("common.moreOptions")}
            />
            <MenuV2.Portal>
              <MenuV2.Content>
                <MenuV2.Item onSelect={props.onNewSession}>{language.t("command.session.new")}</MenuV2.Item>
                <MenuV2.Item onSelect={props.onEdit}>{language.t("dialog.project.edit.title")}</MenuV2.Item>
                <Show when={props.canReveal()}>
                  <MenuV2.Item onSelect={props.onReveal}>
                    {language.t(
                      fileManagerApp(platform.platform === "desktop" ? (platform.os ?? "unknown") : "unknown")
                        .actionLabel,
                    )}
                  </MenuV2.Item>
                </Show>
                <MenuV2.Item disabled={props.unseen() === 0} onSelect={props.onClearNotifications}>
                  {language.t("sidebar.project.clearNotifications")}
                </MenuV2.Item>
                <MenuV2.Separator />
                <MenuV2.Item onSelect={props.onClose}>{language.t("common.close")}</MenuV2.Item>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </div>
      </div>

      <Show when={!props.collapsed}>
        <div class="flex flex-col gap-0.5 pb-1 ps-3">
          <For each={props.group.visible}>
            {(record) => (
              <SidebarSessionRow
                record={record}
                server={props.server}
                current={record.session.id === props.current}
                onOpen={props.onOpen}
                onSettle={props.onSettle}
                onCloseTab={props.onCloseTab}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

function SidebarSessionRow(props: {
  record: SidebarSessionRecord
  server: ServerConnection.Key
  current: boolean
  onOpen: (session: { id: string; directory: string }, project: LocalProject | undefined, event?: MouseEvent) => void
  onSettle: (record: SidebarSessionRecord) => void
  onCloseTab: (record: SidebarSessionRecord) => void
}) {
  const language = useLanguage()
  const tabs = useTabs()
  const server = createMemo(() => props.server)
  const directory = createMemo(() => props.record.session.directory)
  const sessionID = createMemo(() => props.record.session.id)
  const status = useSessionTabAvatarState(server, directory, sessionID)
  const open = createMemo(() => sessionHasOpenTab(tabs.store, props.server, props.record.session))
  const title = createMemo(() => titleOf(props.record.session))

  return (
    <div class="group/row relative flex min-w-0 items-center">
      <button
        type="button"
        data-action="sidebar-session"
        data-selected={props.current ? true : undefined}
        aria-current={props.current ? "true" : undefined}
        onClick={(event) => props.onOpen(props.record.session, props.record.project, event)}
        class={`${ROW} min-w-0 flex-1`}
      >
        <Show when={open()}>
          <span class="absolute start-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-v2-text-text-muted" />
        </Show>
        <SessionTabAvatarView
          project={props.record.project}
          directory={props.record.session.directory}
          revealProjectOnHover
          unread={status.unread()}
          loading={status.loading()}
        />
        <span class="min-w-0 flex-1 truncate">{title()}</span>
      </button>
      <div class={ROW_ACTIONS}>
        <TooltipV2 value={language.t("command.session.archive")} placement="top-end">
          <IconButtonV2
            data-action="sidebar-session-settle"
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="archive" />}
            aria-label={language.t("command.session.archive")}
            onClick={() => props.onSettle(props.record)}
          />
        </TooltipV2>
        <Show when={open()}>
          <TooltipV2 value={language.t("command.tab.close")} placement="top-end">
            <IconButtonV2
              data-action="sidebar-session-close-tab"
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="xmark-small" />}
              aria-label={language.t("command.tab.close")}
              onClick={() => props.onCloseTab(props.record)}
            />
          </TooltipV2>
        </Show>
      </div>
    </div>
  )
}
