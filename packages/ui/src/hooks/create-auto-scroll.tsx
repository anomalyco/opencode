import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { createEventListener } from "@solid-primitives/event-listener"
import {
  createAutoScrollState,
  END_EPSILON,
  SETTLE_MS,
  selectOverflowAnchor,
  selectPausesOnSelection,
  selectUserScrolled,
  transitionAutoScroll,
  type AutoScrollEffect,
  type AutoScrollEvent,
} from "./auto-scroll-machine"

export interface AutoScrollOptions {
  working: () => boolean
  onUserInteracted?: () => void
  overflowAnchor?: "none" | "auto" | "dynamic"
  bottomThreshold?: number
}

const DETACHED = { type: "scroller.detached" } as const

const BOTTOM = { type: "scroll.bottom", force: false } as const

const FORCE_BOTTOM = { type: "scroll.bottom", force: true } as const

const DISPOSE = { type: "disposed" } as const

export function createAutoScroll(options: AutoScrollOptions) {
  const [state, setState] = createSignal(createAutoScrollState(untrack(options.working)))
  const [refs, setRefs] = createStore<{ scroll?: HTMLElement; content?: HTMLElement }>({})
  let attempts = 0
  let settleTimer: ReturnType<typeof setTimeout> | undefined

  // Scroll, resize and pin run every frame while content streams; reuse their events instead of allocating.
  const resizeEvent = { type: "resize" as const, overflow: false }
  const scrollEvent = { type: "scroll" as const, overflow: false, scrollTop: 0, maxScroll: 0, threshold: 0 }
  const pauseEvent = { type: "pause" as const, overflow: false }
  const flightEvent = { type: "flight.started" as const, top: 0 }

  const dispatch = (event: AutoScrollEvent) => {
    const result = transitionAutoScroll(untrack(state), event)
    setState(result.state)
    result.effects.forEach(run)
  }

  const run = (effect: AutoScrollEffect) => {
    if (effect.type === "pin.bottom") return pin()

    if (effect.type === "notify.interacted") return options.onUserInteracted?.()
    clearTimeout(settleTimer)

    if (effect.type === "settle.stop") return
    const attempt = effect.attempt
    settleTimer = setTimeout(() => dispatch({ type: "settle.elapsed", attempt }), SETTLE_MS)
  }

  const pin = () => {
    const el = refs.scroll

    if (!el || !el.isConnected) return
    const before = el.scrollTop

    if (el.scrollHeight - el.clientHeight - before <= END_EPSILON) return
    // `scrollTop` assignment bypasses any CSS `scroll-behavior: smooth`.
    el.scrollTop = el.scrollHeight
    const after = el.scrollTop

    // The browser queues a `scroll` event only when the position actually moved.
    if (Math.abs(after - before) <= END_EPSILON) return
    flightEvent.top = after
    dispatch(flightEvent)
  }

  const pause = () => {
    const el = refs.scroll

    if (!el || !el.isConnected) return
    pauseEvent.overflow = canScroll(el)
    dispatch(pauseEvent)
  }

  const handleWheel = (e: WheelEvent) => {
    if (e.deltaY >= 0) return
    // If the user is scrolling within a nested scrollable region (tool output,
    // code block, etc), don't treat it as leaving the "follow bottom" mode.
    // Those regions opt in via `data-scrollable`.
    const nested = e.target instanceof Element ? e.target.closest("[data-scrollable]") : null

    if (nested && nested !== refs.scroll) return
    pause()
  }

  const handleScroll = () => {
    const el = refs.scroll

    if (!el || !el.isConnected) return
    scrollEvent.maxScroll = el.scrollHeight - el.clientHeight
    scrollEvent.overflow = canScroll(el)
    scrollEvent.scrollTop = el.scrollTop
    scrollEvent.threshold = options.bottomThreshold ?? 10
    dispatch(scrollEvent)
  }

  const handleInteraction = () => {
    if (!selectPausesOnSelection(untrack(state))) return
    const selection = window.getSelection()

    if (!selection || selection.isCollapsed || selection.toString().length === 0) return
    pause()
  }

  createEffect(() => {
    const el = refs.scroll
    const content = refs.content

    if (!el || typeof ResizeObserver === "undefined") return

    // ResizeObserver fires after layout, before paint. Keeping the bottom locked in
    // the same frame avoids visible "jump up then catch up" artifacts while streaming.
    const observer = new ResizeObserver(() => {
      if (!el.isConnected) return
      resizeEvent.overflow = canScroll(el)
      dispatch(resizeEvent)
    })

    observer.observe(el)

    if (content) observer.observe(content)
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    const el = refs.scroll

    if (!el) return
    const root = el.closest("main")

    if (!root) return
    const contains = (node: Node) => node.contains(el)

    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        if ([...record.removedNodes].some(contains)) dispatch(DETACHED)

        if ([...record.addedNodes].some(contains)) dispatch({ type: "scroller.reattached", overflow: canScroll(el) })
      })
    })

    observer.observe(root, { childList: true })
    onCleanup(() => observer.disconnect())
  })

  createEffect(
    on(options.working, (working) => {
      if (!working) attempts += 1
      dispatch({ type: "working.changed", working, attempt: attempts })
    }),
  )

  const userScrolled = createMemo(() => selectUserScrolled(state()))
  const overflowAnchor = createMemo(() => selectOverflowAnchor(state(), options.overflowAnchor))

  createEffect(() => {
    const el = refs.scroll

    if (!el) return
    el.style.overflowAnchor = overflowAnchor()
  })

  createEventListener(() => refs.scroll, "wheel", handleWheel, { passive: true })

  onCleanup(() => dispatch(DISPOSE))

  return {
    scrollRef: (el: HTMLElement | undefined) => {
      if (el === untrack(() => refs.scroll)) return
      setRefs("scroll", el)
      dispatch({ type: "scroller.changed", overflow: !!el && el.isConnected && canScroll(el) })
    },
    contentRef: (el: HTMLElement | undefined) => setRefs("content", el),
    handleScroll,
    handleInteraction,
    pause,
    resume: () => dispatch(FORCE_BOTTOM),
    scrollToBottom: () => dispatch(BOTTOM),
    forceScrollToBottom: () => dispatch(FORCE_BOTTOM),
    userScrolled,
  }
}

function canScroll(el: HTMLElement) {
  return el.scrollHeight - el.clientHeight > 1
}
