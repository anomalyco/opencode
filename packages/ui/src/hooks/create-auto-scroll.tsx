import { createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"

export interface AutoScrollOptions {
  working: () => boolean
  onUserInteracted?: () => void
}

export function createAutoScroll(options: AutoScrollOptions) {
  let scrollRef: HTMLElement | undefined
  // We use a store for refs to be compatible with the existing API,
  // but strictly speaking signals would work too.
  const [store, setStore] = createStore({
    contentRef: undefined as HTMLElement | undefined,
    userScrolled: false,
  })

  // Internal state
  let lastScrollTop = 0
  let isAutoScrolling = false
  let autoScrollTimeout: ReturnType<typeof setTimeout> | undefined
  let isMouseDown = false
  let cleanupListeners: (() => void) | undefined

  function scrollToBottom() {
    if (!scrollRef || store.userScrolled || !options.working()) return

    isAutoScrolling = true
    if (autoScrollTimeout) clearTimeout(autoScrollTimeout)
    // Safety timeout to clear auto-scrolling state
    autoScrollTimeout = setTimeout(() => {
      isAutoScrolling = false
    }, 1000)

    try {
      scrollRef.scrollTo({
        top: scrollRef.scrollHeight,
        behavior: "smooth",
      })
    } catch {
      // Fallback for environments where scrollTo options might fail
      if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight
      isAutoScrolling = false
    }
  }

  function handleScroll() {
    if (!scrollRef) return

    const { scrollTop, scrollHeight, clientHeight } = scrollRef
    // Use a small tolerance for "at bottom" detection
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
      // We reached the bottom, so we're "locked" again.
      if (store.userScrolled) {
        setStore("userScrolled", false)
      }
      lastScrollTop = scrollTop
      return
    }

    // Check for user intention to scroll up.
    // We rely on explicit interaction events (wheel, touch, keys) for most cases,
    // and use mousedown + scroll delta for scrollbar dragging.
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

  // Handle content resize
  createResizeObserver(
    () => store.contentRef,
    () => {
      // When content changes size, if we are sticky, scroll to bottom.
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
    userScrolled: () => store.userScrolled,
  }
}
