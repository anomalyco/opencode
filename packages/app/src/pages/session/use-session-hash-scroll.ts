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
  setSeekingMessage: (value: string | undefined) => void
  setActiveMessage: (message: UserMessage | undefined) => void
  enterLive: () => void
  enterAnchored: (id?: string) => void
  autoScroll: { pause: () => void; forceScrollToBottom: () => void }
  scroller: () => HTMLDivElement | undefined
  anchor: (id: string) => string
  revealMessage?: (id: string) => void
  scheduleScrollState: (el: HTMLDivElement) => void
  consumePendingMessage: (key: string) => string | undefined
}) => {
  const visibleUserMessages = createMemo(() => input.visibleUserMessages())
  const messageById = createMemo(() => new Map(visibleUserMessages().map((m) => [m.id, m])))
  let pendingKey = ""
  let freshKey = ""
  let fresh = true
  let clearing = false
  let seekTimer: ReturnType<typeof setTimeout> | undefined

  const location = useLocation()
  const navigate = useNavigate()

  const snap = (root: HTMLDivElement | undefined) => {
    if (!root) return
    const max = Math.max(0, root.scrollHeight - root.clientHeight)
    return {
      top: Math.round(root.scrollTop),
      height: Math.round(root.scrollHeight),
      client: Math.round(root.clientHeight),
      max: Math.round(max),
      gap: Math.round(max - root.scrollTop),
    }
  }

  const trace = (stage: string, id?: string, extra = "") => {
    const root = input.scroller()
    const data = snap(root)
    console.debug(
      `[jump] stage=${stage} id=${id || "none"} current=${input.currentMessageId() || "none"} scrollTop=${data?.top ?? "none"} scrollHeight=${data?.height ?? "none"} clientHeight=${data?.client ?? "none"} max=${data?.max ?? "none"} gap=${data?.gap ?? "none"} visible=${visibleUserMessages().length}${extra ? ` ${extra}` : ""}`,
    )
  }

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

  const clearSeeking = (id: string) => {
    if (seekTimer) clearTimeout(seekTimer)
    seekTimer = setTimeout(() => {
      seekTimer = undefined
      if (input.currentMessageId() !== id) return
      trace("seek-clear", id)
      input.setSeekingMessage(undefined)
    }, 160)
  }

  const clearMessageHash = () => {
    cancel()
    input.setSeekingMessage(undefined)
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

  const scrollToElement = (el: HTMLElement, behavior: ScrollBehavior, id?: string) => {
    const root = input.scroller()
    if (!root) return false

    const before = snap(root)
    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    const raw = getComputedStyle(root).getPropertyValue("--session-title-inset").trim()
    const inset = Number.parseFloat(raw) || 0

    const top = targetTop({
      itemTop: a.top,
      rootTop: b.top,
      scrollTop: root.scrollTop,
      inset,
    })

    trace(
      "scroll-before",
      id,
      `behavior=${behavior} targetTop=${Math.round(top)} itemTop=${Math.round(a.top - b.top)} itemBottom=${Math.round(a.bottom - b.top)} itemHeight=${Math.round(a.height)} inset=${Math.round(inset)} beforeTop=${before?.top ?? "none"} beforeHeight=${before?.height ?? "none"}`,
    )
    root.scrollTo({ top, behavior })
    const after = snap(root)
    trace("scroll-after", id, `behavior=${behavior} afterTop=${after?.top ?? "none"} afterHeight=${after?.height ?? "none"}`)
    return true
  }

  const settle = (id: string, left = 4) => {
    const el = document.getElementById(input.anchor(id))
    if (el instanceof HTMLElement) scrollToElement(el, "auto", id)
    if (left <= 0) return
    queue(() => {
      settle(id, left - 1)
    })
  }

  const seek = (id: string, behavior: ScrollBehavior, left = 4): boolean => {
    const anchorId = input.anchor(id)
    const el = document.getElementById(anchorId)
    const elByQuery = document.querySelector(`[id="${anchorId}"]`)
    const elByDataAttr = document.querySelector(`[data-message-id="${id}"]`)

    trace("seek-attempt", id, `anchor=${anchorId} retries=${left} foundById=${!!el} foundByQuery=${!!elByQuery} foundByData=${!!elByDataAttr}`)

    if (el) {
      const result = scrollToElement(el, behavior, id)
      trace("seek-found", id, `anchor=${anchorId} behavior=${behavior} result=${result}`)
      return result
    }
    if (left <= 0) {
      trace("seek-miss", id, `anchor=${anchorId}`)
      clearSeeking(id)
      return false
    }
    queue(() => {
      if (!seek(id, behavior, left - 1)) return
      updateHash(id)
      settle(id)
      clearSeeking(id)
    })
    return false
  }

  const scrollToMessage = (message: UserMessage, behavior: ScrollBehavior = "smooth") => {
    trace("message-start", message.id, `behavior=${behavior}`)
    cancel()
    input.setSeekingMessage(message.id)
    input.enterAnchored(message.id)
    if (input.currentMessageId() !== message.id) {
      input.setActiveMessage(message)
    }

    if (seek(message.id, behavior)) {
      updateHash(message.id)
      settle(message.id)
      clearSeeking(message.id)
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
      if (input.currentMessageId() === messageId) return
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

    // Don't cancel if hash matches currentMessageId - let seek() retries continue
    const messageId = messageIdFromHash(hash.slice(1))
    const skipCancel = messageId && messageId === input.currentMessageId()

    if (!skipCancel) {
      cancel()
    } else {
      trace("hash-skip-cancel", messageId)
    }

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

    console.debug(
      `[autoLoadMore] loading more messages: targetId=${targetId} visibleCount=${visibleUserMessages().length} historyMore=${input.historyMore()} historyLoading=${input.historyLoading()}`,
    )
    void input.loadMore(sessionID)
  })

  onMount(() => {
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual"
    }
  })

  onCleanup(() => {
    if (seekTimer) clearTimeout(seekTimer)
    cancel()
  })

  return {
    clearMessageHash,
    scrollToMessage,
    applyHash,
  }
}
