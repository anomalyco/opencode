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
  const sortable = useSortable({
    get id() {
      return props.id
    },
    get index() {
      return props.index
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
      style={{ display: props.concealed ? "none" : undefined }}
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
  const sortable = useSortable({
    get id() {
      return props.id
    },
    get index() {
      return props.index
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
      style={{ display: props.concealed ? "none" : undefined }}
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

export function TitlebarTabStrip(props: {
  orientation?: "horizontal" | "vertical"
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

  const [drag, setDrag] = createStore<{
    server?: ServerConnection.Key
    over?: ServerConnection.Key
    after: boolean
  }>({ after: false })

  const groupTabLimit = 3

  // A vertical strip with several servers reads as one flat list of identical
  // rows, so it groups by server. A stable sort keeps each server's own tab
  // order, so reordering inside a group still persists.
  const hasMultipleServers = createMemo(() => {
    const open = props.tabs.filter((tab) => tab.type === "draft" || visibility[tabKey(tab)])

    return new Set(open.map((tab) => tab.server)).size > 1
  })

  const grouped = createMemo(() => vertical() && hasMultipleServers())

  // The user's dragged group order wins; servers they have not moved keep the
  // app's own order after it.
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

  // Visible tabs per server, in display order. This is the input for both the
  // three-row limit and the collapse toggle.
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

    if (
      current &&
      !collapsed[current.server] &&
      groups().get(current.server)?.some((tab) => tabKey(tab) === tabKey(current))
    )
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

  // The first visible tab of each server carries its group header. Hidden tabs
  // are skipped so a header never floats above a row that is not drawn.
  const headers = createMemo(() => {
    if (!grouped()) return new Map<string, string>()

    const labels = new Map(servers.list.map((conn) => [ServerConnection.key(conn), servers.label(conn)]))

    return serverGroupHeaders(
      ordering(),
      (tab) => tab.type === "draft" || !!visibility[tabKey(tab)],
      labels,
    )
  })

  // Collapsed and over-limit tabs stay mounted but leave keyboard and drag
  // order, so shortcuts only visit rows the user can see.
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
  function newSessionInGroup(server: ServerConnection.Key) {
    const conn = servers.list.find((item) => ServerConnection.key(item) === server)

    if (!conn) return

    const ctx = global.ensureServerCtx(conn)
    const group = props.tabs.filter((tab) => tab.server === server)

    const directory =
      group.find((tab) => tab.type === "draft")?.directory ??
      group
        .flatMap((tab) =>
          tab.type === "session"
            ? [tabs.info[tabKey(tab)]?.directory ?? ctx.data.session.get(tab.sessionId)?.location.directory]
            : [],
        )
        .find(Boolean) ??
      ctx.projects.last()?.worktree ??
      ctx.projects.used()[0]?.worktree

    if (!directory) return

    ctx.projects.touch(directory)
    void tabs.newDraft({ server, directory })
  }

  function toggleGroup(server: ServerConnection.Key) {
    setCollapsed(server, !collapsed[server])
  }

  function showMore(server: ServerConnection.Key) {
    setExpanded(server, true)
  }

  function showLess(server: ServerConnection.Key) {
    setExpanded(server, false)
  }

  function startGroupDrag(event: DragEvent, server: ServerConnection.Key) {
    event.stopPropagation()
    event.dataTransfer?.setData("text/plain", server)

    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"

    setDrag({ server, over: undefined, after: false })
  }

  function dragOverGroup(event: DragEvent, server: ServerConnection.Key, element: HTMLElement) {
    if (!drag.server || drag.server === server) return

    event.preventDefault()
    event.stopPropagation()

    if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
    const rect = element.getBoundingClientRect()
    const after = event.clientY > rect.top + rect.height / 2

    if (drag.over !== server || drag.after !== after) setDrag({ over: server, after })
  }

  function dropGroup(event: DragEvent, target: ServerConnection.Key) {
    event.preventDefault()
    event.stopPropagation()

    const dragged = drag.server
    const after = drag.after
    setDrag({ server: undefined, over: undefined, after: false })

    if (!dragged || dragged === target) return

    const order = serverOrder()

    if (!order.includes(dragged)) return

    const next = order.filter((server) => server !== dragged)
    const index = next.indexOf(target)

    if (index === -1) return

    next.splice(after ? index + 1 : index, 0, dragged)
    settings.appearance.setTabServerOrder(next)
  }

  function endGroupDrag() {
    setDrag({ server: undefined, over: undefined, after: false })
  }

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
            const current = visibleTabIds()
            const source = event.operation.source

            if (event.canceled || !isSortable(source)) return

            const { initialIndex, index } = source

            if (initialIndex !== index) {
              props.onReorder(
                mergeVisibleTabOrder(
                  props.tabs.map(tabKey),
                  current,
                  arrayMove(current, source.initialIndex, source.index),
                ),
              )
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
            <For each={ordering()}>
              {(tab) => {
                const id = tabKey(tab)
                let ref!: HTMLDivElement
                const visibleIndex = () => visibleTabs().findIndex((item) => tabKey(item) === id)
                const header = () => headers().get(id)
                const last = () => lastShown().get(tab.server) === id
                const concealed = () => !shownKeys().has(id)
                const groupSize = () => groups().get(tab.server)?.length ?? 0
                const groupCollapsed = () => !!collapsed[tab.server]
                const groupExpanded = () => !!expanded[tab.server]
                const groupHidden = () => (groups().get(tab.server) ?? []).some((item) => !shownKeys().has(tabKey(item)))
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
                      index={visibleIndex()}
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
                      index={visibleIndex()}
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
                      {(title) => {
                        const toggleLabel = () =>
                          language.t(
                            groupCollapsed()
                              ? "session.tab.serverGroup.expand"
                              : "session.tab.serverGroup.collapse",
                            { server: title() },
                          )

                        return (
                          <div
                            data-slot="tab-server-group"
                            data-server={tab.server}
                            class="group/server relative mt-2 flex h-6 w-full shrink-0 items-center gap-0.5 overflow-hidden ps-0.5 pe-1.5 text-[12px] leading-4 font-medium text-v2-text-text-muted"
                            onDragOver={(event) => dragOverGroup(event, tab.server, event.currentTarget)}
                            onDrop={(event) => dropGroup(event, tab.server)}
                          >
                            <button
                              type="button"
                              draggable={true}
                              data-action="tab-server-group-drag"
                              data-server={tab.server}
                              aria-label={language.t("session.tab.serverGroup.drag", { server: title() })}
                              title={language.t("session.tab.serverGroup.drag", { server: title() })}
                              class="flex size-4 shrink-0 cursor-grab items-center justify-center rounded-[4px] text-v2-text-text-faint opacity-0 transition-opacity group-hover/server:opacity-100 focus-visible:opacity-100 focus-visible:outline-none active:cursor-grabbing"
                              onDragStart={(event) => startGroupDrag(event, tab.server)}
                              onDragEnd={endGroupDrag}
                            >
                              <Icon name="outline-dots" size="small" class="rotate-90" />
                            </button>
                            <bdi class="min-w-0 truncate">{title()}</bdi>
                            <div class="ms-auto flex shrink-0 items-center gap-0.5">
                              <button
                                type="button"
                                data-action="tab-server-group-add"
                                data-server={tab.server}
                                aria-label={language.t("session.tab.newOnServer", { server: title() })}
                                title={language.t("session.tab.newOnServer", { server: title() })}
                                class="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
                                onClick={() => newSessionInGroup(tab.server)}
                              >
                                <Icon name="plus" size="small" />
                              </button>
                              <button
                                type="button"
                                data-action="tab-server-group-toggle"
                                data-server={tab.server}
                                aria-label={toggleLabel()}
                                aria-expanded={!groupCollapsed()}
                                title={toggleLabel()}
                                class="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
                                onClick={() => toggleGroup(tab.server)}
                              >
                                <Icon
                                  name="outline-chevron-down"
                                  size="small"
                                  class={groupCollapsed() ? "-rotate-90" : ""}
                                />
                              </button>
                            </div>
                            <Show when={drag.server && drag.over === tab.server && drag.server !== tab.server}>
                              <span
                                class="pointer-events-none absolute inset-x-1 h-0.5 rounded bg-v2-icon-icon-accent"
                                classList={{ "top-0": !drag.after, "bottom-0": drag.after }}
                              />
                            </Show>
                          </div>
                        )
                      }}
                    </Show>
                    {entry}
                    <Show when={grouped() && last()}>
                      <Show
                        when={!groupCollapsed() && (groupExpanded() ? groupSize() > groupTabLimit : groupHidden())}
                      >
                        <button
                          type="button"
                          data-action={
                            groupExpanded() ? "tab-server-group-show-less" : "tab-server-group-show-more"
                          }
                          data-server={tab.server}
                          class="flex h-6 w-full shrink-0 items-center rounded-[6px] px-1.5 text-[12px] leading-4 font-medium text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
                          onClick={() => (groupExpanded() ? showLess(tab.server) : showMore(tab.server))}
                        >
                          {language.t(
                            groupExpanded()
                              ? "session.tab.serverGroup.showLess"
                              : "session.tab.serverGroup.showMore",
                          )}
                        </button>
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
