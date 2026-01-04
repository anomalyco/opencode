import { createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"

export interface AutoScrollOptions {
  working: () => boolean
  onUserInteracted?: () => void
}

export function createAutoScroll(options: AutoScrollOptions) {
  let scroll: HTMLElement | undefined
  let settling = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined

  const [store, setStore] = createStore({
    contentRef: undefined as HTMLElement | undefined,
    userScrolled: false,
  })

  const active = () => options.working() || settling

  const distanceFromBottom = () => {
    const el = scroll
    if (!el) return 0
    return el.scrollHeight - el.clientHeight - el.scrollTop
  }

  const scrollToBottomNow = (behavior: ScrollBehavior) => {
    const el = scroll
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }

  const scrollToBottom = (force: boolean) => {
    if (!force && !active()) return
    if (!scroll) return

    if (!force && store.userScrolled) return
    if (force && store.userScrolled) setStore("userScrolled", false)

    const distance = distanceFromBottom()
    if (distance < 2) return

    const behavior: ScrollBehavior = force || distance > 96 ? "auto" : "smooth"
    scrollToBottomNow(behavior)
  }

  const handleScroll = () => {
    if (!options.working()) return
    if (!scroll) return

    if (distanceFromBottom() < 10) {
      if (store.userScrolled) setStore("userScrolled", false)
      return
    }

    if (store.userScrolled) return

    setStore("userScrolled", true)
    options.onUserInteracted?.()
  }

  const handleInteraction = () => {
    if (!options.working()) return
    if (store.userScrolled) return

    setStore("userScrolled", true)
    options.onUserInteracted?.()
  }

  createResizeObserver(
    () => store.contentRef,
    () => {
      if (!active()) return
      if (store.userScrolled) return
      scrollToBottom(false)
    },
  )

  createEffect(
    on(options.working, (working) => {
      settling = false
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = undefined

      setStore("userScrolled", false)

      if (working) {
        scrollToBottom(true)
        return
      }

      settling = true
      settleTimer = setTimeout(() => {
        settling = false
      }, 300)
    }),
  )

  onCleanup(() => {
    if (settleTimer) clearTimeout(settleTimer)
  })

  return {
    scrollRef: (el: HTMLElement | undefined) => {
      scroll = el
      if (el) el.style.overflowAnchor = "none"
    },
    contentRef: (el: HTMLElement | undefined) => setStore("contentRef", el),
    handleScroll,
    handleInteraction,
    scrollToBottom: () => scrollToBottom(false),
    forceScrollToBottom: () => scrollToBottom(true),
    userScrolled: () => store.userScrolled,
  }
}
