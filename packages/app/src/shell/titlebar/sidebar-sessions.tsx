import { createEffect, createMemo, createResource, For, onCleanup, onMount, Show } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createStore } from "solid-js/store"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis, RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { arrayMove } from "@/runtime/array-move"
import { tabHref, tabKey, type SessionTab, type Tab } from "@/shell/tabs/tabs"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { DraftTabItem, TabNavItem } from "@/shell/titlebar/tab-nav"
import { useGlobal, useServerCtx, type ServerCtx } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { useCommand } from "@/shell/commands/command"
import { useTabs } from "@/shell/tabs/tabs"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { createTabComposerState } from "@/composer/persistence"
import { base64Encode } from "@opencode/util/encode"
import { showToast } from "@/shell/notifications/toast"
import { adjacentTabKey, mergeVisibleTabOrder } from "./tab-order"
import { Button } from "@opencode/ui/button"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { Select } from "@opencode/ui/select"
import { displayName } from "@opencode/ui/project-avatar"
import { useSettings } from "@/settings/model"
import { pathKey } from "@/workspaces/path-key"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { sessionTitle } from "@/session/title"
import { errorMessage } from "@/shell/layout/helpers"
import { notifySessionTabsRemoved } from "./session-events"
import { setSidebarUnread } from "@/shell/sidebar-peek"
import type { SessionInfo } from "@opencode/client/promise"
import { createSessionIndexes } from "@/home/sessions/queries"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Schema } from "effect"
import { useQueryClient } from "@tanstack/solid-query"

import { previousSessionCommand, nextSessionCommand } from "./tab-strip"

const PROJECT_SESSION_LIMIT = 5

function SessionTabSlot(props: {
  tab: SessionTab
  id: string
  index: number
  active: boolean
  orientation: "horizontal" | "vertical"
  sortGroup?: string
  closable?: boolean
  closeLabel?: string
  session: SessionInfo | undefined
  preparing: boolean
  unread: boolean
  attention: boolean
  loading: boolean
  fallbackTitle?: string
  fallbackDirectory?: string
  onRename: (title: string) => Promise<void>
  onDelete: () => void
  onNavigate: (element: HTMLDivElement) => void
  onClose: () => void
  onIntent: (hovered: boolean) => void
}) {
  const sortable = useSortable({
    get id() {
      return props.id
    },
    get index() {
      return props.index
    },
    get type() {
      return props.sortGroup
    },
    get accept() {
      return props.sortGroup ? [props.sortGroup] : undefined
    },
  })

  let ref!: HTMLDivElement

  return (
    <div
      ref={sortable.ref}
      data-titlebar-tab-slot
      data-tab-key={props.id}
      data-active={props.active}
      data-orientation={props.orientation}
      class="relative flex"
      classList={{
        "w-56 min-w-7 max-w-56 flex-shrink": props.orientation === "horizontal",
        "w-full shrink-0": props.orientation === "vertical",
      }}
      onPointerEnter={() => props.onIntent(true)}
      onPointerLeave={() => props.onIntent(false)}
    >
      <TabNavItem
        ref={(el) => {
          ref = el
        }}
        href={tabHref(props.tab)}
        server={props.tab.server}
        session={props.session}
        preparing={props.preparing}
        unread={props.unread}
        attention={props.attention}
        loading={props.loading}
        fallbackTitle={props.fallbackTitle}
        fallbackDirectory={props.fallbackDirectory}
        onRename={props.onRename}
        onDelete={props.onDelete}
        onNavigate={() => props.onNavigate(ref)}
        onClose={props.onClose}
        closable={props.closable}
        closeLabel={props.closeLabel}
        showSessionDetails
        active={props.active}
        dragging={sortable.isDragSource()}
        orientation={props.orientation}
      />
    </div>
  )
}

function SessionTabEntry(props: {
  tab: SessionTab
  currentTab?: Tab
  id: string
  index: number
  active: boolean
  orientation: "horizontal" | "vertical"
  sortGroup?: string
  indexed?: SessionInfo
  opened?: boolean
  dismissible?: boolean
  serverCtx: ServerCtx | undefined
  onVisibleChange: (visible: boolean) => void
  onUnreadChange: (unread: boolean) => void
  onNavigate: (element: HTMLDivElement) => void
  onClose: () => void
}) {
  const tabs = useTabs()
  const language = useLanguage()
  const dialog = useDialog()
  const queryClient = useQueryClient()
  const servers = useServers()
  const sdk = createMemo(() => props.serverCtx?.sdk ?? null)
  const pending = createMemo(() => tabs.pendingSession(props.tab.server, props.tab.sessionId))
  const cachedSession = createMemo(() => props.serverCtx?.data.session.get(props.tab.sessionId))
  const persisted = createMemo(() => tabs.info[props.id])

  const status = useSessionTabAvatarState(
    () => props.tab.server,
    () => props.tab.sessionId,
    () => true,
    () => props.indexed,
  )

  // A busy session shows its progress indicator instead of the unread dot.
  const unread = createMemo(() => status.unread() && !status.loading())

  const [loadedSession] = createResource(
    () => {
      if (pending() || props.indexed || (!props.active && persisted()?.title)) return null
      const ctx = props.serverCtx

      return ctx ? { id: props.tab.sessionId, ctx } : null
    },
    ({ id, ctx }) =>
      ctx.data.session
        .sync(id)
        .then(() => ctx.data.session.get(id))
        .catch(() => undefined),
  )

  const session = createMemo(() =>
    pending()
      ? undefined
      : (cachedSession() ??
        props.indexed ??
        (loadedSession.state === "ready" || loadedSession.state === "refreshing" ? loadedSession.latest : undefined)),
  )
  const missingSession = createMemo(() => !pending() && !!props.serverCtx && !loadedSession.loading && !session())
  const visible = createMemo(() => !!pending() || !!session() || missingSession() || !!persisted()?.title)

  const rename = async (title: string) => {
    const value = session()
    const ctx = props.serverCtx

    if (!value || !ctx) return

    ctx.data.session.remember({ ...value, title })

    try {
      await ctx.sdk.api.session.update({ sessionID: value.id, title })
      const conn = servers.list.find((item) => ServerConnection.key(item) === props.tab.server)
      if (conn)
        queryClient.setQueryData<SessionInfo[]>(["home-sessions", conn], (current) =>
          current?.map((item) => (item.id === value.id ? { ...item, title } : item)),
        )
    } catch (err) {
      const current = session()
      const currentCtx = props.serverCtx

      // A newer rename may have replaced this title while the save was in flight.
      if (current && currentCtx && current.title === title)
        currentCtx.data.session.remember({ ...current, title: value.title })
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  function DeleteDialog() {
    const confirm = async () => {
      const value = session()
      const ctx = props.serverCtx

      dialog.close()

      if (!value || !ctx) return
      const ids = sessionTreeIDs(ctx.data.session.list(), value.id)

      try {
        await ctx.data.session.remove(value.id)
        notifySessionTabsRemoved({ server: props.tab.server, directory: value.location.directory, sessionIDs: ids })
      } catch (cause) {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(cause, language.t("session.delete.failed.title")),
        })
      }
    }

    return (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("session.delete.title")}
            description={language.t("session.delete.confirm", {
              name: sessionTitle(session()?.title) ?? language.t("session.tab.session"),
            })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" autofocus onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={confirm}>
            {language.t("session.delete.button")}
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }

  createEffect(() => props.onVisibleChange(visible()))
  createEffect(() => props.onUnreadChange(unread()))

  createEffect(() => {
    const ctx = props.serverCtx
    const id = props.tab.sessionId

    if (
      props.opened === false ||
      pending() ||
      !ctx ||
      props.active ||
      ctx.data.session.missing(id) ||
      (!session() && !persisted()?.title) ||
      ctx.sdk.connection.status() !== "connected"
    )
      return

    const current = props.currentTab

    if (current?.type === "session" && current.server === props.tab.server && current.sessionId !== id) {
      const active = ctx.data.session.get(current.sessionId)

      if (
        !active ||
        ctx.data.location.agent.list(active.location) === undefined ||
        ctx.data.location.provider.list(active.location) === undefined ||
        ctx.data.location.model.list(active.location) === undefined ||
        ctx.data.location.skill.list(active.location) === undefined
      )
        return
    }

    const running = [id, ...ctx.data.session.family(id)].some(
      (sessionID) => ctx.data.session.status(sessionID) === "running",
    )

    const timer = window.setTimeout(
      () =>
        void Promise.allSettled([
          ctx.data.session.sync(id, { children: true }),
          // The selected timeline loads the transcript; inactive tabs need metadata and the inbox,
          // whose waiting work keeps the tab busy. Only a running session can wait on a permission
          // or form, and reading either boots the session's location on the server.
          ...(running ? [ctx.data.session.permission.sync(id), ctx.data.session.form.sync(id)] : []),
          ctx.data.session.pending.sync(id),
        ]),
      300 + props.index * 50,
    )

    onCleanup(() => window.clearTimeout(timer))
  })

  // A pointer resting on a tab usually clicks it next, so its transcript loads during the dwell. Passing over loads nothing.
  let intent: number | undefined

  const hover = (hovered: boolean) => {
    window.clearTimeout(intent)
    const ctx = props.serverCtx
    const value = session()

    if (!hovered || !ctx || !value || props.active || ctx.sdk.connection.status() !== "connected") return
    intent = window.setTimeout(() => void ctx.data.session.message.sync(value.id).catch(() => undefined), 100)
  }

  onCleanup(() => window.clearTimeout(intent))

  createEffect(() => {
    if (props.opened === false) return
    const value = session()

    if (!value) return
    tabs.rememberSessionInfo(
      props.tab,
      value,
      props.serverCtx?.data.session.message.list(value.id).some((message) => message.type === "user") ?? false,
    )
    const current = sdk()

    if (!current) return
    createTabComposerState(tabs, props.tab, current.scope, {
      dir: base64Encode(value.location.directory),
      id: value.id,
    })
  })

  return (
    <Show when={visible()}>
      <SessionTabSlot
        tab={props.tab}
        id={props.id}
        index={props.index}
        active={props.active}
        orientation={props.orientation}
        sortGroup={props.sortGroup}
        closable={props.opened !== false || props.dismissible}
        closeLabel={props.opened === false ? language.t("sidebar.recent.hide") : undefined}
        session={session()}
        preparing={!!pending()}
        unread={unread()}
        attention={status.attention()}
        loading={status.loading()}
        fallbackTitle={
          pending()
            ? language.t("session.tab.session")
            : (persisted()?.title ?? (missingSession() ? language.t("session.tab.unknown") : undefined))
        }
        fallbackDirectory={pending()?.draft.directory ?? persisted()?.directory}
        onRename={rename}
        onDelete={() => dialog.show(() => <DeleteDialog />)}
        onNavigate={props.onNavigate}
        onClose={props.onClose}
        onIntent={hover}
      />
    </Show>
  )
}

function DraftTabSlot(props: {
  tab: Extract<Tab, { type: "draft" }>
  id: string
  index: number
  active: boolean
  orientation: "horizontal" | "vertical"
  sortGroup?: string
  title: string
  onNavigate: (element: HTMLDivElement) => void
  onClose: () => void
}) {
  const sortable = useSortable({
    get id() {
      return props.id
    },
    get index() {
      return props.index
    },
    get type() {
      return props.sortGroup
    },
    get accept() {
      return props.sortGroup ? [props.sortGroup] : undefined
    },
  })

  let ref!: HTMLDivElement

  return (
    <div
      ref={sortable.ref}
      data-titlebar-tab-slot
      data-tab-key={props.id}
      data-active={props.active}
      data-orientation={props.orientation}
      class="relative flex"
      classList={{
        "w-56 min-w-7 max-w-56 flex-shrink": props.orientation === "horizontal",
        "w-full shrink-0": props.orientation === "vertical",
      }}
    >
      <DraftTabItem
        ref={(el) => {
          ref = el
        }}
        href={tabHref(props.tab)}
        title={props.title}
        onNavigate={() => props.onNavigate(ref)}
        onClose={props.onClose}
        active={props.active}
        dragging={sortable.isDragSource()}
        orientation={props.orientation}
      />
    </div>
  )
}

// Keep local history navigation separate from the upstream open-tab strip.
export function SidebarSessions(props: {
  orientation?: "horizontal" | "vertical"
  grouping?: boolean
  tabs: Tab[]
  currentTab: Tab | undefined
  onNavigate: (tab: Tab, el?: HTMLDivElement) => void
  onClose: (tab: Tab) => void
  onReorder: (keys: string[]) => void
}) {
  const global = useGlobal()
  const language = useLanguage()
  const command = useCommand()
  const settings = useSettings()
  const tabs = useTabs()
  const vertical = () => props.orientation === "vertical"
  const grouped = () => vertical() && props.grouping && settings.appearance.tabGrouping() === "project"
  let listRef!: HTMLDivElement
  let scrollRef!: HTMLDivElement
  // Each vertical edge feathers by as much as there is left to scroll past it, so it appears and leaves without a jump.
  const [fade, setFade] = createStore({ top: 0, bottom: 0 })

  const measureFade = () =>
    setFade({
      top: Math.min(16, Math.round(scrollRef.scrollTop)),
      bottom: Math.min(
        16,
        Math.max(0, Math.round(scrollRef.scrollHeight - scrollRef.clientHeight - scrollRef.scrollTop)),
      ),
    })

  onMount(() => {
    if (vertical()) createResizeObserver([scrollRef, listRef], measureFade)
  })
  const [visibility, setVisibility] = createStore<Record<string, boolean>>({})
  const [unread, setUnread] = createStore<Record<string, boolean>>({})
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})

  const servers = useServers()
  const sidebar = props.grouping
    ? createSessionIndexes(() => servers.visible.map((conn) => ({ conn, ctx: global.ensureServerCtx(conn) })))
    : undefined
  const sidebarOrder = props.grouping
    ? persisted(Persist.window("sidebar.order"), Schema.Array(Schema.String), [])
    : undefined
  const indexed = createMemo(
    () =>
      new Map(
        sidebar
          ?.sources()
          .flatMap((source) =>
            source.sessions.map(
              (session) =>
                [
                  tabKey({ type: "session", server: ServerConnection.key(source.conn), sessionId: session.id }),
                  { session, ctx: source.ctx, server: ServerConnection.key(source.conn) },
                ] as const,
            ),
          ),
      ),
  )
  const positions = new Map<string, number>()
  // Keep row identities and display order when a tab opens or closes. History is never copied into the tab store.
  const displayedTabs = createMemo((previous: Tab[]) => {
    if (!sidebar) return props.tabs
    if (!tabs.sidebar.ready()) return []
    const before = new Map(previous.map((tab) => [tabKey(tab), tab]))
    const candidates = new Map(props.tabs.filter((tab) => !tabs.sidebar.hidden(tab)).map((tab) => [tabKey(tab), tab]))
    indexed().forEach((entry, key) => {
      if (candidates.has(key)) return
      const tab = before.get(key) ?? { type: "session" as const, server: entry.server, sessionId: entry.session.id }
      if (!tabs.sidebar.hidden(tab)) candidates.set(key, tab)
    })
    // Equal timestamps keep their original order even while server metadata arrives at different times.
    candidates.forEach((_, key) => {
      if (!positions.has(key)) positions.set(key, positions.size)
    })
    const projects = new Map(
      sidebar
        .sources()
        .map((source) => [
          ServerConnection.key(source.conn),
          new Set(source.ctx.projects.visible().map((project) => pathKey(project.worktree))),
        ]),
    )
    candidates.forEach((tab, key) => {
      if (tab.type !== "session") return
      const ctx = global.serverCtx(tab.server)
      const session = ctx?.data.session.get(tab.sessionId) ?? indexed().get(key)?.session
      // Child sessions stay accessible through their parent's subagent view.
      if (session?.parentID) candidates.delete(key)
      const project = session && ctx?.projects.forSession(session)
      if (project && !projects.get(tab.server)?.has(pathKey(project.worktree))) candidates.delete(key)
    })
    const recent = [...candidates.values()]
      .filter((tab) => tab.type === "session")
      .map((tab) => ({
        key: tabKey(tab),
        updated: Math.max(
          global.serverCtx(tab.server)?.data.session.get(tab.sessionId)?.time.updated ?? 0,
          indexed().get(tabKey(tab))?.session.time.updated ?? 0,
        ),
      }))
      .toSorted(
        (a, b) =>
          b.updated - a.updated || (positions.get(a.key) ?? positions.size) - (positions.get(b.key) ?? positions.size),
      )
      .map((item) => item.key)
      .values()
    const order = [...candidates.values()].map((tab) => (tab.type === "draft" ? tabKey(tab) : recent.next().value!))
    return [...new Set([...(sidebarOrder?.[0] ?? []), ...order])].flatMap((key) => candidates.get(key) ?? [])
  }, [])
  const opened = createMemo(() => new Set(props.tabs.map(tabKey)))
  const groups = createMemo(() => {
    if (!grouped()) return []
    const result = new Map<
      string,
      { key: string; name: string; directory?: string; server?: string; connection: ServerConnection.Key; tabs: Tab[] }
    >()
    const totals = new Map<string, string[]>()
    sidebar?.sources().forEach((source) =>
      source.inventory.forEach((session) => {
        const root = source.ctx.projects.forSession(session)?.worktree ?? session.location.directory
        const key = JSON.stringify([ServerConnection.key(source.conn), pathKey(root)])
        const sessions = totals.get(key)
        if (sessions) {
          sessions.push(session.id)
          return
        }
        totals.set(key, [session.id])
      }),
    )
    sidebar?.sources().forEach((source) => {
      const server = ServerConnection.key(source.conn)
      source.ctx.projects.visible().forEach((project) => {
        const key = JSON.stringify([server, pathKey(project.worktree)])
        result.set(key, {
          key,
          name: displayName(project),
          directory: project.worktree,
          connection: server,
          server: servers.visible.length > 1 ? serverName(source.conn) : undefined,
          tabs: [],
        })
      })
    })
    displayedTabs().forEach((tab) => {
      const ctx = global.serverCtx(tab.server)
      const session =
        tab.type === "session"
          ? (ctx?.data.session.get(tab.sessionId) ?? indexed().get(tabKey(tab))?.session)
          : undefined
      const directory =
        tab.type === "draft"
          ? tab.directory
          : (session?.location.directory ??
            tabs.pendingSession(tab.server, tab.sessionId)?.draft.directory ??
            tabs.info[tabKey(tab)]?.directory)
      const project = session
        ? ctx?.projects.forSession(session)
        : directory
          ? ctx?.projects.forDirectory(directory)
          : undefined
      const root = project?.worktree ?? directory
      const key = JSON.stringify([tab.server, root ? pathKey(root) : null])
      const existing = result.get(key)
      if (existing) {
        existing.tabs.push(tab)
        return
      }
      const conn = servers.visible.find((item) => ServerConnection.key(item) === tab.server)
      result.set(key, {
        key,
        name: root ? displayName(project ?? { worktree: root }) : language.t("sidebar.grouping.other"),
        directory: root,
        connection: tab.server,
        server: servers.visible.length > 1 && conn ? serverName(conn) : undefined,
        tabs: [tab],
      })
    })
    return [...result.values()].map((group) => {
      const sessions = group.tabs.filter((tab) => tab.type === "session")
      return {
        ...group,
        recent: sessions.length,
        total: new Set([...(totals.get(group.key) ?? []), ...sessions.map((tab) => tab.sessionId)]).size,
      }
    })
  })
  const groupsByKey = createMemo(() => new Map(groups().map((group) => [group.key, group])))
  const projectTabs = createMemo(
    () =>
      new Map(
        groups().map((group) => {
          if (expanded[group.key]) return [group.key, group.tabs] as const
          const current = props.currentTab
          const active = current && group.tabs.find((tab) => tabKey(tab) === tabKey(current))
          const first = group.tabs.slice(0, PROJECT_SESSION_LIMIT)
          // Keep the selected session in view without letting a large project expand the sidebar automatically.
          return [group.key, active && !first.includes(active) ? [...first.slice(0, -1), active] : first] as const
        }),
      ),
  )
  const tabGroups = createMemo(
    () => new Map(groups().flatMap((group) => group.tabs.map((tab) => [tabKey(tab), group] as const))),
  )

  const orderedTabs = createMemo(() => (grouped() ? [...projectTabs().values()].flat() : displayedTabs()))
  const visibleTabs = createMemo(() => orderedTabs().filter((tab) => tab.type === "draft" || visibility[tabKey(tab)]))
  const visibleTabIds = () => visibleTabs().map(tabKey)

  // Tells the closed sidebar's toggle whether any row here shows its unread dot, which the current tab never does.
  createEffect(() => {
    if (!vertical()) return
    setSidebarUnread(displayedTabs().some((tab) => tab !== props.currentTab && !!unread[tabKey(tab)]))
    onCleanup(() => setSidebarUnread(false))
  })

  command.register("titlebar-tab-cycle", () => [
    {
      id: `tab.prev`,
      category: "tab",
      title: "",
      keybind: `mod+option+ArrowLeft,ctrl+shift+tab`,
      hidden: true,
      onSelect: () => selectAdjacentTab(-1),
    },
    {
      id: `tab.next`,
      category: "tab",
      title: "",
      keybind: `mod+option+ArrowRight,ctrl+tab`,
      hidden: true,
      onSelect: () => selectAdjacentTab(1),
    },
    {
      ...previousSessionCommand,
      category: language.t("command.category.session"),
      title: language.t("command.session.previous"),
      onSelect: () => selectAdjacentTab(-1),
    },
    {
      ...nextSessionCommand,
      category: language.t("command.category.session"),
      title: language.t("command.session.next"),
      onSelect: () => selectAdjacentTab(1),
    },
    {
      id: "session.previous.unseen",
      category: language.t("command.category.session"),
      title: language.t("command.session.previous.unseen"),
      keybind: "shift+alt+arrowup",
      onSelect: () => selectAdjacentTab(-1, (key) => !!unread[key]),
    },
    {
      id: "session.next.unseen",
      category: language.t("command.category.session"),
      title: language.t("command.session.next.unseen"),
      keybind: "shift+alt+arrowdown",
      onSelect: () => selectAdjacentTab(1, (key) => !!unread[key]),
    },
  ])

  // One registration numbers the visible tabs, so a reorder, a close or a tab coming into view never leaves two tabs
  // holding the same number while their owners update.
  const tabRefs = new Map<string, () => HTMLDivElement | undefined>()

  command.register("titlebar-tab-numbers", () =>
    visibleTabs()
      .slice(0, 9)
      .map((tab, index) => ({
        id: `tab.${index + 1}`,
        category: "tab",
        title: "",
        keybind: `mod+${index + 1}`,
        hidden: true,
        onSelect: () => navigate(tab, tabRefs.get(tabKey(tab))?.()),
      })),
  )

  function selectAdjacentTab(offset: -1 | 1, include?: (key: string) => boolean) {
    const current = props.currentTab
    const key = adjacentTabKey(visibleTabIds(), current ? tabKey(current) : undefined, offset, include)
    const next = displayedTabs().find((tab) => tabKey(tab) === key)

    if (next) navigate(next)
  }

  function navigate(tab: Tab, element?: HTMLDivElement) {
    if (!sidebar || tab.type === "draft") return props.onNavigate(tab, element)
    const entry = indexed().get(tabKey(tab))
    if (entry) entry.ctx.data.session.remember(entry.session)
    props.onNavigate(tabs.addSessionTab({ server: tab.server, sessionId: tab.sessionId }), element)
  }

  const renderTab = (tab: Tab) => {
    const id = tabKey(tab)
    let ref!: HTMLDivElement
    // Live metadata refreshes must not reset the sortable's in-flight index when the row order is unchanged.
    const visibleIndex = createMemo(() => visibleTabs().findIndex((item) => tabKey(item) === id))
    const group = () => tabGroups().get(id)

    const element = () => ref
    tabRefs.set(id, element)
    onCleanup(() => {
      if (tabRefs.get(id) === element) tabRefs.delete(id)
    })

    const serverCtx = useServerCtx(() => {
      if (tab.type !== "session") return

      return global.servers.list().find((item) => ServerConnection.key(item) === tab.server)
    })

    if (tab.type === "session") {
      return (
        <>
          <SessionTabEntry
            tab={tab}
            currentTab={props.currentTab}
            id={id}
            index={visibleIndex()}
            active={!!props.currentTab && tabKey(props.currentTab) === id}
            orientation={vertical() ? "vertical" : "horizontal"}
            sortGroup={group()?.key}
            serverCtx={serverCtx()}
            indexed={indexed().get(id)?.session}
            opened={!sidebar || opened().has(id)}
            dismissible={!!sidebar}
            onVisibleChange={(visible) => setVisibility(id, visible)}
            onUnreadChange={(value) => setUnread(id, value)}
            onNavigate={(element) => {
              ref = element
              navigate(tab, element)
            }}
            onClose={() => {
              if (sidebar && !opened().has(id)) return tabs.sidebar.hide(tab)
              props.onClose(tab)
            }}
          />
        </>
      )
    }

    return (
      <>
        <DraftTabSlot
          tab={tab}
          id={id}
          index={visibleIndex()}
          active={!!props.currentTab && tabKey(props.currentTab) === id}
          orientation={vertical() ? "vertical" : "horizontal"}
          sortGroup={group()?.key}
          title={language.t("session.tab.session")}
          onNavigate={(element) => {
            ref = element
            navigate(tab, element)
          }}
          onClose={() => props.onClose(tab)}
        />
      </>
    )
  }

  return (
    <div
      data-slot={vertical() ? "vertical-tabs" : "titlebar-tabs"}
      data-orientation={vertical() ? "vertical" : "horizontal"}
      class="relative min-w-0"
      classList={{ "min-h-0 overflow-hidden": vertical() }}
    >
      <Show when={vertical() && props.grouping}>
        <div class="mb-2 flex shrink-0 items-center gap-2 [app-region:no-drag]">
          <h2 class="shrink-0 text-[13px] leading-4 font-medium text-v2-text-text-muted">
            {language.t("sidebar.recent.title")}
          </h2>
          <Select
            options={["none", "project"] as const}
            current={settings.appearance.tabGrouping()}
            aria-label={language.t("sidebar.grouping.label")}
            label={(option) => language.t(`sidebar.grouping.${option}`)}
            onSelect={(option) => option && settings.appearance.setTabGrouping(option)}
            class="min-w-0 flex-1"
          />
        </div>
      </Show>
      <div
        ref={scrollRef}
        data-slot={vertical() ? "vertical-tabs-scroll" : "titlebar-tabs-scroll"}
        data-scrollable
        class="flex min-w-0 no-scrollbar [app-region:no-drag]"
        classList={{
          "flex-row items-center gap-1.5 overflow-x-auto": !vertical(),
          "max-h-full flex-col overflow-y-auto overflow-x-hidden": vertical(),
        }}
        style={
          vertical()
            ? { "--vertical-tabs-fade-top": `${fade.top}px`, "--vertical-tabs-fade-bottom": `${fade.bottom}px` }
            : undefined
        }
        onScroll={() => {
          if (vertical()) measureFade()
        }}
      >
        <DragDropProvider
          sensors={[
            PointerSensor.configure({
              activationConstraints: (event) =>
                event.pointerType === "touch"
                  ? [new PointerActivationConstraints.Distance({ value: 8 })]
                  : [new PointerActivationConstraints.Distance({ value: 4 })],
              preventActivation: (event) =>
                event.target instanceof Element &&
                !!event.target.closest(
                  '[data-slot="tab-close"], [contenteditable="true"], [contenteditable="plaintext-only"]',
                ),
            }),
          ]}
          modifiers={[
            vertical() ? RestrictToVerticalAxis : RestrictToHorizontalAxis,
            RestrictToElement.configure({ element: () => listRef }),
          ]}
          plugins={(defaults) => [
            ...defaults.filter((plugin) => plugin !== Accessibility),
            AutoScroller.configure({ acceleration: 8, threshold: vertical() ? { x: 0, y: 0.05 } : { x: 0.05, y: 0 } }),
            Feedback.configure({ dropAnimation: null }),
          ]}
          onDragStart={(event) => {
            const source = event.operation.source

            if (!source) return
            const tab = props.tabs.find((item) => tabKey(item) === source.id.toString())

            if (!tab) return

            if (vertical()) return
            const tabEl = source.element?.querySelector<HTMLDivElement>("[data-titlebar-tab]")
            props.onNavigate(tab, tabEl ?? undefined)
          }}
          onDragEnd={(event) => {
            const source = event.operation.source

            if (event.canceled || !isSortable(source)) return
            const group = tabGroups().get(source.id.toString())
            const visible = visibleTabIds()
            const current = group ? visible.filter((key) => tabGroups().get(key) === group) : visible
            const from = group ? current.indexOf(source.id.toString()) : source.initialIndex
            const to = group ? current.indexOf(visible[source.index]) : source.index

            if (from !== -1 && to !== -1 && from !== to) {
              const keys = mergeVisibleTabOrder(displayedTabs().map(tabKey), current, arrayMove(current, from, to))
              if (!sidebarOrder) return props.onReorder(keys)
              const save = () => sidebarOrder[1](() => keys)
              if (sidebarOrder[3]()) return save()
              void sidebarOrder[3].promise?.then(save)
            }
          }}
        >
          <div
            data-titlebar-tab-list
            data-orientation={vertical() ? "vertical" : "horizontal"}
            class="flex w-full min-w-0"
            classList={{ "flex-row items-center": !vertical(), "flex-col items-stretch": vertical() }}
            ref={listRef}
          >
            <For each={grouped() ? groups().map((group) => group.key) : [""]}>
              {(key) => (
                <>
                  <Show when={grouped() && groupsByKey().get(key)}>
                    {(group) => (
                      <div
                        class="mt-3 mb-1 min-w-0 rounded-md bg-v2-background-bg-layer-02 px-1.5 py-1"
                        title={[
                          group().name,
                          group().directory,
                          group().server,
                          language.plural("sidebar.recent.count", group().total, {
                            recent: group().recent,
                            shown:
                              projectTabs()
                                .get(key)
                                ?.filter((tab) => tab.type === "session").length ?? 0,
                          }),
                        ]
                          .filter(Boolean)
                          .join("\n")}
                      >
                        <div class="flex min-w-0 items-center gap-2">
                          <h3
                            dir="auto"
                            class="min-w-0 flex-1 truncate text-[13px] leading-4 font-medium text-v2-text-text-base"
                          >
                            {group().name}
                          </h3>
                          <span class="shrink-0 rounded px-1 text-[11px] leading-4 tabular-nums text-v2-text-text-faint">
                            {group().recent}/{group().total}
                          </span>
                          <Show when={group().directory}>
                            {(directory) => (
                              <IconButton
                                size="small"
                                variant="ghost-muted"
                                icon={<Icon name="plus-small" />}
                                aria-label={language.t("sidebar.project.newSession", { project: group().name })}
                                title={language.t("sidebar.project.newSession", { project: group().name })}
                                onClick={() => {
                                  global.serverCtx(group().connection)?.projects.touch(directory())
                                  void tabs.newDraft({ server: group().connection, directory: directory() })
                                }}
                              />
                            )}
                          </Show>
                        </div>
                        <Show when={group().server}>
                          <div dir="auto" class="truncate text-[12px] leading-4 text-v2-text-text-faint">
                            {group().server}
                          </div>
                        </Show>
                      </div>
                    )}
                  </Show>
                  <Show when={grouped()} fallback={<For each={displayedTabs()}>{renderTab}</For>}>
                    <div class="flex min-w-0 flex-col gap-1 ps-2">
                      <For each={projectTabs().get(key)}>{renderTab}</For>
                    </div>
                  </Show>
                  <Show when={grouped() && groupsByKey().get(key)}>
                    {(group) => (
                      <Show when={group().tabs.length > PROJECT_SESSION_LIMIT}>
                        <Button
                          variant="ghost-muted"
                          size="small"
                          class="h-7 shrink-0 justify-start"
                          aria-expanded={!!expanded[key]}
                          aria-label={
                            expanded[key]
                              ? language.t("sidebar.recent.collapse", { project: group().name })
                              : language.plural("sidebar.recent.expand", group().tabs.length - PROJECT_SESSION_LIMIT, {
                                  project: group().name,
                                })
                          }
                          onClick={() => setExpanded(key, !expanded[key])}
                        >
                          {expanded[key]
                            ? language.t("sidebar.recent.less")
                            : language.plural("sidebar.recent.more", group().tabs.length - PROJECT_SESSION_LIMIT)}
                        </Button>
                      </Show>
                    )}
                  </Show>
                </>
              )}
            </For>
          </div>
        </DragDropProvider>
      </div>
      <Show when={!vertical()}>
        <div
          data-slot="titlebar-tabs-fade-left"
          aria-hidden="true"
          class="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-[linear-gradient(to_right,var(--v2-background-bg-deep),transparent)]"
        />
        <div
          data-slot="titlebar-tabs-fade-right"
          aria-hidden="true"
          class="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-[linear-gradient(to_left,var(--v2-background-bg-deep),transparent)]"
        />
      </Show>
    </div>
  )
}
