import { createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { animate, type AnimationPlaybackControls } from "motion"

export interface AutoScrollOptions {
  working: () => boolean
  onUserInteracted?: () => void
  overflowAnchor?: "none" | "auto" | "dynamic"
  bottomThreshold?: number
}

const SETTLE_MS = 500
const AUTO_SCROLL_GRACE_MS = 120
const AUTO_SCROLL_EPSILON = 1

export function createAutoScroll(options: AutoScrollOptions) {
  let scroll: HTMLElement | undefined
  let settling = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let cleanup: (() => void) | undefined
  let programmaticUntil = 0
  let scrollAnim: AnimationPlaybackControls | undefined

  const threshold = () => options.bottomThreshold ?? 10

  const [store, setStore] = createStore({
    contentRef: undefined as HTMLElement | undefined,
    userScrolled: false,
  })

  const active = () => options.working() || settling

  const distanceFromBottom = (el: HTMLElement) => {
    return el.scrollHeight - el.clientHeight - el.scrollTop
  }

  const canScroll = (el: HTMLElement) => {
    return el.scrollHeight - el.clientHeight > 1
  }

  const markProgrammatic = () => {
    programmaticUntil = Date.now() + AUTO_SCROLL_GRACE_MS
  }

  const scrollToBottom = (force: boolean) => {
    if (!force && !active()) return
    const el = scroll
    if (!el) return

    if (!force && store.userScrolled) return
    if (force && store.userScrolled) setStore("userScrolled", false)

    const next = Math.max(0, el.scrollHeight - el.clientHeight)
    if (Math.abs(el.scrollTop - next) <= AUTO_SCROLL_EPSILON) {
      markProgrammatic()
      return
    }

    el.scrollTop = next
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

    const next = Math.max(0, el.scrollHeight - el.clientHeight)
    if (Math.abs(el.scrollTop - next) <= AUTO_SCROLL_EPSILON) {
      markProgrammatic()
      return
    }

    scrollAnim = animate(el.scrollTop, next, {
      type: "spring",
      visualDuration: 0.35,
      bounce: 0,
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

  const stop = () => {
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

    if (!canScroll(el)) {
      if (store.userScrolled) setStore("userScrolled", false)
      markProgrammatic()
      return
    }

    if (distanceFromBottom(el) < threshold()) {
      if (store.userScrolled) setStore("userScrolled", false)
      markProgrammatic()
      return
    }

    if (!store.userScrolled && Date.now() < programmaticUntil) return

    stop()
  }

  const handleInteraction = () => {
    if (!active()) return
    stop()
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
      const el = scroll
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

      if (!el) return

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
    pause: stop,
    resume: () => {
      if (store.userScrolled) setStore("userScrolled", false)
      scrollToBottom(true)
    },
    scrollToBottom: () => scrollToBottom(false),
    forceScrollToBottom: () => scrollToBottom(true),
    smoothScrollToBottom,
    snapToBottom: () => {
      const el = scroll
      if (!el) return
      if (store.userScrolled) setStore("userScrolled", false)
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
      markProgrammatic()
    },
    userScrolled: () => store.userScrolled,
  }
}
