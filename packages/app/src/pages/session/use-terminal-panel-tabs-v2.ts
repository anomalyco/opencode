import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
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
} from "@/components/session/session-tab-drag-v2"
import type { useTerminal } from "@/context/terminal"

type Terminal = ReturnType<typeof useTerminal>

type Input = {
  terminal: Terminal
  enabled?: () => boolean
}

export function useTerminalPanelTabsV2(input: Input) {
  const enabled = () => input.enabled?.() ?? true
  const [pressedTab, setPressedTab] = createSignal<string | undefined>()
  const [drag, setDrag] = createStore({
    active: false,
    draggedTab: undefined as string | undefined,
    pointerX: 0,
    floaterTop: 0,
    dragWidth: 0,
    grabOffsetX: 0,
    draftOrder: [] as string[],
    initialOrder: [] as string[],
    placeholderIndex: 0,
  })
  const [gesture, setGesture] = createStore({
    pending: undefined as
      | {
          tab: string
          startX: number
          startY: number
          pointerID: number
          width: number
          grabOffsetX: number
          grabOffsetY: number
        }
      | undefined,
  })

  let tabListRef: HTMLDivElement | undefined
  let dragPointerID: number | undefined
  let dragLayout: TabDragLayout | undefined
  let autoscrollFrame: number | undefined

  const stripTabs = createMemo(() => input.terminal.all().map((pty) => pty.id))

  const visibleStripTabs = createMemo(() => {
    if (!drag.active || drag.draftOrder.length === 0) return stripTabs()
    return drag.draftOrder
  })

  const reorderStripTabs = (order: string[]) => {
    for (const [index, id] of order.entries()) {
      const current = input.terminal.all().findIndex((pty) => pty.id === id)
      if (current !== index) input.terminal.move(id, index)
    }
  }

  const updateInsertIndex = () => {
    if (!drag.active || !dragLayout || !drag.draggedTab) return
    const nextIndex = insertIndexFromVirtualLayout(
      drag.pointerX,
      drag.draftOrder,
      drag.draggedTab,
      drag.placeholderIndex,
      dragLayout,
    )
    if (nextIndex === drag.placeholderIndex) return
    const next = movePlaceholder(drag.draftOrder, drag.draggedTab, nextIndex)
    setDrag({
      draftOrder: next,
      placeholderIndex: nextIndex,
    })
  }

  const syncScroll = () => {
    if (!tabListRef || !dragLayout) return
    syncLayoutScroll(tabListRef, dragLayout)
    updateInsertIndex()
  }

  const draggableStripLeft = () => {
    if (dragLayout) return dragLayout.listLeft
    if (!tabListRef) return 0
    const slots = Array.from(tabListRef.querySelectorAll<HTMLElement>("[data-session-tab-slot]"))
    if (slots.length === 0) return tabListRef.getBoundingClientRect().left
    return Math.min(...slots.map((slot) => slot.getBoundingClientRect().left))
  }

  const stopAutoscroll = () => {
    if (autoscrollFrame === undefined) return
    cancelAnimationFrame(autoscrollFrame)
    autoscrollFrame = undefined
  }

  const tickAutoscroll = () => {
    if (!drag.active || !tabListRef) return
    const rect = tabListRef.getBoundingClientRect()
    const speed = autoscrollSpeed(drag.pointerX, draggableStripLeft(), rect.right)
    if (speed !== 0) {
      tabListRef.scrollLeft += speed
      syncScroll()
    }
    autoscrollFrame = requestAnimationFrame(tickAutoscroll)
  }

  const startAutoscroll = () => {
    stopAutoscroll()
    autoscrollFrame = requestAnimationFrame(tickAutoscroll)
  }

  const startDrag = (tab: string) => {
    const order = stripTabs()
    const index = order.indexOf(tab)
    const pending = gesture.pending
    if (index === -1 || !pending || !tabListRef) return

    dragLayout = captureTabDragLayout(tabListRef, order)
    dragPointerID = pending.pointerID
    setGesture("pending", undefined)
    setDrag({
      active: true,
      draggedTab: tab,
      pointerX: pending.startX,
      floaterTop: pending.startY - pending.grabOffsetY,
      dragWidth: pending.width,
      grabOffsetX: pending.grabOffsetX,
      draftOrder: order,
      initialOrder: order,
      placeholderIndex: index,
    })
    setPressedTab(undefined)
    startAutoscroll()
  }

  const finishDrag = (commit: boolean) => {
    if (commit && drag.active && draftOrderChanged(drag.initialOrder, drag.draftOrder)) {
      reorderStripTabs(drag.draftOrder)
    }
    setDrag({
      active: false,
      draggedTab: undefined,
      pointerX: 0,
      floaterTop: 0,
      dragWidth: 0,
      grabOffsetX: 0,
      draftOrder: [],
      initialOrder: [],
      placeholderIndex: 0,
    })
    setGesture("pending", undefined)
    setPressedTab(undefined)
    dragPointerID = undefined
    dragLayout = undefined
    stopAutoscroll()
  }

  const onStripPointerDown = (tab: string, event: PointerEvent) => {
    if (event.button !== 0 || drag.active) return
    const tabEl = (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-session-tab]")
    if (!tabEl) return
    input.terminal.open(tab)
    setPressedTab(tab)
    const rect = tabEl.getBoundingClientRect()
    setGesture("pending", {
      tab,
      startX: event.clientX,
      startY: event.clientY,
      pointerID: event.pointerId,
      width: rect.width,
      grabOffsetX: event.clientX - rect.left,
      grabOffsetY: event.clientY - rect.top,
    })
  }

  const onPointerMove = (event: PointerEvent) => {
    const pending = gesture.pending
    if (pending && !drag.active) {
      if (event.pointerId !== pending.pointerID) return
      if (pointerDistance(pending.startX, pending.startY, event.clientX, event.clientY) < ACTIVATION_DISTANCE) return
      startDrag(pending.tab)
    }
    if (!drag.active) return
    if (dragPointerID !== undefined && event.pointerId !== dragPointerID) return
    setDrag("pointerX", event.clientX)
    syncScroll()
  }

  const onPointerUp = (event: PointerEvent) => {
    if (drag.active) {
      if (dragPointerID !== undefined && event.pointerId !== dragPointerID) return
      setDrag("pointerX", event.clientX)
      syncScroll()
      finishDrag(true)
      return
    }
    if (!gesture.pending) return
    if (event.pointerId !== gesture.pending.pointerID) return
    setGesture("pending", undefined)
    setPressedTab(undefined)
  }

  const onPointerCancel = (event: PointerEvent) => {
    if (drag.active) {
      if (dragPointerID !== undefined && event.pointerId !== dragPointerID) return
      finishDrag(false)
      return
    }
    if (!gesture.pending) return
    if (event.pointerId !== gesture.pending.pointerID) return
    setGesture("pending", undefined)
    setPressedTab(undefined)
  }

  onMount(() => {
    if (!enabled()) return

    const cleanups = [
      makeEventListener(window, "pointermove", onPointerMove),
      makeEventListener(window, "pointerup", onPointerUp),
      makeEventListener(window, "pointercancel", onPointerCancel),
    ]
    return () => {
      for (const cleanup of cleanups) cleanup()
    }
  })

  createEffect(() => {
    if (!enabled() || !drag.active || !tabListRef) return
    return makeEventListener(tabListRef, "scroll", syncScroll)
  })

  onCleanup(stopAutoscroll)

  const floaterStyle = () => {
    const strip = tabListRef?.getBoundingClientRect()
    const left = strip
      ? clampFloaterLeft(drag.pointerX - drag.grabOffsetX, drag.dragWidth, draggableStripLeft(), strip.right)
      : drag.pointerX - drag.grabOffsetX
    return {
      position: "fixed" as const,
      top: `${drag.floaterTop}px`,
      left: `${left}px`,
      width: `${drag.dragWidth}px`,
      "z-index": "10000",
      "pointer-events": "none" as const,
    }
  }

  return {
    drag,
    pressedTab,
    visibleStripTabs,
    setTabListRef: (el: HTMLDivElement) => {
      tabListRef = el
    },
    onStripPointerDown,
    floaterStyle,
  }
}
