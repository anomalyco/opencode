import { createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"

export interface AutoScrollOptions {
  working: () => boolean
  onUserInteracted?: () => void
}

export function createAutoScroll(options: AutoScrollOptions) {
  let scrollRef: HTMLElement | undefined
  const [store, setStore] = createStore({
    contentRef: undefined as HTMLElement | undefined,
    userScrolled: false,
  })

  let lastScrollTop = 0
  let isAutoScrolling = false
  let autoScrollTimeout: ReturnType<typeof setTimeout> | undefined
  let isMouseDown = false
  let cleanupListeners: (() => void) | undefined
  let scheduledScroll = false
  let scheduledForce = false

  function distanceFromBottom() {
    if (!scrollRef) return 0
    return scrollRef.scrollHeight - scrollRef.clientHeight - scrollRef.scrollTop
  }

  function startAutoScroll() {
    isAutoScrolling = true
    if (autoScrollTimeout) clearTimeout(autoScrollTimeout)
    autoScrollTimeout = setTimeout(() => {
      isAutoScrolling = false
    }, 1000)
  }

  function scrollToBottomNow() {
    if (!scrollRef || store.userScrolled || !options.working()) return

    const distance = distanceFromBottom()
    if (distance < 2) return

    const behavior = distance > 96 ? "auto" : "smooth"
    startAutoScroll()
    scrollRef.scrollTo({
      top: scrollRef.scrollHeight,
      behavior,
    })
  }

  function forceScrollToBottomNow() {
    if (!scrollRef) return

    if (store.userScrolled) setStore("userScrolled", false)

    const distance = distanceFromBottom()
    if (distance < 2) return

    startAutoScroll()
    scrollRef.scrollTo({
      top: scrollRef.scrollHeight,
      behavior: "auto",
    })
  }

  function scheduleScrollToBottom(force = false) {
    if (typeof requestAnimationFrame === "undefined") {
      if (force) {
        forceScrollToBottomNow()
        return
      }
      scrollToBottomNow()
      return
    }

    if (force) scheduledForce = true
    if (scheduledScroll) return

    scheduledScroll = true
    requestAnimationFrame(() => {
      scheduledScroll = false

      const shouldForce = scheduledForce
      scheduledForce = false

      if (shouldForce) {
        forceScrollToBottomNow()
        return
      }

      scrollToBottomNow()
    })
  }

  function scrollToBottom() {
    scheduleScrollToBottom(false)
  }

  function forceScrollToBottom() {
    scheduleScrollToBottom(true)
  }

  function handleScroll() {
    if (!scrollRef) return

    const { scrollTop, scrollHeight, clientHeight } = scrollRef
    const atBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10

    if (isAutoScrolling) {
      if (atBottom) {
        isAutoScrolling = false
        if (autoScrollTimeout) clearTimeout(autoScrollTimeout)
      }
      lastScrollTop = scrollTop
      return
    }

    if (atBottom) {
      if (store.userScrolled) {
        setStore("userScrolled", false)
      }
      lastScrollTop = scrollTop
      return
    }

    const delta = scrollTop - lastScrollTop
    if (delta < 0) {
      if (isMouseDown && !store.userScrolled && options.working()) {
        setStore("userScrolled", true)
        options.onUserInteracted?.()
      }
    }

    lastScrollTop = scrollTop
  }

  function handleInteraction() {
    if (options.working()) {
      setStore("userScrolled", true)
      options.onUserInteracted?.()
    }
  }

  function handleWheel(e: WheelEvent) {
    if (e.deltaY < 0 && !store.userScrolled && options.working()) {
      setStore("userScrolled", true)
      options.onUserInteracted?.()
    }
  }

  function handleTouchStart() {
    if (!store.userScrolled && options.working()) {
      setStore("userScrolled", true)
      options.onUserInteracted?.()
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (["ArrowUp", "PageUp", "Home"].includes(e.key)) {
      if (!store.userScrolled && options.working()) {
        setStore("userScrolled", true)
        options.onUserInteracted?.()
      }
    }
  }

  function handleMouseDown() {
    isMouseDown = true
    window.addEventListener("mouseup", handleMouseUp)
  }

  function handleMouseUp() {
    isMouseDown = false
    window.removeEventListener("mouseup", handleMouseUp)
  }

  // Reset userScrolled when work completes
  createEffect(() => {
    if (!options.working()) {
      setStore("userScrolled", false)
    }
  })

  // Ensure pinned-to-bottom stays pinned during heavy DOM updates
  createEffect(() => {
    const el = store.contentRef
    if (!el) return

    const observer = new MutationObserver(() => {
      if (store.userScrolled) return
      if (!options.working()) return
      scheduleScrollToBottom(false)
    })
    observer.observe(el, { childList: true, subtree: true, characterData: true })
    onCleanup(() => observer.disconnect())
  })

  // Handle content resize
  createResizeObserver(
    () => store.contentRef,
    () => {
      if (options.working() && !store.userScrolled) {
        scrollToBottom()
      }
    },
  )

  onCleanup(() => {
    if (autoScrollTimeout) clearTimeout(autoScrollTimeout)
    if (cleanupListeners) cleanupListeners()
  })

  return {
    scrollRef: (el: HTMLElement | undefined) => {
      if (cleanupListeners) {
        cleanupListeners()
        cleanupListeners = undefined
      }

      scrollRef = el
      if (el) {
        lastScrollTop = el.scrollTop
        el.style.overflowAnchor = "none"

        el.addEventListener("wheel", handleWheel, { passive: true })
        el.addEventListener("touchstart", handleTouchStart, { passive: true })
        el.addEventListener("keydown", handleKeyDown)
        el.addEventListener("mousedown", handleMouseDown)

        cleanupListeners = () => {
          el.removeEventListener("wheel", handleWheel)
          el.removeEventListener("touchstart", handleTouchStart)
          el.removeEventListener("keydown", handleKeyDown)
          el.removeEventListener("mousedown", handleMouseDown)
          window.removeEventListener("mouseup", handleMouseUp)
        }
      }
    },
    contentRef: (el: HTMLElement | undefined) => setStore("contentRef", el),
    handleScroll,
    handleInteraction,
    scrollToBottom,
    forceScrollToBottom,
    userScrolled: () => store.userScrolled,
  }
}
