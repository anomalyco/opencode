import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import type { HomeSessionGroup } from "./home-sessions-controller"

const HOME_SESSION_HEADER_STICKY_TOP = 12
const HOME_SESSION_HEADER_TEXT_HEIGHT = 16
const HOME_SESSION_HEADER_FADE_DISTANCE = 16

export function createHomeScrollController(groups: Accessor<HomeSessionGroup[]>) {
  const [thumbTrack, setThumbTrack] = createSignal<HTMLDivElement>()
  const [hoverTarget, setHoverTarget] = createSignal<HTMLElement>()
  const [state, setState] = createStore({
    titleOpacity: {} as Partial<Record<HomeSessionGroup["id"], number>>,
  })
  const headerRefs = new Map<HomeSessionGroup["id"], HTMLDivElement>()
  const headerOffsets = new Map<HomeSessionGroup["id"], number>()
  let viewport: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined
  let positionFrame: number | undefined
  let resizeObserver: ResizeObserver | undefined
  let stickyTop = HOME_SESSION_HEADER_STICKY_TOP

  createEffect(() => {
    const items = groups()
    const ids = new Set(items.map((group) => group.id))
    headerRefs.forEach((_, id) => {
      if (!ids.has(id)) headerRefs.delete(id)
    })
    headerOffsets.forEach((_, id) => {
      if (!ids.has(id)) headerOffsets.delete(id)
    })
    if (items.length === 0) {
      content = undefined
      bindResizeObserver()
    }
    queuePositionUpdate()
  })

  onCleanup(() => {
    if (positionFrame !== undefined) cancelAnimationFrame(positionFrame)
    resizeObserver?.disconnect()
  })

  function queuePositionUpdate() {
    if (typeof requestAnimationFrame === "undefined") {
      updatePositionCache()
      return
    }
    if (positionFrame !== undefined) return
    positionFrame = requestAnimationFrame(() => {
      positionFrame = undefined
      updatePositionCache()
    })
  }

  function updatePositionCache() {
    if (!viewport) return
    const header = groups()
      .map((group) => headerRefs.get(group.id))
      .find((element) => element !== undefined)
    if (header && typeof getComputedStyle === "function") {
      const top = Number.parseFloat(getComputedStyle(header).top)
      if (Number.isFinite(top)) stickyTop = top
    }
    groups().forEach((group) => {
      const element = headerRefs.get(group.id)
      if (element) headerOffsets.set(group.id, element.offsetTop)
    })
    update(viewport.scrollTop)
  }

  function update(scrollTop: number) {
    const items = groups()
    items.forEach((group, index) => {
      const nextOffset = items
        .slice(index + 1)
        .map((item) => headerOffsets.get(item.id))
        .find((offset) => offset !== undefined)
      const fadeEnd = stickyTop + HOME_SESSION_HEADER_TEXT_HEIGHT
      const nextTop = nextOffset === undefined ? undefined : nextOffset - scrollTop
      const opacity =
        nextTop === undefined ? 1 : Math.max(0, Math.min(1, (nextTop - fadeEnd) / HOME_SESSION_HEADER_FADE_DISTANCE))
      setState("titleOpacity", group.id, Math.round(opacity * 1000) / 1000)
    })
  }

  function bindResizeObserver() {
    resizeObserver?.disconnect()
    if (typeof ResizeObserver === "undefined") return
    resizeObserver = new ResizeObserver(queuePositionUpdate)
    if (viewport) resizeObserver.observe(viewport)
    if (content) resizeObserver.observe(content)
  }

  function containWheel(event: WheelEvent) {
    if (!viewport) return
    if (event.defaultPrevented || event.ctrlKey || !event.deltaY) return
    if (!(event.target instanceof Element)) return
    const scrollable = event.target.closest<HTMLElement>("[data-scrollable]")
    if (
      scrollable !== viewport &&
      scrollable &&
      (event.deltaY < 0
        ? scrollable.scrollTop > 0
        : scrollable.scrollTop < scrollable.scrollHeight - scrollable.clientHeight)
    )
      return
    event.preventDefault()
  }

  return {
    viewport: {
      thumbTrack,
      hoverTarget,
      setThumbTrack,
      setHoverTarget,
      setViewport: (element: HTMLDivElement) => {
        viewport = element
        bindResizeObserver()
        queuePositionUpdate()
      },
      update,
      containWheel,
      containOuterWheel: (event: WheelEvent) => {
        if (!viewport) return
        if (event.target instanceof Node && viewport.contains(event.target)) return
        containWheel(event)
      },
    },
    header: {
      setContent: (element: HTMLDivElement) => {
        content = element
        bindResizeObserver()
        queuePositionUpdate()
      },
      setHeader: (id: HomeSessionGroup["id"], element: HTMLDivElement) => {
        headerRefs.set(id, element)
        queuePositionUpdate()
      },
      titleOpacity: (id: HomeSessionGroup["id"]) => state.titleOpacity[id] ?? 1,
    },
  }
}

export type HomeScrollController = ReturnType<typeof createHomeScrollController>
