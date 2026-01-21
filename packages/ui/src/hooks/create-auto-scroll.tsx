import { createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"

export interface AutoScrollOptions {
  working: () => boolean
  onUserInteracted?: () => void
  overflowAnchor?: "none" | "auto" | "dynamic"
  bottomThreshold?: number
}

export function createAutoScroll(options: AutoScrollOptions) {
  let scroll: HTMLElement | undefined
  let settling = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let cleanup: (() => void) | undefined
  let resizeFrame: number | undefined

  const threshold = () => options.bottomThreshold ?? 10

  const [store, setStore] = createStore({
    contentRef: undefined as HTMLElement | undefined,
    userScrolled: false,
  })

  const active = () => options.working() || settling

  const distanceFromBottom = (el: HTMLElement) => {
    return el.scrollHeight - el.clientHeight - el.scrollTop
  }

  const scrollToBottomNow = (behavior: ScrollBehavior) => {
    const el = scroll
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }

  const scrollToBottom = (force: boolean) => {
    if (!force && !active()) return
    const el = scroll
    if (!el) return

    if (!force && store.userScrolled) return
    if (force && store.userScrolled) setStore("userScrolled", false)

    const distance = distanceFromBottom(el)
    if (distance < 2) return

    // For auto-following content we prefer immediate updates to avoid
    // visible "catch up" animations while content is still settling.
    scrollToBottomNow("auto")
  }

  const stop = () => {
    if (store.userScrolled) return

    setStore("userScrolled", true)
    options.onUserInteracted?.()
  }

  const handleWheel = (e: WheelEvent) => {
    if (e.deltaY >= 0) return
    // If the user is scrolling within a nested scrollable region (tool output,
    // code block, etc), don't treat it as leaving the "follow bottom" mode.
    // Those regions opt in via `data-scrollable`.
    const el = scroll
    const target = e.target instanceof Element ? e.target : undefined
    const nested = target?.closest("[data-scrollable]")
    if (el && nested && nested !== el) return
    stop()
  }

  const handleScroll = () => {
    const el = scroll
    if (!el) return

    if (distanceFromBottom(el) < threshold()) {
      if (store.userScrolled) setStore("userScrolled", false)
      return
    }

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
      if (!active()) return
      if (store.userScrolled) return
      if (resizeFrame !== undefined) return
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined
        scrollToBottom(false)
      })
    },
  )

  createEffect(
    on(options.working, (working) => {
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
    const el = scroll
    if (!el) return
    updateOverflowAnchor(el)
  })

  onCleanup(() => {
    if (settleTimer) clearTimeout(settleTimer)
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
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
    userScrolled: () => store.userScrolled,
  }
}
