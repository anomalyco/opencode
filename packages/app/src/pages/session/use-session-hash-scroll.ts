import type { UserMessage } from "@opencode-ai/sdk/v2"
import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { messageIdFromHash } from "./message-id-from-hash"
import { targetTop } from "./use-session-scroll-utils"

export const useSessionHashScroll = (input: {
  sessionKey: () => string
  sessionID: () => string | undefined
  messagesReady: () => boolean
  live: () => boolean
  visibleUserMessages: () => UserMessage[]
  historyMore: () => boolean
  historyLoading: () => boolean
  loadMore: (sessionID: string) => Promise<void>
  currentMessageId: () => string | undefined
  pendingMessage: () => string | undefined
  setPendingMessage: (value: string | undefined) => void
  setActiveMessage: (message: UserMessage | undefined) => void
  enterLive: () => void
  enterAnchored: (id?: string) => void
  autoScroll: { pause: () => void; forceScrollToBottom: () => void }
  scroller: () => HTMLDivElement | undefined
  anchor: (id: string) => string
  scheduleScrollState: (el: HTMLDivElement) => void
  consumePendingMessage: (key: string) => string | undefined
}) => {
  const visibleUserMessages = createMemo(() => input.visibleUserMessages())
  const messageById = createMemo(() => new Map(visibleUserMessages().map((m) => [m.id, m])))
  let pendingKey = ""
  let freshKey = ""
  let fresh = true
  let clearing = false

  const location = useLocation()
  const navigate = useNavigate()

  createEffect(() => {
    const key = input.sessionKey()
    if (!key || key === freshKey) return
    freshKey = key
    fresh = true
  })

  const frames = new Set<number>()
  const queue = (fn: () => void) => {
    const id = requestAnimationFrame(() => {
      frames.delete(id)
      fn()
    })
    frames.add(id)
  }
  const cancel = () => {
    for (const id of frames) cancelAnimationFrame(id)
    frames.clear()
  }

  const clearMessageHash = () => {
    cancel()
    input.consumePendingMessage(input.sessionKey())
    if (input.pendingMessage()) input.setPendingMessage(undefined)
    if (!location.hash) return
    clearing = true
    navigate(location.pathname + location.search, { replace: true })
  }

  const updateHash = (id: string) => {
    const hash = `#${input.anchor(id)}`
    if (location.hash === hash) return
    clearing = false
    navigate(location.pathname + location.search + hash, {
      replace: true,
    })
  }

  const scrollToElement = (el: HTMLElement, behavior: ScrollBehavior) => {
    const root = input.scroller()
    if (!root) return false

    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    const sticky = root.querySelector("[data-session-title]")
    const inset = sticky instanceof HTMLElement ? sticky.offsetHeight : 0
    const top = targetTop({
      itemTop: a.top,
      rootTop: b.top,
      scrollTop: root.scrollTop,
      inset,
    })
    root.scrollTo({ top, behavior })
    return true
  }

  const settle = (id: string, left = 4) => {
    const el = document.getElementById(input.anchor(id))
    if (el instanceof HTMLElement) scrollToElement(el, "auto")
    if (left <= 0) return
    queue(() => {
      settle(id, left - 1)
    })
  }

  const seek = (id: string, behavior: ScrollBehavior, left = 4): boolean => {
    const el = document.getElementById(input.anchor(id))
    if (el) return scrollToElement(el, behavior)
    if (left <= 0) return false
    queue(() => {
      seek(id, behavior, left - 1)
    })
    return false
  }

  const scrollToMessage = (message: UserMessage, behavior: ScrollBehavior = "smooth") => {
    cancel()
    input.enterAnchored(message.id)
    if (input.currentMessageId() !== message.id) input.setActiveMessage(message)

    if (seek(message.id, behavior)) {
      updateHash(message.id)
      return
    }

    updateHash(message.id)
  }

  const applyHash = (behavior: ScrollBehavior) => {
    const hash = location.hash.slice(1)
    if (!hash) {
      if (!input.live() && !fresh) return
      fresh = false
      input.enterLive()
      input.autoScroll.forceScrollToBottom()
      const el = input.scroller()
      if (el) input.scheduleScrollState(el)
      return
    }

    const messageId = messageIdFromHash(hash)
    if (messageId) {
      input.enterAnchored(messageId)
      input.autoScroll.pause()
      const msg = messageById().get(messageId)
      if (msg) {
        scrollToMessage(msg, behavior)
        return
      }
      return
    }

    const target = document.getElementById(hash)
    if (target) {
      input.enterAnchored()
      input.autoScroll.pause()
      scrollToElement(target, behavior)
      return
    }

    input.enterLive()
    input.autoScroll.forceScrollToBottom()
    const el = input.scroller()
    if (el) input.scheduleScrollState(el)
  }

  createEffect(() => {
    const hash = location.hash
    if (!hash) clearing = false
    if (!input.sessionID() || !input.messagesReady()) return
    cancel()
    queue(() => applyHash("auto"))
  })

  createEffect(() => {
    if (!input.sessionID() || !input.messagesReady()) return

    visibleUserMessages()

    let targetId = input.pendingMessage()
    if (!targetId) {
      const key = input.sessionKey()
      if (pendingKey !== key) {
        pendingKey = key
        const next = input.consumePendingMessage(key)
        if (next) {
          if (!input.live() && !fresh) return
          input.setPendingMessage(next)
          targetId = next
        }
      }
    }
    if (!targetId && !clearing) targetId = messageIdFromHash(location.hash)
    if (!targetId) return

    const pending = input.pendingMessage() === targetId
    const msg = messageById().get(targetId)
    if (!msg) return

    fresh = false
    if (pending) input.setPendingMessage(undefined)
    if (input.currentMessageId() === targetId && !pending) return

    input.autoScroll.pause()
    cancel()
    queue(() => scrollToMessage(msg, "auto"))
  })

  createEffect(() => {
    const sessionID = input.sessionID()
    if (!sessionID || !input.messagesReady()) return

    visibleUserMessages()

    let targetId = input.pendingMessage()
    if (!targetId && !clearing) targetId = messageIdFromHash(location.hash)
    if (!targetId) return
    if (messageById().has(targetId)) return
    if (!input.historyMore() || input.historyLoading()) return

    void input.loadMore(sessionID)
  })

  onMount(() => {
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual"
    }
  })

  onCleanup(cancel)

  return {
    clearMessageHash,
    scrollToMessage,
    applyHash,
  }
}
