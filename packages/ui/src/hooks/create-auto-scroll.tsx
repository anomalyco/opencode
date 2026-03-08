import { createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { animate, type AnimationPlaybackControls } from "motion"
import { FAST_SPRING } from "../components/motion"

export interface AutoScrollOptions {
  working: () => boolean
  onUserInteracted?: () => void
  overflowAnchor?: "none" | "auto" | "dynamic"
  bottomThreshold?: number
}

const SETTLE_MS = 500
const AUTO_SCROLL_GRACE_MS = 120
const AUTO_SCROLL_EPSILON = 0.5
const MANUAL_ANCHOR_MS = 3000
const MANUAL_ANCHOR_QUIET_FRAMES = 24

export function createAutoScroll(options: AutoScrollOptions) {
  let scroll: HTMLElement | undefined
  let settling = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let cleanup: (() => void) | undefined
  let programmaticUntil = 0
  let scrollAnim: AnimationPlaybackControls | undefined
  let hold:
    | {
        el: HTMLElement
        top: number
        until: number
        quiet: number
        frame: number | undefined
      }
    | undefined

  const threshold = () => options.bottomThreshold ?? 10

  const [store, setStore] = createStore({
    contentRef: undefined as HTMLElement | undefined,
    userScrolled: false,
  })

  const active = () => options.working() || settling

  const distanceFromBottom = (el: HTMLElement) => {
    // With column-reverse, scrollTop=0 is at the bottom, negative = scrolled up
    return Math.abs(el.scrollTop)
  }

  const canScroll = (el: HTMLElement) => {
    return el.scrollHeight - el.clientHeight > 1
  }

  const markProgrammatic = () => {
    programmaticUntil = Date.now() + AUTO_SCROLL_GRACE_MS
  }

  const clearHold = () => {
    const next = hold
    if (!next) return
    if (next.frame !== undefined) cancelAnimationFrame(next.frame)
    hold = undefined
  }

  const tickHold = () => {
    const next = hold
    const el = scroll
    if (!next || !el) return false
    if (Date.now() > next.until) {
      clearHold()
      return false
    }
    if (!next.el.isConnected) {
      clearHold()
      return false
    }

    const current = next.el.getBoundingClientRect().top
    if (!Number.isFinite(current)) {
      clearHold()
      return false
    }

    const delta = current - next.top
    if (Math.abs(delta) <= AUTO_SCROLL_EPSILON) {
      next.quiet += 1
      if (next.quiet > MANUAL_ANCHOR_QUIET_FRAMES) {
        clearHold()
        return false
      }
      return true
    }

    next.quiet = 0
    if (!store.userScrolled) {
      setStore("userScrolled", true)
      options.onUserInteracted?.()
    }
    el.scrollTop += delta
    markProgrammatic()
    return true
  }

  const scheduleHold = () => {
    const next = hold
    if (!next) return
    if (next.frame !== undefined) return

    next.frame = requestAnimationFrame(() => {
      const value = hold
      if (!value) return
      value.frame = undefined
      if (!tickHold()) return
      scheduleHold()
    })
  }

  const preserve = (target: HTMLElement) => {
    const el = scroll
    if (!el) return

    if (!store.userScrolled) {
      setStore("userScrolled", true)
      options.onUserInteracted?.()
    }

    const top = target.getBoundingClientRect().top
    if (!Number.isFinite(top)) return

    clearHold()
    hold = {
      el: target,
      top,
      until: Date.now() + MANUAL_ANCHOR_MS,
      quiet: 0,
      frame: undefined,
    }
    scheduleHold()
  }

  const scrollToBottom = (force: boolean) => {
    if (!force && !active()) return

    clearHold()

    if (force && store.userScrolled) setStore("userScrolled", false)

    const el = scroll
    if (!el) return

    if (scrollAnim) cancelSmooth()
    if (!force && store.userScrolled) return

    // With column-reverse, scrollTop=0 is at the bottom
    if (Math.abs(el.scrollTop) <= AUTO_SCROLL_EPSILON) {
      markProgrammatic()
      return
    }

    el.scrollTop = 0
    markProgrammatic()
  }

  const cancelSmooth = () => {
    if (scrollAnim) {
      scrollAnim.stop()
      scrollAnim = undefined
    }
  }

  const smoothScrollToBottom = () => {
    const el = scroll
    if (!el) return

    cancelSmooth()
    if (store.userScrolled) setStore("userScrolled", false)

    // With column-reverse, scrollTop=0 is at the bottom
    if (Math.abs(el.scrollTop) <= AUTO_SCROLL_EPSILON) {
      markProgrammatic()
      return
    }

    scrollAnim = animate(el.scrollTop, 0, {
      ...FAST_SPRING,
      onUpdate: (v) => {
        markProgrammatic()
        el.scrollTop = v
      },
      onComplete: () => {
        scrollAnim = undefined
        markProgrammatic()
      },
    })
  }

  const stop = (input?: { hold?: boolean }) => {
    if (input?.hold !== false) clearHold()

    const el = scroll
    if (!el) return
    if (!canScroll(el)) {
      if (store.userScrolled) setStore("userScrolled", false)
      return
    }
    if (store.userScrolled) return

    markProgrammatic()
    setStore("userScrolled", true)
    options.onUserInteracted?.()
  }

  const handleWheel = (e: WheelEvent) => {
    if (e.deltaY !== 0) clearHold()

    if (e.deltaY > 0) {
      const el = scroll
      if (!el) return
      if (distanceFromBottom(el) >= threshold()) return
      if (store.userScrolled) setStore("userScrolled", false)
      markProgrammatic()
      return
    }

    if (e.deltaY >= 0) return
    cancelSmooth()
    const el = scroll
    const target = e.target instanceof Element ? e.target : undefined
    const nested = target?.closest("[data-scrollable]")
    if (el && nested && nested !== el) return
    stop()
  }

  const handleScroll = () => {
    const el = scroll
    if (!el) return

    if (hold) {
      if (Date.now() < programmaticUntil) return
      clearHold()
    }

    if (!canScroll(el)) {
      if (store.userScrolled) setStore("userScrolled", false)
      markProgrammatic()
      return
    }

    if (distanceFromBottom(el) < threshold()) {
      if (Date.now() < programmaticUntil) return
      if (store.userScrolled) setStore("userScrolled", false)
      markProgrammatic()
      return
    }

    if (!store.userScrolled && Date.now() < programmaticUntil) return

    stop({ hold: false })
  }

  const handleInteraction = () => {
    if (!active()) return
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) {
      stop()
    }
  }

  const updateOverflowAnchor = (el: HTMLElement) => {
    if (hold) {
      el.style.overflowAnchor = "none"
      return
    }

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
      const el = scroll
      if (hold) {
        scheduleHold()
        return
      }
      if (el && !canScroll(el)) {
        if (store.userScrolled) setStore("userScrolled", false)
        markProgrammatic()
        return
      }
      if (!active()) return
      if (store.userScrolled) return
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
      }, SETTLE_MS)
    }),
  )

  createEffect(() => {
    store.userScrolled
    const el = scroll
    if (!el) return
    updateOverflowAnchor(el)
  })

  onCleanup(() => {
    if (settleTimer) clearTimeout(settleTimer)
    clearHold()
    cancelSmooth()
    if (cleanup) cleanup()
  })

  return {
    scrollRef: (el: HTMLElement | undefined) => {
      if (cleanup) {
        cleanup()
        cleanup = undefined
      }

      scroll = el

      if (!el) {
        clearHold()
        return
      }

      markProgrammatic()
      updateOverflowAnchor(el)
      el.addEventListener("wheel", handleWheel, { passive: true })

      cleanup = () => {
        el.removeEventListener("wheel", handleWheel)
      }
    },
    contentRef: (el: HTMLElement | undefined) => setStore("contentRef", el),
    handleScroll,
    handleInteraction,
    preserve,
    pause: stop,
    forceScrollToBottom: () => scrollToBottom(true),
    smoothScrollToBottom,
    snapToBottom: () => {
      const el = scroll
      if (!el) return
      if (store.userScrolled) setStore("userScrolled", false)
      // With column-reverse, scrollTop=0 is at the bottom
      el.scrollTop = 0
      markProgrammatic()
    },
    userScrolled: () => store.userScrolled,
  }
}
