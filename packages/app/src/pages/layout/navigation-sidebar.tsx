import { createEffect, createMemo, createSignal, For, onCleanup, Show, startTransition } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useQuery } from "@tanstack/solid-query"
import type { GlobalSession } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@opencode-ai/core/util/binary"
import { Spinner } from "@opencode-ai/ui/spinner"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogFooter, DialogHeader, DialogTitleGroup, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
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
import { useCommand } from "@/context/command"
import { useDirectoryPicker } from "@/components/directory-picker"
import { sessionHasOpenTab, useTabs } from "@/context/tabs"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeProjectsController } from "@/pages/home/home-projects-controller"
import { archiveHomeSession } from "@/pages/home-session-archive"
import { shouldOpenSessionInBackground } from "@/pages/home-session-open"
import { displayName, errorMessage, homeProjectDirectories } from "@/pages/layout/helpers"
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
import {
  downloadSessionExport,
  fetchSessionExport,
  sessionExportFilename,
} from "@/utils/session-export"
import { sessionTitle, withTimestampedFallback } from "@/utils/session-title"
import { showToast } from "@/utils/toast"

type SidebarProjectSection = SidebarProjectGroup & {
  visible: SidebarSessionRecord[]
  hidden: SidebarSessionRecord[]
}

type SettledGroup = {
  key: string
  project: LocalProject
  name: string
  local: SidebarSessionRecord[]
  archived: SidebarSessionRecord[]
}

type SessionAction = (record: SidebarSessionRecord) => void

const SESSION_LIMIT = 64
const ARCHIVED_LIMIT = 100
const AGE_TICK = 60_000
const STATUS_TICK = 1_000
const SECTION_LABEL = "px-3 pb-1 pt-3 text-v2-text-text-muted [font-weight:440]"
const ROW =
  "group/row relative flex h-7 min-w-0 w-full shrink-0 cursor-default items-center gap-2 rounded-[6px] bg-transparent px-1.5 text-start text-v2-text-text-muted [font-weight:440] transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base data-[selected=true]:bg-v2-background-bg-layer-03 data-[selected=true]:text-v2-text-text-base data-[selected=true]:hover:bg-v2-background-bg-layer-03 focus-visible:bg-v2-background-bg-layer-01 focus-visible:text-v2-text-text-base focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]"
// Trailing padding reserves the hover action zone so titles never sit under the buttons and
// rows keep identical geometry with or without hover.
const ROW_SESSION = `${ROW} pe-24`
const ROW_PROJECT = `${ROW} pe-14`
const ROW_ACTIONS =
  "hover-reveal absolute end-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-[6px] bg-v2-background-bg-layer-02 p-0.5 opacity-0 shadow-[var(--v2-elevation-raised)] group-hover/row:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100"
const COUNT = "absolute end-2 top-1/2 -translate-y-1/2 text-xs text-v2-text-text-faint"
const NAME = "flex min-w-0 flex-1 items-center gap-1.5"

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
  const command = useCommand()
  const dialog = useDialog()
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const pickDirectory = useDirectoryPicker()

  const [filter, setFilter] = createSignal("")
  const [now, setNow] = createSignal(Date.now())
  const [tick, setTick] = createSignal(Date.now())
  const [state, setState] = persisted(
    Persist.global("sidebar.navigation", ["sidebar.navigation.v1"]),
    createStore({
      collapsed: {} as Record<string, boolean>,
      settled: false,
      settledOpen: {} as Record<string, boolean>,
      pins: {} as Record<string, boolean>,
    }),
  )
  const [status, setStatus] = createStore({
    started: {} as Record<string, number>,
    done: {} as Record<string, number>,
  })
  // Projects added during this app session keep an empty row until their first thread exists;
  // older projects whose threads are all settled stay out of the Projects section.
  const [fresh, setFresh] = createStore<Record<string, boolean>>({})

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

  // The shared index cache only refreshes on mount; the per-directory sync stores are the live
  // source of truth, so overlay them to pick up renames, settles and deletes immediately.
  const sessions = createMemo(() => {
    const sync = home.server.focusedSync()
    const indexed = retainHomeSessions(
      homeSessions().sessions(sessionIndex.data, sessionEvents.data),
      SESSION_LIMIT,
      now(),
    )
    return indexed.flatMap((session) => {
      const [store] = sync.child(session.directory, { bootstrap: false })
      if (store.status === "loading") return [session]
      const match = Binary.search(store.session, session.id, (item) => item.id)
      if (!match.found) return []
      return [store.session[match.index]]
    })
  })

  const serverKey = createMemo(() => home.selection.value().server ?? ServerConnection.Key.make(""))
  const route = createMemo(() => layout.route())
  const currentSession = createMemo(() => {
    const value = route()
    return value.type === "session" ? value.sessionId : undefined
  })
  const working = (sessionID: string) => home.server.focusedSync().session.data.session_working(sessionID)

  const anyWorking = createMemo(() => sessions().some((session) => working(session.id)))
  createEffect(() => {
    if (!anyWorking()) return
    const timer = setInterval(() => setTick(Date.now()), STATUS_TICK)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    for (const session of sessions()) {
      const started = status.started[session.id]
      if (working(session.id) && started === undefined) setStatus("started", session.id, Date.now())
      if (!working(session.id) && started !== undefined)
        setStatus(
          produce((draft) => {
            delete draft.started[session.id]
            draft.done[session.id] = Date.now()
          }),
        )
    }
  })

  createEffect(() => {
    const current = currentSession()
    if (!current || status.done[current] === undefined) return
    setStatus(
      produce((draft) => {
        delete draft.done[current]
      }),
    )
  })

  createEffect(() => {
    const ids = new Set(sessions().map((session) => session.id))
    const stale = [...Object.keys(status.started), ...Object.keys(status.done)].filter((id) => !ids.has(id))
    if (stale.length === 0) return
    setStatus(
      produce((draft) => {
        for (const id of stale) {
          delete draft.started[id]
          delete draft.done[id]
        }
      }),
    )
  })

  // Open tabs whose session is missing from the index mean the cache lagged behind a promotion.
  const [missingKey, setMissingKey] = createSignal("")
  createEffect(() => {
    const known = new Set(sessions().map((session) => session.id))
    const missing = tabs.store
      .flatMap((tab) =>
        tab.type === "session" && tab.server === serverKey() && !known.has(tab.sessionId) ? [tab.sessionId] : [],
      )
      .sort()
      .join(",")
    if (!missing || missing === missingKey()) return
    setMissingKey(missing)
    void sessionIndex.refetch()
  })

  const computedSections = createMemo((): SidebarProjectSection[] => {
    const records = buildSidebarRecords({ sessions: sessions(), projects: home.project.list() }).filter((record) =>
      matchesSidebarFilter(record, filter()),
    )
    const grouped = groupSidebarRecords(records).map((group) => {
      const parts = partitionSidebarRecords({
        records: group.records,
        pinned: (record) => alwaysVisible(record),
        days: settings.general.sidebarSessionDays() ?? 3,
        now: now(),
      })
      return {
        ...group,
        // Pinned threads stay at the top of their project regardless of recency.
        visible: [...parts.visible].sort(
          (a, b) => Number(isPinned(b.session.id)) - Number(isPinned(a.session.id)),
        ),
        hidden: parts.hidden,
      }
    })
    // Projects added during this session keep an empty row until their first thread exists.
    const known = new Set(grouped.map((group) => group.key))
    const opened = home.project.list().flatMap((project): SidebarProjectSection[] => {
      const key = pathKey(project.worktree)
      if (known.has(key) || fresh[key] !== true) return []
      return [{ key, project, name: displayName(project), records: [], visible: [], hidden: [] }]
    })
    return [...grouped, ...opened]
  })

  // reconcile keeps group/record object identity stable across recomputes so Solid's For does
  // not destroy and recreate every row component on each streaming event (which orphaned open
  // menu/tooltip portals and rebuilt the whole subtree constantly).
  const [sections, setSections] = createStore<SidebarProjectSection[]>([])
  createEffect(() => {
    setSections(
      reconcile(computedSections(), { key: "key" }),
    )
  })

  const settled = createMemo(() => sections.flatMap((group) => group.hidden))
  const visibleGroups = createMemo(() => {
    if (filter()) return sections.filter((group) => group.visible.length > 0)
    return sections
  })
  const empty = createMemo(() => visibleGroups().length === 0 && settled().length === 0)

  const archived = useQuery(() => ({
    queryKey: ["sidebar", "settled", serverKey()],
    enabled: state.settled && !!home.server.focusedContext(),
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
    staleTime: 300_000,
  }))

  const computedSettledGroups = createMemo((): SettledGroup[] => {
    const map = new Map<string, SettledGroup>()
    const push = (record: SidebarSessionRecord, kind: "local" | "archived") => {
      const key = pathKey(record.project.worktree)
      const group = map.get(key) ?? { key, project: record.project, name: record.name, local: [], archived: [] }
      group[kind].push(record)
      map.set(key, group)
    }
    settled().forEach((record) => push(record, "local"))
    ;(archived.data ?? []).forEach((session) => push(archivedRecord(session), "archived"))
    return [...map.values()]
  })
  const [settledGroups, setSettledGroups] = createStore<SettledGroup[]>([])
  createEffect(() => {
    setSettledGroups(reconcile(computedSettledGroups(), { key: "key" }))
  })
  const settledCount = createMemo(() => settled().length + (archived.data ?? []).length)

  function archivedRecord(session: GlobalSession): SidebarSessionRecord {
    const project: LocalProject =
      projectOf(session) ?? {
        id: session.project?.id,
        name: session.project?.name,
        worktree: session.directory,
        expanded: false,
      }
    return { key: session.id, session, project, name: displayName(project) }
  }

  function isPinned(sessionID: string) {
    return state.pins[sessionID] === true
  }

  function alwaysVisible(record: SidebarSessionRecord) {
    if (isPinned(record.session.id)) return true
    if (record.session.id === currentSession()) return true
    if (working(record.session.id)) return true
    return sessionHasOpenTab(tabs.store, serverKey(), record.session)
  }

  function projectOf(session: { directory: string }) {
    const directory = pathKey(session.directory)
    return home.project.list().find((item) => pathKey(item.worktree) === directory)
  }

  function branchOf(directory: string) {
    return home.server.focusedSync().child(directory)[0].vcs?.branch
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

  function unsettle(session: { id: string; directory: string }) {
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

  async function removeSession(record: SidebarSessionRecord) {
    const conn = home.server.focused()
    const ctx = home.server.focusedContext()
    if (!conn || !ctx) return
    const key = ServerConnection.key(conn)
    const id = record.session.id
    const directory = record.session.directory
    const wasCurrent = currentSession() === id
    const others = tabs.store.filter((tab) => tab.type === "session" && tab.sessionId !== id)
    const result = await ctx.sdk.api.session
      .remove({ sessionID: id })
      .catch((cause) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(cause, language.t("session.delete.failed.title")),
        })
        return undefined
      })
    if (!result) return
    const [, setStore] = ctx.sync.child(directory)
    setStore(
      produce((draft) => {
        const match = Binary.search(draft.session, id, (item) => item.id)
        if (match.found) draft.session.splice(match.index, 1)
      }),
    )
    homeSessions().remove(id)
    tabs.removeSessionTab({ server: key, sessionId: id })
    if (wasCurrent && others.length === 0) void tabs.newDraft({ server: key, directory })
  }

  function confirmDelete(record: SidebarSessionRecord) {
    dialog.show(() => (
      <DialogDeleteSession name={titleOf(record.session)} onDelete={() => removeSession(record)} />
    ))
  }

  function rename(record: SidebarSessionRecord, title: string) {
    void (async () => {
      const ctx = home.server.focusedContext()
      if (!ctx) return
      const result = await ctx.sdk.api.session
        .rename({ sessionID: record.session.id, title })
        .catch((cause) => {
          requestFailed(cause)
          return undefined
        })
      if (!result) return
    })()
  }

  function confirmRename(record: SidebarSessionRecord) {
    dialog.show(() => (
      <DialogRenameSession initial={titleOf(record.session)} onConfirm={(title) => rename(record, title)} />
    ))
  }

  const canShare = createMemo(() => home.server.focusedSync().data.config.share !== "disabled")

  function share(record: SidebarSessionRecord) {
    void (async () => {
      const ctx = home.server.focusedContext()
      if (!ctx) return
      const [store] = ctx.sync.child(record.session.directory, { bootstrap: false })
      const match = Binary.search(store.session, record.session.id, (item) => item.id)
      const existing = match.found ? store.session[match.index].share?.url : undefined
      const url =
        existing ??
        (await ctx.sdk.client.session
          .share({ sessionID: record.session.id })
          .then((response) => response.data?.share?.url)
          .catch(() => undefined))
      if (!url) {
        showToast({
          title: language.t("toast.session.share.failed.title"),
          description: language.t("toast.session.share.failed.description"),
        })
        return
      }
      const copied = await navigator.clipboard.writeText(url).then(
        () => true,
        () => false,
      )
      showToast(
        copied
          ? {
              title: language.t("toast.session.share.success.title"),
              description: language.t("toast.session.share.success.description"),
            }
          : { title: language.t("toast.session.share.copyFailed.title") },
      )
    })()
  }

  function exportSession(record: SidebarSessionRecord) {
    void (async () => {
      const ctx = home.server.focusedContext()
      if (!ctx) return
      const data = await fetchSessionExport({ sessionID: record.session.id, client: ctx.sdk.client }).catch(
        (cause) => {
          requestFailed(cause)
          return undefined
        },
      )
      if (!data) return
      const filename = sessionExportFilename(data.info)
      downloadSessionExport(filename, data)
      showToast({
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename }),
      })
    })()
  }

  function closeTab(record: SidebarSessionRecord) {
    tabs.removeSessionTab({ server: serverKey(), sessionId: record.session.id })
  }

  function togglePin(sessionID: string) {
    setState("pins", sessionID, (value) => value !== true)
  }

  const canCreate = createMemo(() => !!home.project.newSession())
  const connection = createMemo(() => home.server.focused())

  function newThread() {
    const conn = connection()
    const current = currentSession()
    const directory = current ? sessions().find((session) => session.id === current)?.directory : undefined
    const target = directory ?? home.selection.value().directory
    if (!conn || !target) {
      home.project.openNewSession()
      return
    }
    home.project.openProjectNewSession(conn, target)
  }

  function addProject() {
    const conn = connection()
    if (!conn || home.server.health(conn)?.healthy === false) return
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const directories = homeProjectDirectories(result)
        if (directories.length === 0) return
        directories.forEach((directory) => setFresh(pathKey(directory), true))
        home.project.add(conn, directories)
        home.project.openProjectNewSession(conn, directories[0])
      },
    })
  }

  command.register(() => [
    {
      id: "sidebar.thread.new",
      title: language.t("sidebar.thread.new"),
      category: language.t("command.category.session"),
      keybind: "mod+shift+n",
      disabled: !canCreate(),
      onSelect: () => newThread(),
    },
  ])

  const rowActions = {
    onRename: confirmRename,
    onShare: share,
    onExport: exportSession,
    onSettle: settle,
    onUnsettleArchive: unsettle,
    onUnsettlePin: togglePin,
    onDelete: confirmDelete,
    onCloseTab: closeTab,
    onTogglePin: togglePin,
    canShare,
  }

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
            onClick={newThread}
            class="flex h-7 min-w-0 flex-1 cursor-default items-center gap-2 rounded-[6px] bg-v2-background-bg-layer-01 px-2 text-start text-v2-text-text-base [font-weight:530] transition-[background-color,color] duration-[120ms] ease-in-out hover:bg-v2-background-bg-layer-02 focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)] disabled:opacity-50"
          >
            <IconV2 name="edit" class="size-3.5 shrink-0 text-v2-icon-icon-muted" />
            <span class="truncate">{language.t("sidebar.thread.new")}</span>
          </button>
          <TooltipV2 value={language.t("home.project.add")} placement="bottom-end">
            <IconButtonV2
              data-action="sidebar-add-project"
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="folder-add-left" />}
              aria-label={language.t("home.project.add")}
              onClick={addProject}
            />
          </TooltipV2>
        </div>
        <TextInputV2
          fluid
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
                pinned={isPinned}
                started={(sessionID) => status.started[sessionID]}
                done={(sessionID) => status.done[sessionID]}
                working={working}
                tick={() => tick()}
                branch={branchOf}
                actions={rowActions}
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

          <Show when={settledCount() > 0 || state.settled}>
            <button
              type="button"
              data-action="sidebar-settled-toggle"
              aria-expanded={state.settled}
              onClick={() => setState("settled", (value) => !value)}
              class={`${ROW_PROJECT} min-w-0`}
            >
              <span class={NAME}>
                <IconV2 name="archive" class="size-3.5 shrink-0 text-v2-icon-icon-muted" />
                <span class="min-w-0 truncate">{language.t("sidebar.settled")}</span>
                <IconV2
                  name="chevron-down"
                  class={`size-3 shrink-0 text-v2-icon-icon-muted transition-transform duration-[120ms] ${state.settled ? "" : "-rotate-90"}`}
                />
              </span>
              <span class={COUNT}>{settledCount()}</span>
            </button>
            <Show when={state.settled}>
              <Show when={archived.isLoading}>
                <div class="flex items-center justify-center py-3 text-v2-text-text-faint">
                  <Spinner class="size-3.5 shrink-0" />
                </div>
              </Show>
              <For each={settledGroups}>
                {(group) => (
                  <SidebarSettledGroup
                    group={group}
                    server={serverKey()}
                    open={state.settledOpen[group.key] === true}
                    current={currentSession()}
                    tick={() => tick()}
                    branch={branchOf}
                    actions={rowActions}
                    onToggle={() => setState("settledOpen", group.key, (value) => value !== true)}
                    onOpen={open}
                  />
                )}
              </For>
            </Show>
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

type SessionActions = {
  onRename: SessionAction
  onShare: SessionAction
  onExport: SessionAction
  onSettle: SessionAction
  onUnsettleArchive: (session: { id: string; directory: string }) => void
  onUnsettlePin: (sessionID: string) => void
  onDelete: SessionAction
  onCloseTab: SessionAction
  onTogglePin: (sessionID: string) => void
  canShare: () => boolean
}

function SidebarProject(props: {
  group: SidebarProjectSection
  server: ServerConnection.Key
  collapsed: boolean
  current: string | undefined
  pinned: (sessionID: string) => boolean
  started: (sessionID: string) => number | undefined
  done: (sessionID: string) => number | undefined
  working: (sessionID: string) => boolean
  tick: () => number
  branch: (directory: string) => string | undefined
  actions: SessionActions
  unseen: () => number
  canReveal: () => boolean
  onToggleCollapsed: () => void
  onOpen: (session: { id: string; directory: string }, project: LocalProject | undefined, event?: MouseEvent) => void
  onNewSession: () => void
  onEdit: () => void
  onReveal: () => void
  onClearNotifications: () => void
  onClose: () => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const [menuOpen, setMenuOpen] = createSignal(false)

  return (
    <div class="flex min-w-0 flex-col">
      <div class="group/row relative flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          data-action="sidebar-project"
          aria-expanded={!props.collapsed}
          onClick={props.onToggleCollapsed}
          class={`${ROW_PROJECT} min-w-0 flex-1`}
        >
          <SessionTabAvatarView
            project={props.group.project}
            directory={props.group.project.worktree}
            unread={props.unseen() > 0}
            loading={false}
          />
          <span class={NAME}>
            <span class="min-w-0 truncate [font-weight:530] text-v2-text-text-base">{props.group.name}</span>
            <IconV2
              name="chevron-down"
              class={`size-3 shrink-0 text-v2-icon-icon-muted transition-transform duration-[120ms] ${props.collapsed ? "-rotate-90" : ""}`}
            />
          </span>
          <Show when={props.group.visible.length > 0}>
            <span class={`${COUNT} transition-opacity duration-[120ms] group-hover/row:opacity-0`}>
              {props.group.visible.length}
            </span>
          </Show>
        </button>
        <div class={ROW_ACTIONS} data-menu={menuOpen()}>
          <TooltipV2 value={language.t("sidebar.thread.new")} placement="top-end">
            <IconButtonV2
              data-action="sidebar-project-new-session"
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="edit" />}
              aria-label={language.t("sidebar.thread.new")}
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
                <MenuV2.Item onSelect={props.onNewSession}>{language.t("sidebar.thread.new")}</MenuV2.Item>
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
        <div class="flex flex-col gap-0.5 pb-1 ps-6">
          <For each={props.group.visible}>
            {(record) => (
              <SidebarSessionRow
                record={record}
                server={props.server}
                current={record.session.id === props.current}
                pinned={props.pinned(record.session.id)}
                started={() => props.started(record.session.id)}
                done={() => props.done(record.session.id)}
                working={() => props.working(record.session.id)}
                tick={props.tick}
                branch={props.branch}
                actions={props.actions}
                onOpen={props.onOpen}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

function SidebarSettledGroup(props: {
  group: SettledGroup
  server: ServerConnection.Key
  open: boolean
  current: string | undefined
  tick: () => number
  branch: (directory: string) => string | undefined
  actions: SessionActions
  onToggle: () => void
  onOpen: (session: { id: string; directory: string }, project: LocalProject | undefined, event?: MouseEvent) => void
}) {
  const count = () => props.group.local.length + props.group.archived.length
  return (
    <div class="flex min-w-0 flex-col">
      <button
        type="button"
        data-action="sidebar-settled-group"
        aria-expanded={props.open}
        onClick={props.onToggle}
        class={`${ROW_PROJECT} min-w-0`}
      >
        <SessionTabAvatarView
          project={props.group.project}
          directory={props.group.project.worktree}
          unread={false}
          loading={false}
        />
        <span class={NAME}>
          <span class="min-w-0 truncate">{props.group.name}</span>
          <IconV2
            name="chevron-down"
            class={`size-3 shrink-0 text-v2-icon-icon-muted transition-transform duration-[120ms] ${props.open ? "" : "-rotate-90"}`}
          />
        </span>
        <span class={COUNT}>{count()}</span>
      </button>
      <Show when={props.open}>
        <div class="flex flex-col gap-0.5 pb-1 ps-6">
          <For each={props.group.local}>
            {(record) => (
              <SidebarSessionRow
                record={record}
                server={props.server}
                current={record.session.id === props.current}
                settled
                tick={props.tick}
                branch={props.branch}
                actions={props.actions}
                onOpen={props.onOpen}
              />
            )}
          </For>
          <For each={props.group.archived}>
            {(record) => (
              <SidebarSessionRow
                record={record}
                server={props.server}
                current={record.session.id === props.current}
                settled
                serverArchived
                tick={props.tick}
                branch={props.branch}
                actions={props.actions}
                onOpen={props.onOpen}
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
  settled?: boolean
  serverArchived?: boolean
  pinned?: boolean
  started?: () => number | undefined
  done?: () => number | undefined
  working?: () => boolean
  tick: () => number
  branch: (directory: string) => string | undefined
  actions: SessionActions
  onOpen: (session: { id: string; directory: string }, project: LocalProject | undefined, event?: MouseEvent) => void
}) {
  const language = useLanguage()
  const tabs = useTabs()
  const [menuOpen, setMenuOpen] = createSignal(false)
  const server = createMemo(() => props.server)
  const directory = createMemo(() => props.record.session.directory)
  const sessionID = createMemo(() => props.record.session.id)
  const status = useSessionTabAvatarState(server, directory, sessionID)
  const open = createMemo(() => sessionHasOpenTab(tabs.store, props.server, props.record.session))
  const title = createMemo(() => titleOf(props.record.session))
  const live = createMemo(() => {
    if (props.settled) return undefined
    // A pending question or permission outranks the working timer so the user notices input is needed.
    if (status.attention()) return { kind: "attention" as const, label: language.t("sidebar.status.attention") }
    const started = props.started?.()
    if (started !== undefined && props.working?.())
      return { kind: "working" as const, label: language.t("sidebar.status.working"), time: elapsed(started) }
    const done = props.done?.()
    if (done !== undefined) return { kind: "done" as const, label: language.t("sidebar.status.done") }
    return undefined
  })

  function elapsed(since: number) {
    const seconds = Math.max(0, Math.round((props.tick() - since) / 1000))
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    return `${Math.floor(minutes / 60)}h`
  }

  // Fade the tail of long titles under the status badge instead of colliding with it.
  const titleMask = createMemo(() => {
    if (props.settled || (!live() && !props.pinned)) return ""
    return "[mask-image:linear-gradient(to_right,black,black_calc(100%-24px),transparent)] group-hover/row:[mask-image:none]"
  })

  const badge = () => (
    <Show when={live()}>
      {(value) => (
        <Show
          when={value().kind === "working"}
          fallback={
            <Show
              when={value().kind === "attention"}
              fallback={
                <span class="flex shrink-0 items-center gap-1 text-v2-state-fg-success">
                  <IconV2 name="check" class="size-3 shrink-0" />
                  <span class="text-xs">{value().label}</span>
                </span>
              }
            >
              <span class="flex shrink-0 items-center gap-1 text-v2-state-fg-warning">
                <IconV2 name="status-active" class="size-3 shrink-0" />
                <span class="text-xs">{value().label}</span>
              </span>
            </Show>
          }
        >
          <span class="flex shrink-0 items-center gap-1 text-v2-state-fg-info">
            <Spinner class="size-3 shrink-0" />
            <span class="text-xs">{value().label}</span>
            <span class="text-xs">{value().time}</span>
          </span>
        </Show>
      )}
    </Show>
  )

  return (
    <div class="group/row relative flex min-w-0 items-center">
      <TooltipV2
        class="min-w-0 flex-1"
        value={<SessionInfo record={props.record} branch={() => props.branch(props.record.session.directory)} />}
        placement="right-start"
        gutter={10}
      >
        <button
          type="button"
          data-action="sidebar-session"
          data-selected={props.current ? true : undefined}
          aria-current={props.current ? "true" : undefined}
          onClick={(event) => props.onOpen(props.record.session, props.record.project, event)}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenuOpen(true)
          }}
          class={`${props.settled ? ROW_PROJECT : ROW_SESSION} min-w-0 flex-1`}
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
          <span class={NAME}>
            <span class={`min-w-0 truncate ${titleMask()}`}>{title()}</span>
          </span>
        </button>
      </TooltipV2>
      <Show when={!props.settled}>
        <span class="pointer-events-none absolute end-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5 transition-opacity duration-[120ms] group-hover/row:opacity-0">
          <Show when={props.pinned}>
            <IconV2 name="pin" class="size-3 shrink-0 text-v2-icon-icon-muted" />
          </Show>
          {badge()}
        </span>
      </Show>
      <div class={ROW_ACTIONS} data-menu={menuOpen()}>
        <Show when={!props.settled}>
          <TooltipV2 value={language.t("sidebar.settle")} placement="top-end">
            <IconButtonV2
              data-action="sidebar-session-settle"
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="archive" />}
              aria-label={language.t("sidebar.settle")}
              onClick={() => props.actions.onSettle(props.record)}
            />
          </TooltipV2>
        </Show>
        <Show when={props.settled}>
          <TooltipV2 value={language.t("sidebar.unsettle")} placement="top-end">
            <IconButtonV2
              data-action="sidebar-session-unsettle"
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="outline-reset" />}
              aria-label={language.t("sidebar.unsettle")}
              onClick={() =>
                props.serverArchived
                  ? props.actions.onUnsettleArchive(props.record.session)
                  : props.actions.onUnsettlePin(props.record.session.id)
              }
            />
          </TooltipV2>
        </Show>
        <MenuV2
          gutter={6}
          modal={false}
          placement="bottom-end"
          open={menuOpen()}
          onOpenChange={(open) => setMenuOpen(open)}
        >
          <MenuV2.Trigger
            as={IconButtonV2}
            data-action="sidebar-session-menu"
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="outline-dots" />}
            aria-label={language.t("common.moreOptions")}
          />
          <MenuV2.Portal>
            <MenuV2.Content>
              <MenuV2.Item onSelect={() => props.actions.onRename(props.record)}>
                {language.t("common.rename")}
              </MenuV2.Item>
              <Show when={!props.settled && props.actions.canShare()}>
                <MenuV2.Item onSelect={() => props.actions.onShare(props.record)}>
                  {language.t("session.share.action.share")}
                </MenuV2.Item>
              </Show>
              <MenuV2.Item onSelect={() => props.actions.onExport(props.record)}>
                {language.t("common.export")}
              </MenuV2.Item>
              <Show when={!props.settled}>
                <MenuV2.Item onSelect={() => props.actions.onTogglePin(props.record.session.id)}>
                  {language.t(props.pinned ? "sidebar.thread.unpin" : "sidebar.thread.pin")}
                </MenuV2.Item>
              </Show>
              <MenuV2.Separator />
              <MenuV2.Item onSelect={() => props.actions.onDelete(props.record)}>
                {language.t("common.delete")}
              </MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
        <Show when={!props.settled && open()}>
          <TooltipV2 value={language.t("command.tab.close")} placement="top-end">
            <IconButtonV2
              data-action="sidebar-session-close-tab"
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="xmark-small" />}
              aria-label={language.t("command.tab.close")}
              onClick={() => props.actions.onCloseTab(props.record)}
            />
          </TooltipV2>
        </Show>
      </div>
    </div>
  )
}

function SessionInfo(props: { record: SidebarSessionRecord; branch: () => string | undefined }) {
  return (
    <div class="flex w-56 flex-col gap-1.5 p-1">
      <span class="truncate text-v2-text-text-base [font-weight:530]">{titleOf(props.record.session)}</span>
      <div class="flex min-w-0 items-center gap-1.5 text-xs text-v2-text-text-muted">
        <IconV2 name="folder" class="size-3 shrink-0 text-v2-icon-icon-muted" />
        <span class="truncate">{props.record.name}</span>
      </div>
      <div class="flex min-w-0 items-center gap-1.5 text-xs text-v2-text-text-muted">
        <IconV2 name="filetree" class="size-3 shrink-0 text-v2-icon-icon-muted" />
        <span class="truncate">{props.record.session.directory}</span>
      </div>
      <Show when={props.branch()}>
        {(branch) => (
          <div class="flex min-w-0 items-center gap-1.5 text-xs text-v2-text-text-muted">
            <IconV2 name="branch" class="size-3 shrink-0 text-v2-icon-icon-muted" />
            <span class="truncate">{branch()}</span>
          </div>
        )}
      </Show>
      <Show when={props.record.session.model}>
        {(model) => (
          <div class="flex min-w-0 items-center gap-1.5 text-xs text-v2-text-text-muted">
            <ProviderIcon id={model().providerID} class="size-3 shrink-0" />
            <span class="truncate">{model().id}</span>
          </div>
        )}
      </Show>
    </div>
  )
}

function DialogRenameSession(props: { initial: string; onConfirm: (title: string) => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [value, setValue] = createSignal(props.initial)
  const submit = () => {
    const title = value().trim()
    if (!title) return
    props.onConfirm(title)
    dialog.close()
  }
  return (
    <DialogV2 fit>
      <DialogHeader hideClose>
        <DialogTitleGroup title={language.t("common.rename")} description={props.initial} />
      </DialogHeader>
      <div class="px-5 pb-4">
        <TextInputV2
          fluid
          autofocus
          value={value()}
          onInput={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit()
          }}
        />
      </div>
      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 onClick={submit}>{language.t("common.rename")}</ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}

function DialogDeleteSession(props: { name: string; onDelete: () => Promise<unknown> }) {
  const language = useLanguage()
  const dialog = useDialog()
  return (
    <DialogV2 fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("session.delete.title")}
          description={language.t("session.delete.confirm", { name: props.name })}
        />
      </DialogHeader>
      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2
          variant="danger"
          onClick={() => {
            void props.onDelete().then(() => dialog.close())
          }}
        >
          {language.t("session.delete.button")}
        </ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}
