import { createEffect, createMemo, createResource, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createStore } from "solid-js/store"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis, RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { arrayMove } from "@/runtime/array-move"
import { tabHref, tabKey, type DraftTab, type SessionTab, type Tab } from "@/shell/tabs/tabs"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { DraftTabItem, TabNavItem } from "@/shell/titlebar/tab-nav"
import { useGlobal, useServerCtx, type ServerCtx } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { useCommand } from "@/shell/commands/command"
import { useTabs } from "@/shell/tabs/tabs"
import { useSettings } from "@/settings/model"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { createTabComposerState } from "@/composer/persistence"
import { base64Encode } from "@opencode/util/encode"
import { showToast } from "@/shell/notifications/toast"
import { adjacentTabKey, mergeVisibleTabOrder } from "./tab-order"
import { orderTabsByServer, serverGroupHeaders } from "./tab-groups"
import { TAB_GROUP_DRAG_TYPE } from "@/runtime/drag"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { sessionTitle } from "@/session/title"
import { errorMessage } from "@/shell/layout/helpers"
import { notifySessionTabsRemoved } from "./session-events"
import { setSidebarUnread } from "@/shell/sidebar-peek"
import type { SessionInfo } from "@opencode/client/promise"

export const previousSessionCommand = { id: "session.previous", keybind: "alt+arrowup" }

export const nextSessionCommand = { id: "session.next", keybind: "alt+arrowdown" }

function TabSlot(props: {
  id: string
  index: number
  server: ServerConnection.Key
  active: boolean
  orientation: "horizontal" | "vertical"
  concealed?: boolean
  onIntent?: (hovered: boolean) => void
  children: (dragging: boolean) => JSX.Element
}) {
  const sortable = useSortable({
    get id() {
      return props.id
    },
    get index() {
      return props.index
    },
    get disabled() {
      return props.concealed
    },
    get data() {
      return { server: props.server }
    },
    accept: (source) => source.data?.server === props.server,
  })

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
        "w-full shrink-0 transition-[max-height,opacity,margin] duration-200 ease-out":
          props.orientation === "vertical",
        "-my-0.5 opacity-0 pointer-events-none": props.orientation === "vertical" && props.concealed,
      }}
      style={{
        "max-height": props.orientation === "vertical" ? (props.concealed ? "0px" : "48px") : undefined,
      }}
      inert={props.concealed}
      onPointerEnter={() => props.onIntent?.(true)}
      onPointerLeave={() => props.onIntent?.(false)}
    >
      {props.children(sortable.isDragSource())}
    </div>
  )
}

function SessionTabSlot(props: {
  tab: SessionTab
  id: string
  index: number
  active: boolean
  orientation: "horizontal" | "vertical"
  concealed?: boolean
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
  let ref!: HTMLDivElement

  return (
    <TabSlot
      id={props.id}
      index={props.index}
      server={props.tab.server}
      active={props.active}
      orientation={props.orientation}
      concealed={props.concealed}
      onIntent={props.onIntent}
    >
      {(dragging) => (
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
          active={props.active}
          dragging={dragging}
          orientation={props.orientation}
        />
      )}
    </TabSlot>
  )
}

function SessionTabEntry(props: {
  tab: SessionTab
  currentTab?: Tab
  id: string
  index: number
  active: boolean
  orientation: "horizontal" | "vertical"
  concealed?: boolean
  serverCtx: ServerCtx | undefined
  onVisibleChange: (visible: boolean) => void
  onUnreadChange: (unread: boolean) => void
  onNavigate: (element: HTMLDivElement) => void
  onClose: () => void
}) {
  const tabs = useTabs()
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = createMemo(() => props.serverCtx?.sdk ?? null)
  const pending = createMemo(() => tabs.pendingSession(props.tab.server, props.tab.sessionId))
  const cachedSession = createMemo(() => props.serverCtx?.data.session.get(props.tab.sessionId))
  const persisted = createMemo(() => tabs.info[props.id])

  const status = useSessionTabAvatarState(
    () => props.tab.server,
    () => props.tab.sessionId,
    () => true,
  )

  // A busy session shows its progress indicator instead of the unread dot.
  const unread = createMemo(() => status.unread() && !status.loading())

  const [loadedSession] = createResource(
    () => {
      if (pending() || (!props.active && persisted()?.title)) return null
      const ctx = props.serverCtx

      return ctx ? { id: props.tab.sessionId, ctx } : null
    },
    ({ id, ctx }) =>
      ctx.data.session
        .sync(id)
        .then(() => ctx.data.session.get(id))
        .catch(() => undefined),
  )

  const session = createMemo(() => (pending() ? undefined : (cachedSession() ?? loadedSession())))
  const missingSession = createMemo(() => !pending() && !!props.serverCtx && !loadedSession.loading && !session())
  const visible = createMemo(() => !!pending() || !!session() || missingSession() || !!persisted()?.title)

  const rename = async (title: string) => {
    const value = session()
    const ctx = props.serverCtx

    if (!value || !ctx) return

    ctx.data.session.remember({ ...value, title })

    try {
      await ctx.sdk.api.session.update({ sessionID: value.id, title })
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
        concealed={props.concealed}
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
  concealed?: boolean
  title: string
  onNavigate: (element: HTMLDivElement) => void
  onClose: () => void
}) {
  let ref!: HTMLDivElement

  return (
    <TabSlot
      id={props.id}
      index={props.index}
      server={props.tab.server}
      active={props.active}
      orientation={props.orientation}
      concealed={props.concealed}
    >
      {(dragging) => (
        <DraftTabItem
          ref={(el) => {
            ref = el
          }}
          href={tabHref(props.tab)}
          title={props.title}
          onNavigate={() => props.onNavigate(ref)}
          onClose={props.onClose}
          active={props.active}
          dragging={dragging}
          orientation={props.orientation}
        />
      )}
    </TabSlot>
  )
}

function ServerGroupHeader(props: {
  title: string
  collapsed: boolean
  dragging: boolean
  onAdd: () => void
  onToggle: () => void
  onDragStart: (event: DragEvent, element: HTMLElement) => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent, element: HTMLElement) => void
  onDrop: (event: DragEvent) => void
}) {
  const language = useLanguage()

  const toggleLabel = () =>
    language.t(props.collapsed ? "session.tab.serverGroup.expand" : "session.tab.serverGroup.collapse", {
      server: props.title,
    })

  return (
    <div
      data-slot="tab-server-group"
      role="group"
      aria-label={props.title}
      data-dragging={props.dragging ? "true" : undefined}
      draggable={true}
      title={language.t("session.tab.serverGroup.drag", { server: props.title })}
      class="relative mt-2 flex h-6 w-full shrink-0 cursor-grab items-center gap-0.5 overflow-hidden rounded-[6px] px-1.5 text-[12px] leading-4 font-medium text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover data-[dragging=true]:bg-v2-background-bg-layer-03 data-[dragging=true]:text-v2-text-text-base data-[dragging=true]:ring-1 data-[dragging=true]:ring-inset data-[dragging=true]:ring-v2-icon-icon-accent active:cursor-grabbing"
      onDragStart={(event) => props.onDragStart(event, event.currentTarget)}
      onDragEnd={props.onDragEnd}
      onDragOver={(event) => props.onDragOver(event, event.currentTarget)}
      onDrop={props.onDrop}
    >
      <bdi class="min-w-0 truncate">{props.title}</bdi>
      <div class="ms-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          data-action="tab-server-group-add"
          aria-label={language.t("session.tab.newOnServer", { server: props.title })}
          title={language.t("session.tab.newOnServer", { server: props.title })}
          class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
          onClick={props.onAdd}
        >
          <Icon name="plus" size="small" />
        </button>
        <button
          type="button"
          data-action="tab-server-group-toggle"
          aria-label={toggleLabel()}
          aria-expanded={!props.collapsed}
          title={toggleLabel()}
          class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
          onClick={props.onToggle}
        >
          <Icon name="outline-chevron-down" size="small" classList={{ "-rotate-90 rtl:rotate-90": props.collapsed }} />
        </button>
      </div>
    </div>
  )
}

function ServerGroupFooter(props: { expanded: boolean; onClick: () => void }) {
  const language = useLanguage()

  return (
    <button
      type="button"
      data-action={props.expanded ? "tab-server-group-show-less" : "tab-server-group-show-more"}
      class="flex h-6 w-full shrink-0 items-center rounded-[6px] px-1.5 text-[12px] leading-4 font-medium text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
      onClick={props.onClick}
    >
      {language.t(props.expanded ? "session.tab.serverGroup.showLess" : "session.tab.showMore")}
    </button>
  )
}

export function TitlebarTabStrip(props: {
  orientation?: "horizontal" | "vertical"
  groupByServer?: boolean
  tabs: Tab[]
  currentTab: Tab | undefined
  onNavigate: (tab: Tab, el?: HTMLDivElement) => void
  onClose: (tab: Tab) => void
  onReorder: (keys: string[]) => void
}) {
  const global = useGlobal()
  const servers = useServers()
  const tabs = useTabs()
  const language = useLanguage()
  const command = useCommand()
  const vertical = () => props.orientation === "vertical"
  const settings = useSettings()
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
  const [collapsed, setCollapsed] = createStore<Record<string, boolean>>({})
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})

  const [drag, setDrag] = createStore<{ server?: ServerConnection.Key }>({})

  const groupTabLimit = 3

  // Grouping needs a second registered server; the sidebar toggle uses the same condition.
  const groupable = createMemo(() => servers.list.length > 1)

  const grouped = createMemo(
    () => !!props.groupByServer && vertical() && settings.appearance.tabGroupByServer() && groupable(),
  )

  // The user's dragged order wins; servers they have not moved keep the app's order after it.
  const serverOrder = createMemo(() => {
    const available = servers.list.map((conn) => ServerConnection.key(conn))
    const known = new Set(available)

    const preferred = settings.appearance
      .tabServerOrder()
      .map((server) => ServerConnection.Key.make(server))
      .filter((server) => known.has(server))

    return [...preferred, ...available.filter((server) => !preferred.includes(server))]
  })

  const ordering = createMemo(() => {
    if (!grouped()) return props.tabs

    return orderTabsByServer(props.tabs, serverOrder())
  })

  // Visible tabs per server, in display order.
  const groups = createMemo(() => {
    const result = new Map<ServerConnection.Key, Tab[]>()

    for (const tab of ordering()) {
      if (tab.type !== "draft" && !visibility[tabKey(tab)]) continue

      const group = result.get(tab.server)

      if (group) group.push(tab)
      else result.set(tab.server, [tab])
    }

    return result
  })

  const shownKeys = createMemo(() => {
    if (!grouped())
      return new Set(
        ordering()
          .filter((tab) => tab.type === "draft" || visibility[tabKey(tab)])
          .map(tabKey),
      )

    const keys = new Set<string>()

    for (const [server, group] of groups()) {
      if (collapsed[server]) continue

      const limit = expanded[server] ? group.length : Math.min(groupTabLimit, group.length)

      for (const tab of group.slice(0, limit)) keys.add(tabKey(tab))
    }

    const current = props.currentTab

    if (current && groups().get(current.server)?.some((tab) => tabKey(tab) === tabKey(current)))
      keys.add(tabKey(current))

    return keys
  })

  const lastShown = createMemo(() => {
    const result = new Map<ServerConnection.Key, string>()

    for (const [server, group] of groups()) {
      const last = group.filter((tab) => shownKeys().has(tabKey(tab))).at(-1)

      if (last) result.set(server, tabKey(last))
    }

    return result
  })

  // The first visible tab of each server carries its group header.
  const headers = createMemo(() => {
    if (!grouped()) return new Map<string, string>()

    const labels = new Map(servers.list.map((conn) => [ServerConnection.key(conn), servers.label(conn)]))

    return serverGroupHeaders(
      ordering(),
      (tab) => tab.type === "draft" || !!visibility[tabKey(tab)],
      labels,
    )
  })

  // Hidden tabs stay mounted but leave keyboard and drag order, so shortcuts only visit visible rows.
  const visibleTabs = createMemo(() => ordering().filter((tab) => shownKeys().has(tabKey(tab))))

  const visibleTabIds = () => visibleTabs().map(tabKey)

  // Tells the closed sidebar's toggle whether any row here shows its unread dot, which the current tab never does.
  createEffect(() => {
    if (!vertical()) return
    setSidebarUnread(props.tabs.some((tab) => tab !== props.currentTab && !!unread[tabKey(tab)]))
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
        onSelect: () => props.onNavigate(tab, tabRefs.get(tabKey(tab))?.()),
      })),
  )

  function selectAdjacentTab(offset: -1 | 1, include?: (key: string) => boolean) {
    const current = props.currentTab
    const key = adjacentTabKey(visibleTabIds(), current ? tabKey(current) : undefined, offset, include)
    const next = props.tabs.find((tab) => tabKey(tab) === key)

    if (next) props.onNavigate(next)
  }

  // Starts a draft on the group's server, in the directory its open tabs already use.
  function newSessionInGroup(server: ServerConnection.Key, name: string) {
    const fail = (reason: "connection" | "directory", description: string) => {
      console.warn("[tab-strip] cannot start a session in a server group", { server, name, reason })
      showToast({
        variant: "error",
        title: language.t("session.tab.serverGroup.openFailed.title"),
        description,
      })
    }

    const conn = servers.list.find((item) => ServerConnection.key(item) === server)

    if (!conn) {
      fail(
        "connection",
        language.t("session.tab.serverGroup.openFailed.connection", { server: name }),
      )

      return
    }

    const ctx = global.ensureServerCtx(conn)
    const group = props.tabs.filter((tab) => tab.server === server)

    const directory =
      group.find((tab): tab is DraftTab => tab.type === "draft" && !!tab.directory)?.directory ??
      group
        .flatMap((tab) =>
          tab.type === "session"
            ? [tabs.info[tabKey(tab)]?.directory ?? ctx.data.session.get(tab.sessionId)?.location.directory]
            : [],
        )
        .find(Boolean) ??
      ctx.projects.last()?.worktree ??
      ctx.projects.used()[0]?.worktree

    if (!directory) {
      fail(
        "directory",
        language.t("session.tab.serverGroup.openFailed.directory", { server: name }),
      )

      return
    }

    setCollapsed(server, false)
    ctx.projects.touch(directory)
    void tabs.newDraft({ server, directory }).catch((cause) => {
      console.error("[tab-strip] failed to start a draft in a server group", { server, name, cause })
      showToast({
        variant: "error",
        title: language.t("session.tab.serverGroup.openFailed.title"),
        description: errorMessage(cause, language.t("session.tab.serverGroup.openFailed.title")),
      })
    })
  }

  function startGroupDrag(event: DragEvent, server: ServerConnection.Key, element: HTMLElement) {
    event.stopPropagation()

    const transfer = event.dataTransfer

    if (!transfer) return

    transfer.setData("text/plain", server)
    transfer.setData(TAB_GROUP_DRAG_TYPE, server)
    transfer.effectAllowed = "move"

    // SAFETY: cloning an HTMLElement returns an HTMLElement.
    const ghost = element.cloneNode(true) as HTMLElement

    ghost.removeAttribute("data-slot")
    ghost.removeAttribute("data-action")
    ghost.dataset.dragging = "true"
    ghost.setAttribute("aria-hidden", "true")
    ghost.style.position = "fixed"
    ghost.style.inset = "-1000px auto auto -1000px"
    ghost.style.width = `${element.getBoundingClientRect().width}px`
    ghost.style.pointerEvents = "none"
    document.body.appendChild(ghost)
    transfer.setDragImage(ghost, 12, 12)
    setTimeout(() => ghost.remove(), 0)
    setDrag({ server })
  }

  function dragOverGroup(event: DragEvent, server: ServerConnection.Key, element: HTMLElement) {
    if (!drag.server || drag.server === server) return

    event.preventDefault()
    event.stopPropagation()

    if (event.dataTransfer) event.dataTransfer.dropEffect = "move"

    const order = serverOrder()

    if (!order.includes(drag.server)) return

    const rect = element.getBoundingClientRect()
    const after = event.clientY > rect.top + rect.height / 2
    const next = order.filter((item) => item !== drag.server)
    const index = next.indexOf(server)

    if (index === -1) return

    next.splice(after ? index + 1 : index, 0, drag.server)

    if (next.every((item, index) => item === order[index])) return

    settings.appearance.setTabServerOrder(next)
  }

  function dropGroup(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    endGroupDrag()
  }

  function endGroupDrag() {
    setDrag("server", undefined)
  }

  // The dragged header can move while groups reorder, so its own dragend is not
  // guaranteed to reach this component. Clear from the window instead.
  createEffect(() => {
    if (!drag.server) return

    const clear = () => setDrag("server", undefined)
    const events = ["dragend", "drop", "mouseup", "pointerup", "blur"] as const

    for (const event of events) window.addEventListener(event, clear, true)

    onCleanup(() => {
      for (const event of events) window.removeEventListener(event, clear, true)
    })
  })

  return (
    <div
      data-slot={vertical() ? "vertical-tabs" : "titlebar-tabs"}
      data-orientation={vertical() ? "vertical" : "horizontal"}
      class="relative min-w-0"
      classList={{ "min-h-0 overflow-hidden": vertical() }}
    >
      <div
        ref={scrollRef}
        data-slot={vertical() ? "vertical-tabs-scroll" : "titlebar-tabs-scroll"}
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

            const { initialIndex, index } = source

            if (initialIndex === index) return

            const order = ordering().map(tabKey)
            const visible = visibleTabIds()
            const shown = new Set(visible)
            const next = arrayMove(order, initialIndex, index).filter((key) => shown.has(key))

            props.onReorder(mergeVisibleTabOrder(props.tabs.map(tabKey), visible, next))
          }}
        >
          <div
            data-titlebar-tab-list
            data-orientation={vertical() ? "vertical" : "horizontal"}
            class="flex w-full min-w-0"
            classList={{ "flex-row items-center": !vertical(), "flex-col items-stretch": vertical() }}
            ref={listRef}
          >
            <For each={ordering()}>
              {(tab) => {
                const id = tabKey(tab)
                let ref!: HTMLDivElement
                const orderIndex = () => ordering().findIndex((item) => tabKey(item) === id)
                const header = () => headers().get(id)
                const last = () => lastShown().get(tab.server) === id
                const concealed = () => !shownKeys().has(id)
                const groupSize = () => groups().get(tab.server)?.length ?? 0
                const groupCollapsed = () => !!collapsed[tab.server]
                const groupExpanded = () => !!expanded[tab.server]
                const element = () => ref
                tabRefs.set(id, element)
                onCleanup(() => {
                  if (tabRefs.get(id) === element) tabRefs.delete(id)
                })

                const serverCtx = useServerCtx(() => {
                  if (tab.type !== "session") return

                  return global.servers.list().find((item) => ServerConnection.key(item) === tab.server)
                })

                const entry =
                  tab.type === "session" ? (
                    <SessionTabEntry
                      tab={tab}
                      currentTab={props.currentTab}
                      id={id}
                      index={orderIndex()}
                      active={props.currentTab === tab}
                      orientation={vertical() ? "vertical" : "horizontal"}
                      concealed={concealed()}
                      serverCtx={serverCtx()}
                      onVisibleChange={(visible) => setVisibility(id, visible)}
                      onUnreadChange={(value) => setUnread(id, value)}
                      onNavigate={(element) => {
                        ref = element
                        props.onNavigate(tab, element)
                      }}
                      onClose={() => props.onClose(tab)}
                    />
                  ) : (
                    <DraftTabSlot
                      tab={tab}
                      id={id}
                      index={orderIndex()}
                      active={props.currentTab === tab}
                      orientation={vertical() ? "vertical" : "horizontal"}
                      concealed={concealed()}
                      title={language.t("session.tab.session")}
                      onNavigate={(element) => {
                        ref = element
                        props.onNavigate(tab, element)
                      }}
                      onClose={() => props.onClose(tab)}
                    />
                  )

                return (
                  <>
                    <Show when={header()}>
                      {(title) => (
                        <ServerGroupHeader
                          title={title()}
                          collapsed={groupCollapsed()}
                          dragging={drag.server === tab.server}
                          onAdd={() => newSessionInGroup(tab.server, title())}
                          onToggle={() => setCollapsed(tab.server, !collapsed[tab.server])}
                          onDragStart={(event, element) => startGroupDrag(event, tab.server, element)}
                          onDragEnd={endGroupDrag}
                          onDragOver={(event, element) => dragOverGroup(event, tab.server, element)}
                          onDrop={dropGroup}
                        />
                      )}
                    </Show>
                    {entry}
                    <Show when={grouped() && last()}>
                      <Show when={!groupCollapsed() && groupSize() > groupTabLimit}>
                        <ServerGroupFooter
                          expanded={groupExpanded()}
                          onClick={() => setExpanded(tab.server, !groupExpanded())}
                        />
                      </Show>
                    </Show>
                  </>
                )
              }}
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
