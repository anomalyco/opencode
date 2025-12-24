import { batch, createEffect } from "solid-js"
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
    lastScrollTop: 0,
    lastScrollHeight: 0,
    lastContentWidth: 0,
    autoScrolled: false,
    userScrolled: false,
    reflowing: false,
  })

  function scrollToBottom() {
    if (!scrollRef || store.userScrolled || !options.working()) return
    setStore("autoScrolled", true)
    const targetHeight = scrollRef.scrollHeight
    scrollRef.scrollTo({ top: targetHeight, behavior: "smooth" })

    // Wait for scroll to complete before clearing autoScrolled
    const checkScrollComplete = () => {
      if (!scrollRef) {
        setStore("autoScrolled", false)
        return
      }
      const atBottom = scrollRef.scrollTop + scrollRef.clientHeight >= scrollRef.scrollHeight - 10
      const reachedTarget = scrollRef.scrollTop >= targetHeight - scrollRef.clientHeight - 10
      if (atBottom || reachedTarget) {
        batch(() => {
          setStore("lastScrollTop", scrollRef?.scrollTop ?? 0)
          setStore("lastScrollHeight", scrollRef?.scrollHeight ?? 0)
          setStore("autoScrolled", false)
        })
      } else {
        requestAnimationFrame(checkScrollComplete)
      }
    }
    requestAnimationFrame(checkScrollComplete)
  }

  function handleScroll() {
    if (!scrollRef || store.autoScrolled) return

    const scrollTop = scrollRef.scrollTop
    const scrollHeight = scrollRef.scrollHeight

    if (store.reflowing) {
      batch(() => {
        setStore("lastScrollTop", scrollTop)
        setStore("lastScrollHeight", scrollHeight)
      })
      return
    }

    const scrollHeightChanged = Math.abs(scrollHeight - store.lastScrollHeight) > 10
    const scrollTopDelta = scrollTop - store.lastScrollTop

    // Handle reflow-caused scroll position changes
    if (scrollHeightChanged && scrollTopDelta < 0) {
      const heightRatio = store.lastScrollHeight > 0 ? scrollHeight / store.lastScrollHeight : 1
      const expectedScrollTop = store.lastScrollTop * heightRatio
      if (Math.abs(scrollTop - expectedScrollTop) < 100) {
        batch(() => {
          setStore("lastScrollTop", scrollTop)
          setStore("lastScrollHeight", scrollHeight)
        })
        return
      }
    }

    // Handle reset to top while working
    const reset = scrollTop <= 0 && store.lastScrollTop > 0 && options.working() && !store.userScrolled
    if (reset) {
      batch(() => {
        setStore("lastScrollTop", scrollTop)
        setStore("lastScrollHeight", scrollHeight)
      })
      requestAnimationFrame(scrollToBottom)
      return
    }

    // Detect intentional scroll up
    const scrolledUp = scrollTop < store.lastScrollTop - 50 && !scrollHeightChanged
    if (scrolledUp && options.working()) {
      setStore("userScrolled", true)
      options.onUserInteracted?.()
    }

    batch(() => {
      setStore("lastScrollTop", scrollTop)
      setStore("lastScrollHeight", scrollHeight)
    })
  }

  function handleInteraction() {
    if (options.working()) {
      setStore("userScrolled", true)
      options.onUserInteracted?.()
    }
  }

  // Reset userScrolled when work completes
  createEffect(() => {
    if (!options.working()) setStore("userScrolled", false)
  })

  // Handle content resize
  createResizeObserver(
    () => store.contentRef,
    ({ width }) => {
      const widthChanged = Math.abs(width - store.lastContentWidth) > 5
      if (widthChanged && store.lastContentWidth > 0) {
        setStore("reflowing", true)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setStore("reflowing", false)
            if (options.working() && !store.userScrolled) {
              scrollToBottom()
            }
          })
        })
      } else if (!store.reflowing) {
        scrollToBottom()
      }
      setStore("lastContentWidth", width)
    },
  )

  return {
    scrollRef: (el: HTMLElement | undefined) => {
      scrollRef = el
    },
    contentRef: (el: HTMLElement | undefined) => setStore("contentRef", el),
    handleScroll,
    handleInteraction,
    scrollToBottom,
    userScrolled: () => store.userScrolled,
  }
}
