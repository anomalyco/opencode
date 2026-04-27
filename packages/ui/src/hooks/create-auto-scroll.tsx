import { createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"

// Module-level flag to temporarily suppress resize-triggered auto-scrolling.
// Used when user-initiated layout changes (e.g. collapsible toggle) would
// otherwise cause unwanted scrollToBottom calls via ResizeObserver.
let resizeSuppressCount = 0

/**
 * Suppress resize-triggered auto-scrolling for the duration of a layout change.
 * The suppression covers the current frame plus one additional animation frame
 * to account for Kobalte's measurement phase and subsequent reflow.
 */
export function suppressAutoScrollResize() {
  resizeSuppressCount++
  // Two rAF frames: first for the synchronous layout triggered by the toggle,
  // second for any async reflow (e.g. Kobalte measuring then restoring styles).
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      resizeSuppressCount--
    })
  })
}

export interface AutoScrollOptions {
  working: () => boolean
  onUserInteracted?: () => void
  overflowAnchor?: "none" | "auto" | "dynamic"
  bottomThreshold?: number
  resize?: "follow" | "off"
}

export function createAutoScroll(options: AutoScrollOptions) {
  let settling = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let autoTimer: ReturnType<typeof setTimeout> | undefined
  let auto: { top: number; time: number } | undefined

  const threshold = () => options.bottomThreshold ?? 10
  const log = (event: string, extra?: Record<string, unknown>) => {
    if (!event || !extra) return
    console.debug(`[auto-scroll] ${event}`, extra)
  }

  const atBottom = (el: HTMLElement) => {
    return distanceFromBottom(el) <= threshold()
  }

  const [store, setStore] = createStore({
    contentRef: undefined as HTMLElement | undefined,
    scrollRef: undefined as HTMLElement | undefined,
    userScrolled: false,
  })

  const active = () => options.working() || settling

  const distanceFromBottom = (el: HTMLElement) => {
    return el.scrollHeight - el.clientHeight - el.scrollTop
  }

  const snap = (el: HTMLElement) => {
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    return {
      top: Math.round(el.scrollTop),
      height: Math.round(el.scrollHeight),
      client: Math.round(el.clientHeight),
      max: Math.round(max),
      gap: Math.round(max - el.scrollTop),
    }
  }

  const canScroll = (el: HTMLElement) => {
    return el.scrollHeight - el.clientHeight > 1
  }

  // Browsers can dispatch scroll events asynchronously. If new content arrives
  // between us calling `scrollTo()` and the subsequent `scroll` event firing,
  // the handler can see a non-zero `distanceFromBottom` and incorrectly assume
  // the user scrolled.
  const markAuto = (el: HTMLElement) => {
    auto = {
      top: Math.max(0, el.scrollHeight - el.clientHeight),
      time: Date.now(),
    }

    if (autoTimer) clearTimeout(autoTimer)
    autoTimer = setTimeout(() => {
      auto = undefined
      autoTimer = undefined
    }, 1500)
  }

  const isAuto = (el: HTMLElement) => {
    const a = auto
    if (!a) return false

    if (Date.now() - a.time > 1500) {
      auto = undefined
      return false
    }

    return Math.abs(el.scrollTop - a.top) <= threshold() || atBottom(el)
  }

  const scrollToBottomNow = (behavior: ScrollBehavior) => {
    const el = store.scrollRef
    if (!el) return
    const before = snap(el)
    markAuto(el)
    log("scroll:write", { source: "scrollToBottomNow", behavior, nextTop: el.scrollHeight })
    if (behavior === "smooth") {
      el.scrollTo({ top: el.scrollHeight, behavior })
      return
    }

    // `scrollTop` assignment bypasses any CSS `scroll-behavior: smooth`.
    el.scrollTop = el.scrollHeight
    const after = snap(el)
    const jump = after.top - before.top
    if (jump < -24) {
      console.warn("[auto-scroll] upward write", {
        behavior,
        jump,
        before,
        after,
      })
    }
  }

  const scrollToBottom = (force: boolean) => {
    if (!force && !active()) return

    if (force && store.userScrolled) setStore("userScrolled", false)

    const el = store.scrollRef
    if (!el) return

    if (!force && store.userScrolled) return

    if (atBottom(el)) {
      markAuto(el)
      return
    }

    // For auto-following content we prefer immediate updates to avoid
    // visible "catch up" animations while content is still settling.
    scrollToBottomNow("auto")
  }

  const stop = () => {
    const el = store.scrollRef
    if (!el) return
    if (!canScroll(el)) {
      log("stop:skip", { source: "stop", why: "cannot-scroll" })
      if (store.userScrolled) setStore("userScrolled", false)
      return
    }
    if (store.userScrolled) {
      log("stop:skip", { source: "stop", why: "already-stopped" })
      return
    }

    log("state:set", { source: "stop", nextUserScrolled: true })
    setStore("userScrolled", true)
    options.onUserInteracted?.()
  }

  const handleWheel = (e: WheelEvent) => {
    if (e.deltaY >= 0) return
    // If the user is scrolling within a nested scrollable region (tool output,
    // code block, etc), don't treat it as leaving the "follow bottom" mode.
    // Those regions opt in via `data-scrollable`.
    const el = store.scrollRef
    const target = e.target instanceof Element ? e.target : undefined
    const nested = target?.closest("[data-scrollable]")
    if (el && nested && nested !== el) {
      log("wheel:skip", { source: "handleWheel", why: "nested-scrollable", deltaY: e.deltaY })
      return
    }
    log("wheel:up", { source: "handleWheel", deltaY: e.deltaY })
    stop()
  }

  const handleScroll = () => {
    const el = store.scrollRef
    if (!el) return

    if (!canScroll(el)) {
      log("scroll:state", { source: "handleScroll", why: "cannot-scroll" })
      if (store.userScrolled) setStore("userScrolled", false)
      return
    }

    if (atBottom(el)) {
      log("scroll:state", { source: "handleScroll", why: "at-bottom" })
      if (store.userScrolled) setStore("userScrolled", false)
      return
    }

    // Ignore scroll events triggered by our own scrollToBottom calls.
    if (!store.userScrolled && isAuto(el)) {
      log("scroll:state", { source: "handleScroll", why: "auto-scroll" })
      scrollToBottom(false)
      return
    }

    log("scroll:state", { source: "handleScroll", why: "user-scroll" })
    stop()
  }

  const handleInteraction = () => {
    if (!active()) return
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) {
      stop()
    }
  }

  const updateOverflowAnchor = (el: HTMLElement) => {
    const mode = options.overflowAnchor ?? "dynamic"

    if (mode === "none") {
      el.style.overflowAnchor = "none"
      return
    }

    if (mode === "auto") {
      el.style.overflowAnchor = "auto"
      return
    }

    el.style.overflowAnchor = store.userScrolled ? "auto" : "none"
  }

  createResizeObserver(
    () => store.contentRef,
    () => {
      if (options.resize === "off") return
      if (resizeSuppressCount > 0) return
      const el = scroll
      if (el && !canScroll(el)) {
        if (store.userScrolled) setStore("userScrolled", false)
        return
      }
      if (!active()) return
      if (store.userScrolled) return
      // ResizeObserver fires after layout, before paint.
      // Keep the bottom locked in the same frame to avoid visible
      // "jump up then catch up" artifacts while streaming content.
      scrollToBottom(false)
    },
  )

  createEffect(
    on(options.working, (working: boolean) => {
      settling = false
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = undefined

      if (working) {
        if (!store.userScrolled) scrollToBottom(true)
        return
      }

      settling = true
      settleTimer = setTimeout(() => {
        settling = false
      }, 300)
    }),
  )

  createEffect(() => {
    // Track `userScrolled` even before `scrollRef` is attached, so we can
    // update overflow anchoring once the element exists.
    store.userScrolled
    const el = store.scrollRef
    if (!el) return
    updateOverflowAnchor(el)
  })

  createEventListener(() => store.scrollRef, "wheel", handleWheel, { passive: true })

  onCleanup(() => {
    if (settleTimer) clearTimeout(settleTimer)
    if (autoTimer) clearTimeout(autoTimer)
  })

  return {
    scrollRef: (el: HTMLElement | undefined) => setStore("scrollRef", el),
    contentRef: (el: HTMLElement | undefined) => setStore("contentRef", el),
    handleScroll,
    handleInteraction,
    pause: stop,
    resume: () => {
      if (store.userScrolled) setStore("userScrolled", false)
      scrollToBottom(true)
    },
    scrollToBottom: () => scrollToBottom(false),
    forceScrollToBottom: () => scrollToBottom(true),
    userScrolled: () => store.userScrolled,
  }
}
