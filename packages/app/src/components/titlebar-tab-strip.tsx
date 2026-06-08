import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { decode64 } from "@/utils/base64"
import { tabHref, tabKey, type Tab } from "@/context/tabs"
import { ServerConnection } from "@/context/server"
import { TabNavItem } from "@/components/titlebar-tab-nav"
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

export function TitlebarTabStrip(props: {
  tabs: Tab[]
  currentTab: () => Tab | undefined
  activeServerKey: ServerConnection.Key
  forceTruncate: boolean
  onNavigate: (tab: Tab, el: HTMLDivElement) => void
  onClose: (tab: Tab) => void
  onReorder: (keys: string[]) => void
  onOverflowChange: (overflowing: boolean) => void
  children?: JSX.Element
}) {
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

  const tabIds = () => props.tabs.map(tabKey)

  const displayTabs = createMemo(() => {
    if (!drag.active || drag.draftOrder.length === 0) return props.tabs
    const byKey = new Map(props.tabs.map((tab) => [tabKey(tab), tab]))
    return drag.draftOrder
      .map((key) => byKey.get(key))
      .filter((tab): tab is Tab => !!tab)
  })

  function refreshOverflow() {
    if (!scrollRef) return
    props.onOverflowChange(scrollRef.scrollWidth > scrollRef.clientWidth)
  }

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
    dragPointerId = undefined
    setGesture("pending", undefined)
    setPressedId(undefined)
    stopAutoscroll()
    refreshOverflow()
    requestAnimationFrame(() => setSuppressNavigation(false))
  }

  function onPointerDown(id: string, event: PointerEvent) {
    if (event.button !== 0 || drag.active) return
    const tabEl = (event.currentTarget as HTMLElement).querySelector<HTMLDivElement>("[data-titlebar-tab]")
    if (!tabEl) return
    const tab = props.tabs.find((item) => tabKey(item) === id)
    if (!tab) return
    setSuppressNavigation(true)
    // Select the tab on press (before drag threshold), matching native browser tab strips.
    props.onNavigate(tab, tabEl)
    setPressedId(id)
    const rect = tabEl.getBoundingClientRect()
    setGesture("pending", {
      id,
      startX: event.clientX,
      startY: event.clientY,
      grabOffsetX: event.clientX - rect.left,
      grabOffsetY: event.clientY - rect.top,
      pointerId: event.pointerId,
      width: rect.width,
    })
  }

  function onPointerMove(event: PointerEvent) {
    const pending = gesture.pending
    if (pending && !drag.active) {
      if (event.pointerId !== pending.pointerId) return
      if (pointerDistance(pending.startX, pending.startY, event.clientX, event.clientY) < ACTIVATION_DISTANCE) return
      startDrag(pending.id)
    }

    if (!drag.active) return
    if (dragPointerId !== undefined && event.pointerId !== dragPointerId) return

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
    return () => cleanups.forEach((cleanup) => cleanup())
  })

  onCleanup(stopAutoscroll)

  createEffect(() => {
    props.tabs.length
    tabIds()
    refreshOverflow()
  })

  createEffect(() => {
    if (!drag.active || !scrollRef) return
    return makeEventListener(scrollRef, "scroll", syncScroll)
  })

  const floaterStyle = () => {
    stripScrollLeft()
    const strip = scrollRef?.getBoundingClientRect()
    const left = strip
      ? clampFloaterLeft(
          drag.pointerX - drag.grabOffsetX,
          drag.draggedWidth,
          strip.left,
          strip.right,
        )
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
      <div
        class="flex min-w-0 flex-row items-center gap-1.5 overflow-x-auto no-scrollbar [app-region:no-drag]"
        ref={scrollRef}
      >
        <div class="flex min-w-0 flex-row items-center" ref={listRef}>
          <For each={displayTabs()}>
            {(tab, index) => {
              const id = tabKey(tab)
              const first = () => index() === 0
              let ref!: HTMLDivElement

              const dragged = () => drag.active && drag.draggedId === id

              return (
                <div
                  data-titlebar-tab-slot
                  data-tab-key={id}
                  class="flex shrink-0 touch-none"
                  classList={{
                    "ml-1.5 border-l border-[var(--v2-background-bg-layer-02)] pl-1.5": !first(),
                    "pointer-events-none": dragged(),
                  }}
                  onPointerDown={(event) => {
                    if (dragged()) return
                    onPointerDown(id, event)
                  }}
                >
                  <TabNavItem
                    ref={ref}
                    href={tabHref(tab)}
                    server={tab.server}
                    directory={decode64(tab.dirBase64)!}
                    sessionId={tab.sessionId}
                    onNavigate={() => props.onNavigate(tab, ref)}
                    onClose={() => props.onClose(tab)}
                    active={props.currentTab() === tab}
                    activeServer={tab.server === props.activeServerKey}
                    forceTruncate={props.forceTruncate}
                    suppressNavigation={() => suppressNavigation()}
                    pressed={pressedId() === id}
                    hidden={dragged()}
                  />
                </div>
              )
            }}
          </For>
          {props.children}
        </div>
      </div>
      <Show when={drag.active && draggedTab()}>
        {(tab) => (
          <Portal>
            <div style={floaterStyle()}>
              <TabNavItem
                href={tabHref(tab())}
                server={tab().server}
                directory={decode64(tab().dirBase64)!}
                sessionId={tab().sessionId}
                onNavigate={() => {}}
                onClose={() => {}}
                active={props.currentTab() === tab()}
                activeServer={tab().server === props.activeServerKey}
                forceTruncate={props.forceTruncate}
                dragging
              />
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}
