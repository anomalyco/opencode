import {
  createEffect,
  createMemo,
  createResource,
  createRoot,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { tabHref, tabKey, type SessionTab, type Tab } from "@/context/tabs"
import { ServerConnection } from "@/context/server"
import { DraftTabItem, TabNavItem } from "@/components/titlebar-tab-nav"
import { useGlobal, type ServerCtx } from "@/context/global"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { useTabs } from "@/context/tabs"
import { createTabPromptState } from "@/context/prompt"
import { base64Encode } from "@opencode-ai/core/util/encode"
import {
  captureTabPointerDown,
  canStartTabDrag,
  createTabDragPreview,
  isPrimaryPointerPressed,
  isTabCloseTarget,
} from "./titlebar-tab-gesture"
import {
  ACTIVATION_DISTANCE,
  autoscrollSpeed,
  captureTabDragLayout,
  clampFloaterLeft,
  draftOrderChanged,
  insertIndexFromVirtualLayout,
  movePlaceholder,
  pointerDistance,
  syncLayoutScroll,
  type TabDragLayout,
} from "@/components/titlebar-tab-drag"

function SessionTabSlot(props: {
  tab: SessionTab
  id: string
  active: () => boolean
  activeServerKey: ServerConnection.Key
  forceTruncate: boolean
  dragActive: boolean
  dragged: () => boolean
  pressed: () => boolean
  serverCtx: () => ServerCtx | undefined
  suppressNavigation: () => boolean
  onPointerDown: (event: PointerEvent) => void
  onNavigate: (element: HTMLDivElement) => void
  onClose: () => void
}) {
  const tabs = useTabs()
  let ref!: HTMLDivElement
  const sdk = createMemo(() => props.serverCtx()?.sdk ?? null)
  const cachedSession = createMemo(() => props.serverCtx()?.sync.session.peek(props.tab.sessionId))
  const [loadedSession] = createResource(
    () => {
      const ctx = props.serverCtx()
      return ctx ? { id: props.tab.sessionId, ctx } : null
    },
    ({ id, ctx }) => ctx.sync.session.resolve(id).catch(() => undefined),
  )
  const session = createMemo(() => cachedSession() ?? loadedSession())
  let prefetched = false

  createEffect(() => {
    const ctx = props.serverCtx()
    const value = session()
    if (!ctx || !value || prefetched) return
    prefetched = true
    createRoot((dispose) => {
      try {
        void ctx.sync
          .ensureDirSyncContext(value.directory)
          .session.sync(value.id)
          .catch(() => {})
          .finally(dispose)
      } catch {
        dispose()
      }
    })
  })

  createEffect(() => {
    const value = session()
    const current = sdk()
    if (!value || !current) return
    createTabPromptState(tabs, props.tab, current.scope, {
      dir: base64Encode(value.directory),
      id: value.id,
    })
  })

  return (
    <TabNavItem
      tabKey={props.id}
      dragActive={props.dragActive}
      onPointerDown={props.onPointerDown}
      ref={ref}
      href={tabHref(props.tab)}
      server={props.tab.server}
      session={session}
      onTitleChange={(title) => {
        const value = session()
        const ctx = props.serverCtx()
        if (value && ctx) ctx.sync.session.remember({ ...value, title })
      }}
      onTitleChangeFailed={(title) => {
        const value = session()
        const ctx = props.serverCtx()
        if (value && ctx) ctx.sync.session.remember({ ...value, title })
      }}
      onNavigate={() => props.onNavigate(ref)}
      onClose={props.onClose}
      active={props.active()}
      activeServer={props.tab.server === props.activeServerKey}
      forceTruncate={props.forceTruncate}
      suppressNavigation={props.suppressNavigation}
      pressed={props.pressed()}
      hidden={props.dragged() || !session()}
    />
  )
}

export function TitlebarTabStrip(props: {
  tabs: Tab[]
  currentTab: () => Tab | undefined
  activeServerKey: ServerConnection.Key
  forceTruncate: boolean
  onNavigate: (tab: Tab, el?: HTMLDivElement) => void
  onClose: (tab: Tab) => void
  onReorder: (keys: string[]) => void
  onOverflowChange: (overflowing: boolean) => void
}) {
  const global = useGlobal()
  const language = useLanguage()
  const [drag, setDrag] = createStore({
    active: false,
    draggedId: undefined as string | undefined,
    placeholderIndex: 0,
    draftOrder: [] as string[],
    initialOrder: [] as string[],
    draggedWidth: 0,
    pointerX: 0,
    grabOffsetX: 0,
    floaterTop: 0,
  })

  const [gesture, setGesture] = createStore({
    pending: undefined as
      | {
          id: string
          startX: number
          startY: number
          grabOffsetX: number
          grabOffsetY: number
          pointerId: number
          width: number
          element: HTMLDivElement
        }
      | undefined,
  })

  const [suppressNavigation, setSuppressNavigation] = createSignal(false)
  const [pressedId, setPressedId] = createSignal<string | undefined>()
  const [stripScrollLeft, setStripScrollLeft] = createSignal(0)
  let scrollRef!: HTMLDivElement
  let listRef!: HTMLDivElement
  let dragLayout: TabDragLayout | undefined
  let dragPointerId: number | undefined
  let autoscrollFrame: number | undefined
  let resizeFrame: number | undefined
  let dragPreview: HTMLDivElement | undefined

  const tabIds = () => props.tabs.map(tabKey)

  const displayTabs = createMemo(() => {
    if (!drag.active || drag.draftOrder.length === 0) return props.tabs
    const byKey = new Map(props.tabs.map((tab) => [tabKey(tab), tab]))
    return drag.draftOrder.map((key) => byKey.get(key)).filter((tab): tab is Tab => !!tab)
  })

  function refreshOverflow() {
    if (!scrollRef) return
    props.onOverflowChange(scrollRef.scrollWidth > scrollRef.clientWidth)
  }

  createResizeObserver(
    () => [scrollRef, listRef],
    () => {
      if (resizeFrame !== undefined) return
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined
        refreshOverflow()
        if (!drag.active || !listRef) return
        dragLayout = captureTabDragLayout(listRef, drag.draftOrder)
        updateInsertIndex()
      })
    },
  )

  function syncScroll() {
    if (!scrollRef || !listRef || !dragLayout) return
    syncLayoutScroll(listRef, dragLayout)
    setStripScrollLeft(scrollRef.scrollLeft)
    updateInsertIndex()
  }

  function stopAutoscroll() {
    if (autoscrollFrame === undefined) return
    cancelAnimationFrame(autoscrollFrame)
    autoscrollFrame = undefined
  }

  function tickAutoscroll() {
    if (!drag.active || !scrollRef) return

    const strip = scrollRef.getBoundingClientRect()
    const speed = autoscrollSpeed(drag.pointerX, strip.left, strip.right)

    if (speed !== 0) {
      scrollRef.scrollLeft += speed
      syncScroll()
    }

    autoscrollFrame = requestAnimationFrame(tickAutoscroll)
  }

  function startAutoscroll() {
    stopAutoscroll()
    autoscrollFrame = requestAnimationFrame(tickAutoscroll)
  }

  function applyPlaceholderIndex(nextIndex: number) {
    const id = drag.draggedId
    if (!id) return
    const next = movePlaceholder(drag.draftOrder, id, nextIndex)
    setDrag({
      draftOrder: next,
      placeholderIndex: nextIndex,
    })
  }

  function updateInsertIndex() {
    if (!drag.active || !dragLayout) return
    const draggedId = drag.draggedId
    if (!draggedId) return
    const nextIndex = insertIndexFromVirtualLayout(
      drag.pointerX,
      drag.draftOrder,
      draggedId,
      drag.placeholderIndex,
      dragLayout,
    )
    if (nextIndex === drag.placeholderIndex) return
    applyPlaceholderIndex(nextIndex)
  }

  function startDrag(id: string) {
    const order = tabIds()
    const index = order.indexOf(id)
    const pending = gesture.pending
    if (index === -1 || !pending || !listRef || !scrollRef) return

    dragLayout = captureTabDragLayout(listRef, order)
    dragPreview = createTabDragPreview(pending.element)
    dragPointerId = pending.pointerId
    setGesture("pending", undefined)

    setDrag({
      active: true,
      draggedId: id,
      placeholderIndex: index,
      draftOrder: order,
      initialOrder: order,
      draggedWidth: pending.width,
      pointerX: pending.startX,
      grabOffsetX: pending.grabOffsetX,
      floaterTop: pending.startY - pending.grabOffsetY,
    })
    setPressedId(undefined)
    setStripScrollLeft(scrollRef.scrollLeft)
    startAutoscroll()
  }

  function endDrag(commit: boolean) {
    const initial = drag.initialOrder
    const final = drag.draftOrder
    const moved = drag.active

    if (commit && moved && draftOrderChanged(initial, final)) {
      props.onReorder(final)
    }

    if (moved) setSuppressNavigation(true)

    setDrag({
      active: false,
      draggedId: undefined,
      placeholderIndex: 0,
      draftOrder: [],
      initialOrder: [],
      draggedWidth: 0,
      pointerX: 0,
      grabOffsetX: 0,
      floaterTop: 0,
    })

    dragLayout = undefined
    dragPreview = undefined
    dragPointerId = undefined
    setGesture("pending", undefined)
    setPressedId(undefined)
    stopAutoscroll()
    refreshOverflow()
    requestAnimationFrame(() => setSuppressNavigation(false))
  }

  function onPointerDown(id: string, event: PointerEvent) {
    if (event.button !== 0 || drag.active) return
    if (!canStartTabDrag(event.pointerType)) return
    if (isTabCloseTarget(event.target)) return
    const target = event.currentTarget as HTMLDivElement
    const tabEl = target.matches("[data-titlebar-tab]")
      ? target
      : target.querySelector<HTMLDivElement>("[data-titlebar-tab]")
    if (!tabEl) return
    if (!tabEl.querySelector('[data-slot="tab-link"]')) return
    const tab = props.tabs.find((item) => tabKey(item) === id)
    if (!tab) return
    const pointer = captureTabPointerDown(tabEl, event.clientX, event.clientY)
    setSuppressNavigation(true)
    props.onNavigate(tab, tabEl)
    setPressedId(id)
    setGesture("pending", {
      id,
      pointerId: event.pointerId,
      ...pointer,
    })
  }

  function onPointerMove(event: PointerEvent) {
    const pending = gesture.pending
    if (pending && event.pointerId !== pending.pointerId) return
    if (drag.active && dragPointerId !== undefined && event.pointerId !== dragPointerId) return
    if (!isPrimaryPointerPressed(event.buttons)) {
      if (drag.active) endDrag(true)
      if (pending) {
        setGesture("pending", undefined)
        setPressedId(undefined)
        requestAnimationFrame(() => setSuppressNavigation(false))
      }
      return
    }

    if (pending && !drag.active) {
      if (pointerDistance(pending.startX, pending.startY, event.clientX, event.clientY) < ACTIVATION_DISTANCE) return
      startDrag(pending.id)
    }

    if (!drag.active) return

    setDrag("pointerX", event.clientX)
    syncScroll()
  }

  function onPointerUp(event: PointerEvent) {
    if (drag.active) {
      if (dragPointerId !== undefined && event.pointerId !== dragPointerId) return
      setDrag("pointerX", event.clientX)
      syncScroll()
      endDrag(true)
      return
    }

    const pending = gesture.pending
    if (pending && event.pointerId !== pending.pointerId) return

    setGesture("pending", undefined)
    setPressedId(undefined)
    requestAnimationFrame(() => setSuppressNavigation(false))
  }

  function onPointerCancel(event: PointerEvent) {
    if (drag.active) {
      if (dragPointerId !== undefined && event.pointerId !== dragPointerId) return
      endDrag(false)
      return
    }

    if (!gesture.pending) return
    if (gesture.pending.pointerId !== event.pointerId) return
    setGesture("pending", undefined)
    setPressedId(undefined)
    requestAnimationFrame(() => setSuppressNavigation(false))
  }

  onMount(() => {
    const cleanups = [
      makeEventListener(window, "pointermove", onPointerMove),
      makeEventListener(window, "pointerup", onPointerUp),
      makeEventListener(window, "pointercancel", onPointerCancel),
    ]
    refreshOverflow()
    onCleanup(() => cleanups.forEach((cleanup) => cleanup()))
  })

  onCleanup(stopAutoscroll)
  onCleanup(() => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  })

  createEffect(() => {
    props.tabs.length
    tabIds()
    refreshOverflow()
  })

  createEffect(() => {
    if (!drag.active || !scrollRef) return
    onCleanup(makeEventListener(scrollRef, "scroll", syncScroll))
  })

  const floaterStyle = () => {
    stripScrollLeft()
    const strip = scrollRef?.getBoundingClientRect()
    const left = strip
      ? clampFloaterLeft(drag.pointerX - drag.grabOffsetX, drag.draggedWidth, strip.left, strip.right)
      : drag.pointerX - drag.grabOffsetX

    return {
      position: "fixed" as const,
      top: `${drag.floaterTop}px`,
      left: `${left}px`,
      width: `${drag.draggedWidth}px`,
      "z-index": "10000",
      "pointer-events": "none" as const,
    }
  }

  const draggedTab = createMemo(() => {
    const id = drag.draggedId
    if (!id) return
    return props.tabs.find((tab) => tabKey(tab) === id)
  })

  return (
    <>
      <div data-slot="titlebar-tabs" class="relative min-w-0">
        <div
          data-slot="titlebar-tabs-scroll"
          class="flex min-w-0 flex-row items-center gap-1.5 overflow-x-auto no-scrollbar [app-region:no-drag]"
          ref={scrollRef}
        >
          <div data-titlebar-tab-list class="flex min-w-0 flex-row items-center" ref={listRef}>
            <For each={displayTabs()}>
              {(tab, index) => {
                const id = tabKey(tab)
                let ref!: HTMLDivElement
                useTabShortcut(index, () => props.onNavigate(tab, ref))

                const dragged = () => drag.active && drag.draggedId === id
                const serverCtx = createMemo(() => {
                  if (tab.type !== "session") return
                  const conn = global.servers.list().find((item) => ServerConnection.key(item) === tab.server)
                  if (conn) return global.ensureServerCtx(conn)
                })

                if (tab.type === "session") {
                  return (
                    <SessionTabSlot
                      tab={tab}
                      id={id}
                      active={() => props.currentTab() === tab}
                      activeServerKey={props.activeServerKey}
                      forceTruncate={props.forceTruncate}
                      dragActive={drag.active}
                      dragged={dragged}
                      pressed={() => pressedId() === id}
                      serverCtx={serverCtx}
                      suppressNavigation={() => suppressNavigation()}
                      onPointerDown={(event) => {
                        if (dragged()) return
                        onPointerDown(id, event)
                      }}
                      onNavigate={(element) => props.onNavigate(tab, element)}
                      onClose={() => props.onClose(tab)}
                    />
                  )
                }

                return (
                  <DraftTabItem
                    tabKey={id}
                    dragActive={drag.active}
                    onPointerDown={(event) => {
                      if (dragged()) return
                      onPointerDown(id, event)
                    }}
                    ref={ref}
                    href={tabHref(tab)}
                    title={language.t("command.session.new")}
                    onNavigate={() => props.onNavigate(tab, ref)}
                    onClose={() => props.onClose(tab)}
                    suppressNavigation={() => suppressNavigation()}
                    active={props.currentTab() === tab}
                    pressed={pressedId() === id}
                    hidden={dragged()}
                  />
                )
              }}
            </For>
          </div>
        </div>
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
      </div>
      <Show when={drag.active && draggedTab() && dragPreview}>
        {(_) => (
          <Portal>
            <div data-titlebar-tab-preview style={floaterStyle()}>
              {dragPreview}
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}

function useTabShortcut(index: () => number, onSelect: () => void) {
  const command = useCommand()

  command.register(() => {
    const number = index() + 1
    if (number > 9) return []
    return [
      {
        id: `tab.${number}`,
        category: "tab",
        title: "",
        keybind: `mod+${number}`,
        hidden: true,
        onSelect,
      },
    ]
  })
}
