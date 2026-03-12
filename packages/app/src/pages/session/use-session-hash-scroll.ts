import type { UserMessage } from "@opencode-ai/sdk/v2"
import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { messageIdFromHash } from "./message-id-from-hash"

export const useSessionHashScroll = (input: {
  sessionKey: () => string
  sessionID: () => string | undefined
  messagesReady: () => boolean
  visibleUserMessages: () => UserMessage[]
  turnStart: () => number
  currentMessageId: () => string | undefined
  pendingMessage: () => string | undefined
  setPendingMessage: (value: string | undefined) => void
  setActiveMessage: (message: UserMessage | undefined) => void
  setTurnStart: (value: number) => void
  autoScroll: { pause: () => void; forceScrollToBottom: () => void }
  scroller: () => HTMLDivElement | undefined
  anchor: (id: string) => string
  scheduleScrollState: (el: HTMLDivElement) => void
  consumePendingMessage: (key: string) => string | undefined
}) => {
  const visibleUserMessages = createMemo(() => input.visibleUserMessages())
  const messageById = createMemo(() => new Map(visibleUserMessages().map((m) => [m.id, m])))
  const messageIndex = createMemo(() => new Map(visibleUserMessages().map((m, i) => [m.id, i])))
  let pendingKey = ""
  let clearing = false

  const location = useLocation()
  const navigate = useNavigate()

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
    const top = Math.max(0, a.top - b.top + root.scrollTop - inset)
    root.scrollTo({ top, behavior })
    return true
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
    if (input.currentMessageId() !== message.id) input.setActiveMessage(message)

    const index = messageIndex().get(message.id) ?? -1
    if (index !== -1 && index < input.turnStart()) {
      input.setTurnStart(index)

      queue(() => {
        seek(message.id, behavior)
      })

      updateHash(message.id)
      return
    }

    if (seek(message.id, behavior)) {
      updateHash(message.id)
      return
    }

    updateHash(message.id)
  }

  const applyHash = (behavior: ScrollBehavior) => {
    const hash = location.hash.slice(1)
    if (!hash) {
      input.autoScroll.forceScrollToBottom()
      const el = input.scroller()
      if (el) input.scheduleScrollState(el)
      return
    }

    const messageId = messageIdFromHash(hash)
    if (messageId) {
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
      input.autoScroll.pause()
      scrollToElement(target, behavior)
      return
    }

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
    input.turnStart()

    let targetId = input.pendingMessage()
    if (!targetId) {
      const key = input.sessionKey()
      if (pendingKey !== key) {
        pendingKey = key
        const next = input.consumePendingMessage(key)
        if (next) {
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

    if (pending) input.setPendingMessage(undefined)
    if (input.currentMessageId() === targetId && !pending) return

    input.autoScroll.pause()
    cancel()
    queue(() => scrollToMessage(msg, "auto"))
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
