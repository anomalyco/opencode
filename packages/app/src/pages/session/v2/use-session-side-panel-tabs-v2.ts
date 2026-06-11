import { batch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createSessionTabs, SESSION_OPEN_FILE_TAB } from "@/pages/session/helpers"
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

type TabsStore = {
  all: () => string[]
  active: () => string | undefined
  setAll: (all: string[]) => void
  setActive: (tab: string | undefined) => void
  open: (tab: string) => void | Promise<void>
  close: (tab: string) => void
}

type Input = {
  tabs: () => TabsStore
  tabForPath: (path: string) => string
  normalizeTab: (tab: string) => string
  pathFromTab: (tab: string) => string | undefined
  loadFile: (path: string) => void
  openReviewPanel: () => void
  review: () => boolean
  hasReview: () => boolean
}

function replaceTab(all: string[], from: string, to: string) {
  const fromIndex = all.indexOf(from)
  if (fromIndex === -1) return all
  const next = all.filter((value) => value !== from)
  if (next.includes(to)) return next
  next.splice(fromIndex, 0, to)
  return next
}

export function useSessionSidePanelTabsV2(input: Input) {
  const tabState = createSessionTabs({
    tabs: input.tabs,
    pathFromTab: input.pathFromTab,
    normalizeTab: input.normalizeTab,
    review: input.review,
    hasReview: input.hasReview,
  })

  const [temporaryTab, setTemporaryTab] = createSignal<string | undefined>()
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
  let activeToken = 0

  const setActiveStable = (tab: string | undefined) => {
    activeToken += 1
    const token = activeToken
    input.tabs().setActive(tab)
    queueMicrotask(() => {
      if (token !== activeToken) return
      if (input.tabs().active() === tab) return
      input.tabs().setActive(tab)
    })
  }

  const stripTabs = createMemo(() => {
    const seen = new Set<string>()
    return input
      .tabs()
      .all()
      .flatMap((tab) => {
        if (tab === "context" || tab === "review") return []
        const value = tab.startsWith("file://") ? input.normalizeTab(tab) : tab
        if (value !== SESSION_OPEN_FILE_TAB && !input.pathFromTab(value)) return []
        if (seen.has(value)) return []
        seen.add(value)
        return [value]
      })
  })

  const visibleStripTabs = createMemo(() => {
    if (!drag.active || drag.draftOrder.length === 0) return stripTabs()
    return drag.draftOrder
  })

  const closeTab = (tab: string) => {
    if (temporaryTab() === tab) setTemporaryTab(undefined)
    input.tabs().close(tab)
  }

  const persistTab = (tab: string) => {
    if (temporaryTab() !== tab) return
    setTemporaryTab(undefined)
  }

  const setTabs = (all: string[], active: string) => {
    batch(() => {
      input.tabs().setAll(all)
      setActiveStable(active)
    })
  }

  const openPlaceholderTab = () => {
    const all = input.tabs().all()
    const temporary = temporaryTab()
    if (all.includes(SESSION_OPEN_FILE_TAB)) {
      setActiveStable(SESSION_OPEN_FILE_TAB)
      setTemporaryTab(SESSION_OPEN_FILE_TAB)
      return
    }
    if (temporary && all.includes(temporary)) {
      const next = replaceTab(all, temporary, SESSION_OPEN_FILE_TAB)
      setTabs(next, SESSION_OPEN_FILE_TAB)
      setTemporaryTab(SESSION_OPEN_FILE_TAB)
      return
    }
    batch(() => {
      input.tabs().open(SESSION_OPEN_FILE_TAB)
      setActiveStable(SESSION_OPEN_FILE_TAB)
    })
    setTemporaryTab(SESSION_OPEN_FILE_TAB)
  }

  const openFileTab = (path: string, options?: { persist?: boolean }) => {
    const persist = options?.persist ?? false
    const next = input.tabForPath(path)
    const all = input.tabs().all()
    const active = input.tabs().active()
    const existing = all.includes(next)
    const temporary = temporaryTab()
    const replaceFrom =
      active === SESSION_OPEN_FILE_TAB && all.includes(SESSION_OPEN_FILE_TAB)
        ? SESSION_OPEN_FILE_TAB
        : !persist && temporary && temporary !== next && all.includes(temporary)
          ? temporary
          : undefined

    const finalize = () => {
      input.openReviewPanel()
      input.loadFile(path)
      setActiveStable(next)
    }

    if (replaceFrom) {
      const reordered = replaceTab(all, replaceFrom, next)
      setTabs(reordered, next)
      if (!persist && !existing) setTemporaryTab(next)
      else setTemporaryTab(undefined)
      finalize()
      return
    }

    if (existing) {
      if (persist && temporary === next) setTemporaryTab(undefined)
      if (!persist && temporary === SESSION_OPEN_FILE_TAB) setTemporaryTab(undefined)
      finalize()
      return
    }

    batch(() => {
      input.tabs().open(next)
      setActiveStable(next)
    })
    if (!persist) setTemporaryTab(next)
    if (persist && temporary === SESSION_OPEN_FILE_TAB) setTemporaryTab(undefined)
    finalize()
  }

  const reorderStripTabs = (nextOrder: string[]) => {
    const specials = input.tabs().all().filter((tab) => tab === "context" || tab === "review")
    input.tabs().setAll([...specials, ...nextOrder])
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
    setActiveStable(tab)
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
    const temporary = temporaryTab()
    if (!temporary) return
    if (stripTabs().includes(temporary)) return
    setTemporaryTab(undefined)
  })

  createEffect(() => {
    if (!drag.active || !tabListRef) return
    return makeEventListener(tabListRef, "scroll", syncScroll)
  })

  onCleanup(stopAutoscroll)

  const handleTabsChange = (value: string) => {
    if (value === "review" || value === "context" || value === SESSION_OPEN_FILE_TAB) {
      setActiveStable(value)
      return
    }
    if (!input.pathFromTab(value)) return
    setActiveStable(value)
  }

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
    tabState,
    drag,
    pressedTab,
    temporaryTab,
    stripTabs,
    visibleStripTabs,
    setTabListRef: (el: HTMLDivElement) => {
      tabListRef = el
    },
    openPlaceholderTab,
    openFileTab,
    closeTab,
    persistTab,
    onStripPointerDown,
    handleTabsChange,
    floaterStyle,
  }
}

