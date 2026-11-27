import {
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  For,
  mapArray,
  type JSX,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Key } from "@solid-primitives/keyed"
import { createStore } from "solid-js/store"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis, RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { arrayMove } from "@/runtime/array-move"
import { tabHref, tabKey, type SessionTab, type Tab } from "@/shell/tabs/tabs"
import { ServerConnection } from "@/runtime/server/registry"
import { DraftTabItem, TabNavItem, type TabCloseActions } from "@/shell/titlebar/tab-nav"
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
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { sessionMayHoldRequests, sessionTreeIDs } from "@/session/requests/session-request-tree"
import { sessionTitle } from "@/session/title"
import { errorMessage } from "@/shell/layout/helpers"
import { notifySessionTabsRemoved } from "./session-events"
import {
  INITIAL_SESSION_TAB_LOADS_STATE,
  selectSessionTabView,
  transitionSessionTabLoads,
  type SessionTabLoadsEffect,
  type SessionTabLoadsEvent,
  type SessionTabView,
} from "./tab-load-machine"
import { setSidebarUnread } from "@/shell/sidebar-peek"
import { createSideFocus } from "@/runtime/plugin/closed-tabs"
import { createEventListener } from "@solid-primitives/event-listener"
import {
  INITIAL_TAB_HINTS_STATE,
  selectTabHintsShown,
  transitionTabHints,
  type TabHintsEffect,
  type TabHintsEvent,
} from "./tab-hints-machine"
import type { SessionInfo } from "@opencode/client/promise"

const IS_MAC = typeof navigator !== "undefined" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

export const previousSessionCommand = { id: "session.previous", keybind: "alt+arrowup" }

export const nextSessionCommand = { id: "session.next", keybind: "alt+arrowdown" }

// A row the For loop still renders for a tab just removed from the strip.
const hiddenTabView: SessionTabView = {
  phase: "loading",
  visible: false,
  session: undefined,
  fallbackTitle: "none",
  fallbackDirectory: undefined,
}

function SessionTabSlot(
  props: TabCloseActions & {
    tab: SessionTab
    id: string
    index: number
    group?: string
    footer?: JSX.Element
    label?: string
    hideAvatar?: boolean
    active: boolean
    orientation: "horizontal" | "vertical"
    session: SessionInfo | undefined
    preparing: boolean
    unread: boolean
    attention: boolean
    loading: boolean
    shortcut?: number
    fallbackTitle?: string
    fallbackDirectory?: string
    muted?: boolean
    menuItems?: () => JSX.Element
    customDrag?: boolean
    dragSource?: boolean
    offsetY?: number
    laneShift?: "in" | "out"
    combineColor?: string
    combineOrder?: "before" | "after"
    contextMenuExtra?: () => JSX.Element
    onDelete: () => void
    onNavigate: (element: HTMLDivElement) => void
  },
) {
  const sortable = useSortable({
    get id() {
      return props.id
    },
    get index() {
      return props.index
    },
    group: "tab-items",
    // Rows only sort among rows of the same group, so a drag never crosses into another section.
    get type() {
      return props.group
    },
    get accept() {
      return props.group
    },
    get disabled() {
      return !!props.customDrag
    },
  })

  let ref!: HTMLDivElement

  return (
    <div
      ref={(el) => {
        if (!props.customDrag) sortable.ref(el)
      }}
      data-titlebar-tab-slot
      data-tab-key={props.id}
      data-active={props.active}
      data-drag-source={props.dragSource ? "true" : undefined}
      data-lane-shift={props.laneShift}
      data-combine-target={props.combineColor ? "true" : undefined}
      data-combine-order={props.combineOrder}
      data-group-color={props.combineColor}
      data-orientation={props.orientation}
      style={props.offsetY ? { transform: `translate3d(0, ${props.offsetY}px, 0)` } : undefined}
      class="relative flex"
      classList={{
        "w-56 min-w-7 max-w-56 flex-shrink": props.orientation === "horizontal",
        "w-full shrink-0": props.orientation === "vertical",
        "flex-col": !!props.footer,
      }}
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
        shortcut={props.shortcut}
        label={props.label}
        hideAvatar={props.hideAvatar}
        fallbackTitle={props.fallbackTitle}
        fallbackDirectory={props.fallbackDirectory}
        muted={props.muted}
        menuItems={props.menuItems}
        onDelete={props.onDelete}
        onNavigate={() => props.onNavigate(ref)}
        onClose={props.onClose}
        onCloseOthers={props.onCloseOthers}
        onCloseAfter={props.onCloseAfter}
        active={props.active}
        dragging={props.customDrag ? !!props.dragSource : sortable.isDragSource()}
        orientation={props.orientation}
        contextMenuExtra={props.contextMenuExtra}
      />
      {props.footer}
    </div>
  )
}

function SessionTabEntry(
  props: TabCloseActions & {
    tab: SessionTab
    id: string
    index: number
    group?: string
    footer?: JSX.Element
    label?: string
    hideAvatar?: boolean
    active: boolean
    highlightActive?: boolean
    orientation: "horizontal" | "vertical"
    serverCtx: ServerCtx | undefined
    view: SessionTabView
    status: SessionTabStatus | undefined
    shortcut?: number
    muted?: boolean
    menuItems?: () => JSX.Element
    customDrag?: boolean
    dragSource?: boolean
    offsetY?: number
    laneShift?: "in" | "out"
    combineColor?: string
    combineOrder?: "before" | "after"
    contextMenuExtra?: () => JSX.Element
    onNavigate: (element: HTMLDivElement) => void
  },
) {
  const tabs = useTabs()
  const language = useLanguage()
  const dialog = useDialog()
  const persisted = createMemo(() => tabs.info[props.id])
  const session = () => props.view.session

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

  return (
    <Show when={props.view.visible}>
      <SessionTabSlot
        tab={props.tab}
        id={props.id}
        index={props.index}
        group={props.group}
        footer={props.footer}
        label={props.label}
        hideAvatar={props.hideAvatar}
        active={props.active && props.highlightActive !== false}
        orientation={props.orientation}
        session={session()}
        preparing={props.view.phase === "preparing"}
        unread={props.status?.unread() ?? false}
        attention={props.status?.attention() ?? false}
        loading={props.status?.loading() ?? false}
        shortcut={props.shortcut}
        fallbackTitle={
          {
            session: language.t("session.tab.session"),
            persisted: persisted()?.title,
            unknown: language.t("session.tab.unknown"),
            none: undefined,
          }[props.view.fallbackTitle]
        }
        fallbackDirectory={props.view.fallbackDirectory}
        muted={props.muted}
        menuItems={props.menuItems}
        customDrag={props.customDrag}
        dragSource={props.dragSource}
        offsetY={props.offsetY}
        laneShift={props.laneShift}
        combineColor={props.combineColor}
        combineOrder={props.combineOrder}
        contextMenuExtra={props.contextMenuExtra}
        onDelete={() => dialog.show(() => <DeleteDialog />)}
        onNavigate={props.onNavigate}
        onClose={props.onClose}
        onCloseOthers={props.onCloseOthers}
        onCloseAfter={props.onCloseAfter}
      />
    </Show>
  )
}

type SessionTabStatus = ReturnType<typeof createSessionTabTracker>

/**
 * What an open session tab tracks whether or not its row shows (a collapsed group hides it): its status, the
 * background load that keeps that status current, and the info and composer state the tab keeps.
 */
function createSessionTabTracker(input: {
  tab: SessionTab
  key: string
  index: () => number
  active: () => boolean
  muted: () => boolean
  currentTab: () => Tab | undefined
  view: () => SessionTabView
}) {
  const global = useGlobal()
  const tabs = useTabs()
  const ctx = () => global.serverCtx(input.tab.server)
  const session = () => input.view().session

  const status = useSessionTabAvatarState(
    () => input.tab.server,
    () => input.tab.sessionId,
    () => true,
  )

  createEffect(() => {
    const server = ctx()
    const id = input.tab.sessionId
    const phase = input.view().phase

    if (
      phase === "preparing" ||
      phase === "missing" ||
      !server ||
      input.active() ||
      (!session() && !tabs.info[input.key]?.title) ||
      server.sdk.connection.status() !== "connected"
    )
      return

    const current = input.currentTab()

    if (current?.type === "session" && current.server === input.tab.server && current.sessionId !== id) {
      const active = server.data.session.get(current.sessionId)

      if (
        !active ||
        server.data.location.agent.list(active.location) === undefined ||
        server.data.location.provider.list(active.location) === undefined ||
        server.data.location.model.list(active.location) === undefined ||
        server.data.location.skill.list(active.location) === undefined
      )
        return
    }

    const timer = window.setTimeout(() => syncInactiveSession(server, id), 300 + input.index() * 50)

    onCleanup(() => window.clearTimeout(timer))
  })

  createEffect(() => {
    const value = session()

    if (!value) return
    const server = ctx()
    tabs.rememberSessionInfo(
      input.tab,
      value,
      server?.data.session.message.list(value.id).some((message) => message.type === "user") ?? false,
    )

    if (!server) return
    createTabComposerState(tabs, input.tab, server.sdk.scope, {
      dir: base64Encode(value.location.directory),
      id: value.id,
    })
  })

  return {
    // A busy session shows its progress indicator instead of the unread dot; a muted one shows neither.
    unread: createMemo(() => status.unread() && !status.loading() && !input.muted()),
    attention: status.attention,
    loading: status.loading,
  }
}

/**
 * The keyboard shortcuts over a sidebar's session rows, in display order: ⌘1-9 pick a row (numbered while ⌘ is held),
 * ⌥↑/⌥↓ step through rows, and ⇧⌥↑/⇧⌥↓ step to the next unread one. Returns whether the number hints show.
 */
export function createSessionRowNavigation(input: {
  keys: () => string[]
  current: () => string | undefined
  unread: (key: string) => boolean
  /** `reveal` asks to scroll the picked row into view. */
  navigate: (key: string, reveal: boolean) => void
}) {
  const command = useCommand()
  const language = useLanguage()

  const selectAdjacent = (offset: -1 | 1, include?: (key: string) => boolean) => {
    const key = adjacentTabKey(input.keys(), input.current(), offset, include)

    if (key) input.navigate(key, false)
  }

  command.register("titlebar-tab-cycle", () => [
    {
      id: `tab.prev`,
      category: "tab",
      title: "",
      keybind: `mod+option+ArrowLeft,ctrl+shift+tab`,
      hidden: true,
      onSelect: () => selectAdjacent(-1),
    },
    {
      id: `tab.next`,
      category: "tab",
      title: "",
      keybind: `mod+option+ArrowRight,ctrl+tab`,
      hidden: true,
      onSelect: () => selectAdjacent(1),
    },
    {
      ...previousSessionCommand,
      category: language.t("command.category.session"),
      title: language.t("command.session.previous"),
      onSelect: () => selectAdjacent(-1),
    },
    {
      ...nextSessionCommand,
      category: language.t("command.category.session"),
      title: language.t("command.session.next"),
      onSelect: () => selectAdjacent(1),
    },
    {
      id: "session.previous.unseen",
      category: language.t("command.category.session"),
      title: language.t("command.session.previous.unseen"),
      keybind: "shift+alt+arrowup",
      onSelect: () => selectAdjacent(-1, input.unread),
    },
    {
      id: "session.next.unseen",
      category: language.t("command.category.session"),
      title: language.t("command.session.next.unseen"),
      keybind: "shift+alt+arrowdown",
      onSelect: () => selectAdjacent(1, input.unread),
    },
  ])

  // One registration numbers the visible rows, so a reorder, a close or a row coming into view never leaves two rows
  // holding the same number while their owners update.
  command.register("titlebar-tab-numbers", () =>
    input
      .keys()
      .slice(0, 9)
      .map((key, index) => ({
        id: `tab.${index + 1}`,
        category: "tab",
        title: "",
        keybind: `mod+${index + 1}`,
        hidden: true,
        onSelect: () => input.navigate(key, true),
      })),
  )

  // Inside the side panel the same keys pick side tabs, so the numbers stay hidden there.
  const [hints, setHints] = createSignal(INITIAL_TAB_HINTS_STATE)
  const side = createSideFocus()
  let hintTimer: ReturnType<typeof setTimeout> | undefined

  const dispatchHints = (event: TabHintsEvent) => {
    const next = transitionTabHints(hints(), event)

    if (next.state !== hints()) setHints(next.state)
    next.effects.forEach(runHintsEffect)
  }

  function runHintsEffect(effect: TabHintsEffect) {
    clearTimeout(hintTimer)

    if (effect.type === "delay.clear") return
    hintTimer = setTimeout(() => dispatchHints({ type: "delay.elapsed", attempt: effect.attempt }), effect.delayMs)
  }

  const held = (event: KeyboardEvent | PointerEvent) => ({
    mod: IS_MAC ? event.metaKey : event.ctrlKey,
    extra: event.shiftKey || event.altKey || (IS_MAC ? event.ctrlKey : event.metaKey),
  })

  createEventListener(
    window,
    "keydown",
    (event) =>
      dispatchHints({
        type: "key.down",
        key:
          event.key === (IS_MAC ? "Meta" : "Control")
            ? "mod"
            : /^Digit[1-9]$/.test(event.code) || /^[1-9]$/.test(event.key)
              ? "digit"
              : "other",
        ...held(event),
      }),
    { capture: true },
  )
  createEventListener(window, "keyup", (event) => dispatchHints({ type: "modifiers", ...held(event) }), {
    capture: true,
  })
  createEventListener(
    window,
    ["pointermove", "pointerdown"],
    (event) => dispatchHints({ type: "modifiers", ...held(event) }),
    { capture: true, passive: true },
  )
  createEventListener(window, "blur", () => dispatchHints({ type: "window.left" }))
  createEventListener(document, "visibilitychange", () => {
    if (document.hidden) dispatchHints({ type: "window.left" })
  })
  onCleanup(() => dispatchHints({ type: "disposed" }))

  return () => selectTabHintsShown(hints()) && !side.focused()
}

/** Loads what an unselected session row shows: metadata, and the inbox and requests that keep it busy or waiting. */
export function syncInactiveSession(ctx: ServerCtx, id: string) {
  const requestIDs = [...new Set([id, ...ctx.data.session.family(id)])].filter((sessionID) =>
    sessionMayHoldRequests(ctx.data, sessionID),
  )

  void Promise.allSettled([
    ctx.data.session.sync(id, { children: true }),
    // The selected timeline loads the transcript; inactive tabs need metadata and the inbox,
    // whose waiting work keeps the tab busy. Reading a permission or form boots the session's
    // location on the server, so only sessions that may hold one are read.
    ...requestIDs.flatMap((sessionID) => [
      ctx.data.session.permission.sync(sessionID),
      ctx.data.session.form.sync(sessionID),
    ]),
    ctx.data.session.pending.sync(id),
  ])
}

function DraftTabSlot(
  props: TabCloseActions & {
    tab: Extract<Tab, { type: "draft" }>
    id: string
    index: number
    group?: string
    footer?: JSX.Element
    label?: string
    active: boolean
    orientation: "horizontal" | "vertical"
    title: string
    shortcut?: number
    customDrag?: boolean
    dragSource?: boolean
    offsetY?: number
    laneShift?: "in" | "out"
    combineColor?: string
    combineOrder?: "before" | "after"
    contextMenuExtra?: () => JSX.Element
    onNavigate: (element: HTMLDivElement) => void
  },
) {
  const sortable = useSortable({
    get id() {
      return props.id
    },
    get index() {
      return props.index
    },
    group: "tab-items",
    // Rows only sort among rows of the same group, so a drag never crosses into another section.
    get type() {
      return props.group
    },
    get accept() {
      return props.group
    },
    get disabled() {
      return !!props.customDrag
    },
  })

  let ref!: HTMLDivElement

  return (
    <div
      ref={(el) => {
        if (!props.customDrag) sortable.ref(el)
      }}
      data-titlebar-tab-slot
      data-tab-key={props.id}
      data-active={props.active}
      data-drag-source={props.dragSource ? "true" : undefined}
      data-lane-shift={props.laneShift}
      data-combine-target={props.combineColor ? "true" : undefined}
      data-combine-order={props.combineOrder}
      data-group-color={props.combineColor}
      data-orientation={props.orientation}
      style={props.offsetY ? { transform: `translate3d(0, ${props.offsetY}px, 0)` } : undefined}
      class="relative flex"
      classList={{
        "w-56 min-w-7 max-w-56 flex-shrink": props.orientation === "horizontal",
        "w-full shrink-0": props.orientation === "vertical",
        "flex-col": !!props.footer,
      }}
    >
      <DraftTabItem
        ref={(el) => {
          ref = el
        }}
        href={tabHref(props.tab)}
        title={props.title}
        shortcut={props.shortcut}
        label={props.label}
        onNavigate={() => props.onNavigate(ref)}
        onClose={props.onClose}
        onCloseOthers={props.onCloseOthers}
        onCloseAfter={props.onCloseAfter}
        active={props.active}
        dragging={props.customDrag ? !!props.dragSource : sortable.isDragSource()}
        orientation={props.orientation}
        contextMenuExtra={props.contextMenuExtra}
      />
      {props.footer}
    </div>
  )
}

export type TabStripSection = {
  key: string
  /** Open tabs shown in this section, in display order. */
  tabs: Tab[]
  header?: JSX.Element
  footer?: JSX.Element
  /** The header already names the project, so session tabs leave out their project avatar. */
  hideAvatars?: boolean
  /** A divider before the section, setting it apart from the one before. */
  separator?: boolean
  /** Optional browser-style tab group chrome for vertical and horizontal strips. */
  groupMeta?: {
    color: string
    collapsed: boolean
    ungrouped?: boolean
  }
}

export type CustomVerticalDragBinding = {
  isDraggingStrip: () => boolean
  isDraggingTab: (key: string) => boolean
  isDraggingGroup: (groupKey: string) => boolean
  isDropInsideGroup: (groupKey: string) => boolean
  tabTransformY: (key: string) => number
  tabLaneShift: (key: string) => "in" | "out" | undefined
  groupTransformY: (groupKey: string) => number
  groupRailAdjustment: (groupKey: string) => { top: number; bottom: number; empty: boolean } | undefined
  combineOfTab: (key: string) => { color: string; sourceOrder: "before" | "after" } | undefined
  onPointerDown: (event: PointerEvent, listEl: HTMLDivElement, scrollEl: HTMLDivElement) => void
  onScroll: (listEl: HTMLDivElement) => void
}

export type TabStripLeading = {
  content: JSX.Element
  /** Row keys in display order, in `tabKey` form so the current tab can match one. */
  keys: string[]
  unread: (key: string) => boolean
  navigate: (key: string, reveal: boolean) => void
}

export function TitlebarTabStrip(props: {
  orientation?: "horizontal" | "vertical"
  highlightActive?: boolean
  tabs: Tab[]
  /** Groups the rendered tabs. Tabs in no section stay open but are not shown. Top tabs show no headers or footers. */
  sections?: TabStripSection[]
  customVerticalDrag?: CustomVerticalDragBinding
  tabContextMenu?: (tab: Tab) => JSX.Element | undefined
  /** Vertical only: extra content rendered right after a tab row (e.g. its subagent sessions). */
  tabFooter?: (tab: Tab) => JSX.Element | undefined
  /** Vertical only: a faint trailing label on a tab row (e.g. its server). */
  tabLabel?: (tab: Tab) => string | undefined
  /** Vertical only: menu items shown above a session tab's own. */
  tabMenu?: (tab: SessionTab) => JSX.Element
  /** Vertical only: whether a session tab is muted, which swaps its unread dot for a muted mark. */
  tabMuted?: (tab: SessionTab) => boolean
  /** Rows that share the tabs' shortcuts and are numbered first (e.g. pinned sessions). Side tabs only render `content`. */
  leading?: TabStripLeading
  /** Open tabs shown elsewhere (e.g. pinned), kept in the tab order but not rendered here. */
  hidden?: (tab: Tab) => boolean
  currentTab: Tab | undefined
  onNavigate: (tab: Tab, el?: HTMLDivElement) => void
  onClose: (tab: Tab) => void
  onCloseTabs: (tabs: Tab[], keep: Tab) => void
  onReorder: (keys: string[]) => void
}) {
  const global = useGlobal()
  const language = useLanguage()
  const appTabs = useTabs()
  const vertical = () => props.orientation === "vertical"
  const sections = () => props.sections
  const customDrag = () => (vertical() ? props.customVerticalDrag : undefined)

  const displayTabs = createMemo(
    () =>
      sections()?.flatMap((section) => section.tabs) ??
      (props.hidden ? props.tabs.filter((tab) => !props.hidden?.(tab)) : props.tabs),
  )

  const sectionOf = createMemo(
    () => new Map(sections()?.flatMap((section) => section.tabs.map((tab) => [tabKey(tab), section.key] as const))),
  )

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
  const [tabLoads, setTabLoads] = createSignal(INITIAL_SESSION_TAB_LOADS_STATE)
  const loadTimers = new Map<number, ReturnType<typeof setTimeout>>()

  const dispatchTabLoads = (event: SessionTabLoadsEvent) =>
    untrack(() => {
      const previous = tabLoads()
      const next = transitionSessionTabLoads(previous, event)

      if (next.state !== previous) setTabLoads(next.state)
      next.effects.forEach(runTabLoadEffect)
    })

  function runTabLoadEffect(effect: SessionTabLoadsEffect) {
    if (effect.type === "load.clear") {
      clearTimeout(loadTimers.get(effect.attempt))
      loadTimers.delete(effect.attempt)

      return
    }

    const ctx = global.serverCtx(effect.server)
    const connected = () => global.serverCtx(effect.server)?.sdk.connection.status() === "connected"

    loadTimers.set(
      effect.attempt,
      setTimeout(
        () =>
          dispatchTabLoads({
            type: "load.timed-out",
            key: effect.key,
            attempt: effect.attempt,
            connected: connected(),
          }),
        effect.timeoutMs,
      ),
    )

    const settle = () => {
      const current = global.serverCtx(effect.server)

      dispatchTabLoads({
        type: "load.settled",
        key: effect.key,
        attempt: effect.attempt,
        cached: !!current?.data.session.get(effect.sessionID),
        missing: !!current?.data.session.missing(effect.sessionID),
        connected: connected(),
      })
    }

    void (ctx?.data.session.sync(effect.sessionID) ?? Promise.resolve()).then(settle, settle)
  }

  // Runs before the visible order below reads it, so a session tab counts as visible in the same pass it appears.
  createComputed(() => {
    const tabs = props.tabs.flatMap((tab) => {
      if (tab.type !== "session") return []
      const ctx = global.serverCtx(tab.server)
      const key = tabKey(tab)

      return [
        {
          key,
          server: tab.server,
          sessionID: tab.sessionId,
          active: props.currentTab === tab,
          pending: !!appTabs.pendingSession(tab.server, tab.sessionId),
          cached: !!ctx?.data.session.get(tab.sessionId),
          missing: !!ctx?.data.session.missing(tab.sessionId),
          persistedTitle: !!appTabs.info[key]?.title,
          serverReady: !!ctx,
          connected: ctx?.sdk.connection.status() === "connected",
        },
      ]
    })

    dispatchTabLoads({ type: "sync", tabs })
  })

  onCleanup(() => dispatchTabLoads({ type: "disposed" }))

  const views = createMemo(() => {
    const state = tabLoads()

    return new Map(
      props.tabs.flatMap((tab) => {
        if (tab.type !== "session") return []
        const ctx = global.serverCtx(tab.server)
        const key = tabKey(tab)

        return [
          [
            key,
            selectSessionTabView(state, key, {
              active: props.currentTab === tab,
              pending: appTabs.pendingSession(tab.server, tab.sessionId),
              session: ctx?.data.session.get(tab.sessionId),
              missing: !!ctx?.data.session.missing(tab.sessionId),
              persisted: appTabs.info[key],
              serverReady: !!ctx,
            }),
          ] as const,
        ]
      }),
    )
  })

  const visibleTabs = createMemo(() =>
    displayTabs().filter((tab) => tab.type === "draft" || !!views().get(tabKey(tab))?.visible),
  )

  const visibleTabIds = () => visibleTabs().map(tabKey)

  // A section's divider shows only when a row renders on each side of it, not beside tabs still loading.
  const dividedSections = createMemo(() => {
    const visible = new Set(visibleTabIds())

    const rendered = (section: TabStripSection) =>
      (vertical() && !!section.header) || section.tabs.some((tab) => visible.has(tabKey(tab)))

    return new Set(
      (sections() ?? []).flatMap((section, index, list) =>
        section.separator && rendered(section) && list.slice(0, index).some(rendered) ? [section.key] : [],
      ),
    )
  })

  // Every session tab this strip owns, shown or hidden in a collapsed group, keeps its status and background load.
  const ownedSessionTabs = createMemo(() =>
    props.tabs.filter((tab): tab is SessionTab => tab.type === "session" && !props.hidden?.(tab)),
  )

  const trackers = createMemo(
    mapArray(ownedSessionTabs, (tab, index) => {
      const key = tabKey(tab)

      return [
        key,
        createSessionTabTracker({
          tab,
          key,
          index,
          active: () => props.currentTab === tab,
          muted: () => (vertical() ? !!props.tabMuted?.(tab) : false),
          currentTab: () => props.currentTab,
          view: () => views().get(key) ?? hiddenTabView,
        }),
      ] as const
    }),
  )

  const trackerByKey = createMemo(() => new Map(trackers()))

  const unread = (key: string) => !!trackerByKey().get(key)?.unread()

  const leading = () => props.leading

  const leadingKeys = () => leading()?.keys ?? []

  // Tells the closed sidebar's toggle whether any row here shows its unread dot, which the current tab never does.
  createEffect(() => {
    if (!vertical()) return
    const current = props.currentTab ? tabKey(props.currentTab) : undefined

    setSidebarUnread(
      props.tabs.some((tab) => tab !== props.currentTab && unread(tabKey(tab))) ||
        leadingKeys().some((key) => key !== current && !!leading()?.unread(key)),
    )
    onCleanup(() => setSidebarUnread(false))
  })

  // Number keys reveal the tab they pick; the other shortcuts follow the selection.
  const tabRefs = new Map<string, () => HTMLDivElement | undefined>()

  const hints = createSessionRowNavigation({
    keys: () => [...leadingKeys(), ...visibleTabIds()],
    current: () => (props.currentTab ? tabKey(props.currentTab) : undefined),
    unread: (key) => unread(key) || (leadingKeys().includes(key) && !!leading()?.unread(key)),
    navigate: (key, reveal) => {
      if (leadingKeys().includes(key)) {
        leading()?.navigate(key, reveal)

        return
      }

      const tab = props.tabs.find((item) => tabKey(item) === key)

      if (tab) props.onNavigate(tab, reveal ? tabRefs.get(key)?.() : undefined)
    },
  })

  const shortcut = (index: number) => {
    if (index < 0) return
    const position = index + leadingKeys().length

    return position < 9 ? position + 1 : undefined
  }

  function renderTab(tab: Tab, section?: TabStripSection) {
    const id = tabKey(tab)

    const group = section ? `tab:${section.key}` : undefined
    const menuExtra = props.tabContextMenu ? () => props.tabContextMenu!(tab) : undefined
    let ref!: HTMLDivElement
    const visibleIndex = () => visibleTabs().findIndex((item) => tabKey(item) === id)

    const others = () => visibleTabs().filter((item) => tabKey(item) !== id)

    const after = () => visibleTabs().slice(visibleIndex() + 1)

    const closeOthers = () => props.onCloseTabs(others(), tab)

    const closeAfter = () => props.onCloseTabs(after(), tab)

    const element = () => ref
    tabRefs.set(id, element)
    onCleanup(() => {
      if (tabRefs.get(id) === element) tabRefs.delete(id)
    })

    const serverCtx = useServerCtx(() => {
      if (tab.type !== "session") return

      return global.servers.list().find((item) => ServerConnection.key(item) === tab.server)
    })

    const footer = createMemo(() => (vertical() ? props.tabFooter?.(tab) : undefined))

    const label = () => (vertical() ? props.tabLabel?.(tab) : undefined)

    if (tab.type === "session") {
      return (
        <SessionTabEntry
          tab={tab}
          id={id}
          index={visibleIndex()}
          group={group}
          footer={footer()}
          label={label()}
          hideAvatar={section?.hideAvatars}
          active={props.currentTab === tab}
          highlightActive={props.highlightActive}
          orientation={vertical() ? "vertical" : "horizontal"}
          serverCtx={serverCtx()}
          view={views().get(id) ?? hiddenTabView}
          status={trackerByKey().get(id)}
          shortcut={shortcut(visibleIndex())}
          muted={vertical() ? props.tabMuted?.(tab) : undefined}
          menuItems={vertical() && props.tabMenu ? () => props.tabMenu?.(tab) : undefined}
          customDrag={!!customDrag()}
          dragSource={customDrag()?.isDraggingTab(id)}
          offsetY={customDrag()?.tabTransformY(id)}
          laneShift={customDrag()?.tabLaneShift(id)}
          combineColor={customDrag()?.combineOfTab(id)?.color}
          combineOrder={customDrag()?.combineOfTab(id)?.sourceOrder}
          contextMenuExtra={menuExtra}
          onNavigate={(element) => {
            ref = element
            props.onNavigate(tab, element)
          }}
          onClose={() => props.onClose(tab)}
          onCloseOthers={others().length ? closeOthers : undefined}
          onCloseAfter={after().length ? closeAfter : undefined}
        />
      )
    }

    return (
      <DraftTabSlot
        tab={tab}
        id={id}
        index={visibleIndex()}
        group={group}
        footer={footer()}
        label={label()}
        active={props.currentTab === tab && props.highlightActive !== false}
        orientation={vertical() ? "vertical" : "horizontal"}
        title={language.t("session.tab.session")}
        shortcut={shortcut(visibleIndex())}
        customDrag={!!customDrag()}
        dragSource={customDrag()?.isDraggingTab(id)}
        offsetY={customDrag()?.tabTransformY(id)}
        laneShift={customDrag()?.tabLaneShift(id)}
        combineColor={customDrag()?.combineOfTab(id)?.color}
        combineOrder={customDrag()?.combineOfTab(id)?.sourceOrder}
        contextMenuExtra={menuExtra}
        onNavigate={(element) => {
          ref = element
          props.onNavigate(tab, element)
        }}
        onClose={() => props.onClose(tab)}
        onCloseOthers={others().length ? closeOthers : undefined}
        onCloseAfter={after().length ? closeAfter : undefined}
      />
    )
  }

  const renderList = () => (
    <div
      data-titlebar-tab-list
      data-focus-scope
      data-orientation={vertical() ? "vertical" : "horizontal"}
      data-dragging={customDrag()?.isDraggingStrip() ? "true" : undefined}
      class="relative flex w-full min-w-0"
      classList={{ "flex-row items-center": !vertical(), "flex-col items-stretch": vertical() }}
      ref={listRef}
      onPointerDown={(event) => {
        customDrag()?.onPointerDown(event, listRef, scrollRef)
      }}
    >
      <Show when={sections()} fallback={<For each={displayTabs()}>{(tab) => renderTab(tab)}</For>}>
        {(list) => (
          <Key each={list()} by={(section) => section.key}>
            {(section) => (
              <Show
                when={section().groupMeta && !section().groupMeta?.ungrouped ? section().groupMeta : undefined}
                fallback={
                  <>
                    <Show when={dividedSections().has(section().key)}>
                      <div
                        role="separator"
                        aria-hidden="true"
                        data-tab-group-separator
                        class="shrink-0 bg-v2-border-border-muted"
                        classList={{ "h-4 w-px": !vertical(), "mx-2 my-2 h-px": vertical() }}
                      />
                    </Show>
                    {vertical() ? section().header : undefined}
                    <For each={section().tabs}>{(tab) => renderTab(tab, section())}</For>
                    {vertical() ? section().footer : undefined}
                  </>
                }
              >
                {(meta) => {
                  const groupKey = () => section().key
                  const railAdj = () => customDrag()?.groupRailAdjustment(groupKey())

                  const groupStyle = (): JSX.CSSProperties | undefined => {
                    const dy = customDrag()?.groupTransformY(groupKey()) ?? 0
                    const rail = railAdj()

                    if (!dy && !rail) return undefined
                    const style: JSX.CSSProperties = {}

                    if (dy) style.transform = `translate3d(0, ${dy}px, 0)`

                    if (rail) {
                      style["--group-rail-top"] = `${rail.top}px`
                      style["--group-rail-bottom"] = `${rail.bottom}px`
                    }

                    return style
                  }

                  return (
                    <div
                      data-tab-group
                      data-group-key={groupKey()}
                      data-group-color={meta().color}
                      data-collapsed={meta().collapsed ? "" : undefined}
                      data-dragging={customDrag()?.isDraggingGroup(groupKey()) ? "true" : undefined}
                      data-drop-inside={customDrag()?.isDropInsideGroup(groupKey()) ? "true" : undefined}
                      data-rail-empty={railAdj()?.empty ? "true" : undefined}
                      data-orientation={vertical() ? "vertical" : "horizontal"}
                      style={groupStyle()}
                    >
                      {section().header}
                      <Show when={section().tabs.length > 0}>
                        <div data-tab-group-items data-orientation={vertical() ? "vertical" : "horizontal"}>
                          <For each={section().tabs}>{(tab) => renderTab(tab, section())}</For>
                        </div>
                      </Show>
                      {section().footer}
                    </div>
                  )
                }}
              </Show>
            )}
          </Key>
        )}
      </Show>
    </div>
  )

  return (
    <div
      data-slot={vertical() ? "vertical-tabs" : "titlebar-tabs"}
      data-orientation={vertical() ? "vertical" : "horizontal"}
      data-shortcut-hints={hints() ? "" : undefined}
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
          if (vertical()) {
            measureFade()
            customDrag()?.onScroll(listRef)
          }
        }}
      >
        {vertical() ? leading()?.content : undefined}
        <Show
          when={!customDrag()}
          fallback={renderList()}
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
                    '[data-slot="tab-close"], [data-group-menu-trigger], [contenteditable="true"], [contenteditable="plaintext-only"]',
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

              if (initialIndex === index) return
              const next = arrayMove(current, initialIndex, index)

              // Sections are contiguous, so a move within one keeps every position's section.
              if (sections() && next.some((key, i) => sectionOf().get(key) !== sectionOf().get(current[i]))) return
              props.onReorder(mergeVisibleTabOrder(props.tabs.map(tabKey), current, next))
            }}
          >
            {renderList()}
          </DragDropProvider>
        </Show>
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
