import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { UserMessage } from "@opencode-ai/sdk/v2"

export const messageIdFromHash = (hash: string) => {
  const value = hash.startsWith("#") ? hash.slice(1) : hash
  const match = value.match(/^message-(.+)$/)
  if (!match) return
  return match[1]
}

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
  scheduleTurnBackfill: () => void
  autoScroll: { pause: () => void; forceScrollToBottom: () => void }
  scroller: () => HTMLDivElement | undefined
  anchor: (id: string) => string
  scheduleScrollState: (el: HTMLDivElement) => void
  consumePendingMessage: (key: string) => string | undefined
}) => {
  const visibleUserMessages = createMemo(() => input.visibleUserMessages())
  const messageById = createMemo(() => new Map(visibleUserMessages().map((m) => [m.id, m])))
  const messageIndex = createMemo(() => new Map(visibleUserMessages().map((m, i) => [m.id, i])))

  const clearMessageHash = () => {
    if (!window.location.hash) return
    window.history.replaceState(null, "", window.location.href.replace(/#.*$/, ""))
  }

  const updateHash = (id: string) => {
    window.history.replaceState(null, "", `#${input.anchor(id)}`)
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

  const scrollToMessage = (message: UserMessage, behavior: ScrollBehavior = "smooth") => {
    if (input.currentMessageId() !== message.id) input.setActiveMessage(message)

    const index = messageIndex().get(message.id) ?? -1
    if (index !== -1 && index < input.turnStart()) {
      input.setTurnStart(index)
      input.scheduleTurnBackfill()

      requestAnimationFrame(() => {
        const el = document.getElementById(input.anchor(message.id))
        if (!el) {
          requestAnimationFrame(() => {
            const next = document.getElementById(input.anchor(message.id))
            if (!next) return
            scrollToElement(next, behavior)
          })
          return
        }
        scrollToElement(el, behavior)
      })

      updateHash(message.id)
      return
    }

    const el = document.getElementById(input.anchor(message.id))
    if (!el) {
      updateHash(message.id)
      requestAnimationFrame(() => {
        const next = document.getElementById(input.anchor(message.id))
        if (!next) return
        if (!scrollToElement(next, behavior)) return
      })
      return
    }
    if (scrollToElement(el, behavior)) {
      updateHash(message.id)
      return
    }

    requestAnimationFrame(() => {
      const next = document.getElementById(input.anchor(message.id))
      if (!next) return
      if (!scrollToElement(next, behavior)) return
    })
    updateHash(message.id)
  }

  const applyHash = (behavior: ScrollBehavior) => {
    const hash = window.location.hash.slice(1)
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

  createEffect(
    on(input.sessionKey, (key) => {
      if (!input.sessionID()) return
      const messageID = input.consumePendingMessage(key)
      if (!messageID) return
      input.setPendingMessage(messageID)
    }),
  )

  createEffect(() => {
    if (!input.sessionID() || !input.messagesReady()) return
    requestAnimationFrame(() => applyHash("auto"))
  })

  createEffect(() => {
    if (!input.sessionID() || !input.messagesReady()) return

    visibleUserMessages()
    input.turnStart()

    const targetId = input.pendingMessage() ?? messageIdFromHash(window.location.hash)
    if (!targetId) return
    if (input.currentMessageId() === targetId) return

    const msg = messageById().get(targetId)
    if (!msg) return

    if (input.pendingMessage() === targetId) input.setPendingMessage(undefined)
    input.autoScroll.pause()
    requestAnimationFrame(() => scrollToMessage(msg, "auto"))
  })

  createEffect(() => {
    if (!input.sessionID() || !input.messagesReady()) return
    const handler = () => requestAnimationFrame(() => applyHash("auto"))
    window.addEventListener("hashchange", handler)
    onCleanup(() => window.removeEventListener("hashchange", handler))
  })

  return {
    clearMessageHash,
    scrollToMessage,
    applyHash,
  }
}
