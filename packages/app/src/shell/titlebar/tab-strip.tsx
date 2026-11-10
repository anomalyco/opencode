import {
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  For,
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
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
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
    onRememberTitle: (sessionID: string, title: string | undefined) => void
    onSaveTitle: (sessionID: string, title: string, signal: AbortSignal) => Promise<void>
    onDelete: () => void
    onNavigate: (element: HTMLDivElement) => void
    onIntent: (hovered: boolean) => void
  },
) {
  const sortable = useSortable({
    get id() {
      return props.id
    },
    get index() {
      return props.index
    },
    // Rows only sort among rows of the same group, so a drag never crosses into another section.
    get type() {
      return props.group
    },
    get accept() {
      return props.group
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
        "flex-col": !!props.footer,
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
        shortcut={props.shortcut}
        label={props.label}
        hideAvatar={props.hideAvatar}
        fallbackTitle={props.fallbackTitle}
        fallbackDirectory={props.fallbackDirectory}
        onRememberTitle={props.onRememberTitle}
        onSaveTitle={props.onSaveTitle}
        onDelete={props.onDelete}
        onNavigate={() => props.onNavigate(ref)}
        onClose={props.onClose}
        onCloseOthers={props.onCloseOthers}
        onCloseAfter={props.onCloseAfter}
        active={props.active}
        dragging={sortable.isDragSource()}
        orientation={props.orientation}
      />
      {props.footer}
    </div>
  )
}

function SessionTabEntry(
  props: TabCloseActions & {
    tab: SessionTab
    currentTab?: Tab
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
    shortcut?: number
    onUnreadChange: (unread: boolean) => void
    onNavigate: (element: HTMLDivElement) => void
  },
) {
  const tabs = useTabs()
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = createMemo(() => props.serverCtx?.sdk ?? null)
  const persisted = createMemo(() => tabs.info[props.id])
  const session = () => props.view.session

  const status = useSessionTabAvatarState(
    () => props.tab.server,
    () => props.tab.sessionId,
    () => true,
  )

  // A busy session shows its progress indicator instead of the unread dot.
  const unread = createMemo(() => status.unread() && !status.loading())

  const rememberTitle = (sessionID: string, title: string | undefined) => {
    const current = props.serverCtx?.data.session.get(sessionID)

    if (current) props.serverCtx?.data.session.remember({ ...current, title })
  }

  const saveTitle = async (sessionID: string, title: string, signal: AbortSignal) => {
    const ctx = props.serverCtx

    if (!ctx) throw new Error(language.t("common.requestFailed"))
    await ctx.sdk.api.session.update({ sessionID, title }, { signal })
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

  createEffect(() => props.onUnreadChange(unread()))

  createEffect(() => {
    const ctx = props.serverCtx
    const id = props.tab.sessionId

    if (
      props.view.phase === "preparing" ||
      props.view.phase === "missing" ||
      !ctx ||
      props.active ||
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
        unread={unread()}
        attention={status.attention()}
        loading={status.loading()}
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
        onRememberTitle={rememberTitle}
        onSaveTitle={saveTitle}
        onDelete={() => dialog.show(() => <DeleteDialog />)}
        onNavigate={props.onNavigate}
        onClose={props.onClose}
        onCloseOthers={props.onCloseOthers}
        onCloseAfter={props.onCloseAfter}
        onIntent={hover}
      />
    </Show>
  )
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
    // Rows only sort among rows of the same group, so a drag never crosses into another section.
    get type() {
      return props.group
    },
    get accept() {
      return props.group
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
        dragging={sortable.isDragSource()}
        orientation={props.orientation}
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
}

export function TitlebarTabStrip(props: {
  orientation?: "horizontal" | "vertical"
  highlightActive?: boolean
  tabs: Tab[]
  /** Vertical only: groups the rendered tabs under headers. Tabs in no section stay open but are not shown. */
  sections?: TabStripSection[]
  /** Vertical only: extra content rendered right after a tab row (e.g. its subagent sessions). */
  tabFooter?: (tab: Tab) => JSX.Element | undefined
  /** Vertical only: a faint trailing label on a tab row (e.g. its server). */
  tabLabel?: (tab: Tab) => string | undefined
  currentTab: Tab | undefined
  onNavigate: (tab: Tab, el?: HTMLDivElement) => void
  onClose: (tab: Tab) => void
  onCloseTabs: (tabs: Tab[], keep: Tab) => void
  onReorder: (keys: string[]) => void
}) {
  const global = useGlobal()
  const language = useLanguage()
  const command = useCommand()
  const appTabs = useTabs()
  const vertical = () => props.orientation === "vertical"
  const sections = () => (vertical() ? props.sections : undefined)

  const displayTabs = createMemo(() => sections()?.flatMap((section) => section.tabs) ?? props.tabs)

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
  const [unread, setUnread] = createStore<Record<string, boolean>>({})
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

  const shortcut = (index: number) => (index >= 0 && index < 9 ? index + 1 : undefined)

  function selectAdjacentTab(offset: -1 | 1, include?: (key: string) => boolean) {
    const current = props.currentTab
    const key = adjacentTabKey(visibleTabIds(), current ? tabKey(current) : undefined, offset, include)
    const next = props.tabs.find((tab) => tabKey(tab) === key)

    if (next) props.onNavigate(next)
  }

  function renderTab(tab: Tab, section?: TabStripSection) {
    const id = tabKey(tab)

    const group = section?.key
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
          currentTab={props.currentTab}
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
          shortcut={shortcut(visibleIndex())}
          onUnreadChange={(value) => setUnread(id, value)}
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
    <div
      data-slot={vertical() ? "vertical-tabs" : "titlebar-tabs"}
      data-orientation={vertical() ? "vertical" : "horizontal"}
      data-shortcut-hints={selectTabHintsShown(hints()) && !side.focused() ? "" : undefined}
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

            if (initialIndex === index) return
            const next = arrayMove(current, initialIndex, index)

            // Sections are contiguous, so a move within one keeps every position's section.
            if (sections() && next.some((key, i) => sectionOf().get(key) !== sectionOf().get(current[i]))) return
            props.onReorder(mergeVisibleTabOrder(props.tabs.map(tabKey), current, next))
          }}
        >
          <div
            data-titlebar-tab-list
            data-orientation={vertical() ? "vertical" : "horizontal"}
            class="flex w-full min-w-0"
            classList={{ "flex-row items-center": !vertical(), "flex-col items-stretch": vertical() }}
            ref={listRef}
          >
            <Show when={sections()} fallback={<For each={props.tabs}>{(tab) => renderTab(tab)}</For>}>
              {(list) => (
                <Key each={list()} by={(section) => section.key}>
                  {(section) => (
                    <>
                      {section().header}
                      <For each={section().tabs}>{(tab) => renderTab(tab, section())}</For>
                      {section().footer}
                    </>
                  )}
                </Key>
              )}
            </Show>
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
