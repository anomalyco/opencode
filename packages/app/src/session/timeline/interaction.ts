import type { SessionMessageUser } from "@opencode/client/promise"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLocation } from "@solidjs/router"
import { createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { frameLoop } from "@opencode/ui/motion"
import { useLayout } from "@/shell/state/layout"
import type { SessionModel } from "../model"
import { useSessionHashScroll } from "../use-session-hash-scroll"
import { createTimelineModel } from "./model"

export function createSessionTimelineInteraction(session: SessionModel) {
  const layout = useLayout()
  const location = useLocation<{ reveal?: string }>()
  const timeline = createTimelineModel({ session })

  const [state, setState] = createStore<{
    messageID: string | undefined
    pendingMessage: string | undefined
    scroll: { overflow: boolean; jump: boolean }
    follow: { sessionKey: string; pinned: boolean }
    /** The composer region's height; the timeline scrolls on underneath it and fades out at its top. */
    inset: number
    refs: {
      scroller: HTMLDivElement | undefined
      content: HTMLDivElement | undefined
      dock: HTMLDivElement | undefined
      visible: HTMLDivElement | undefined
    }
  }>({
    messageID: undefined,
    pendingMessage: undefined,
    scroll: {
      overflow: false,
      jump: false,
    },
    follow: {
      sessionKey: session.identity.sessionKey(),
      pinned: true,
    },
    inset: 0,
    refs: {
      scroller: undefined,
      content: undefined,
      dock: undefined,
      visible: undefined,
    },
  })

  // The single source of truth for "follow the newest content". The virtualizer pins and unpins
  // it from scroll geometry; everything else only expresses explicit intent.
  const pinned = () => state.follow.sessionKey !== session.identity.sessionKey() || state.follow.pinned
  const pin = () => setState("follow", { sessionKey: session.identity.sessionKey(), pinned: true })

  const unpin = () => {
    if (!scroller || scroller.scrollHeight - scroller.clientHeight <= 1) return
    setState("follow", { sessionKey: session.identity.sessionKey(), pinned: false })
  }

  let scroller: HTMLDivElement | undefined
  // The history entry whose tool call was already revealed.
  let revealed: string | undefined

  // The active timeline's navigation, registered by its virtualizer.
  let revealMessage = (_id: string, _partID?: string) => {}

  let revealPart = (_target: string) => false

  let scrollToEnd = (_behavior?: ScrollBehavior) => {}

  let scrollMark = 0
  let messageMark = 0
  let scrollStateFrame: (() => void) | undefined
  let scrollStateTarget: HTMLDivElement | undefined
  let fillFrame: (() => void) | undefined
  let historyContinuationFrame: number | undefined
  const historyRequests = new Set<string>()
  const visibleUserMessages = timeline.visibleUserMessages
  const anchor = (id: string) => `message-${id}`

  const cursor = () => {
    if (!scroller) return state.messageID
    const box = scroller.getBoundingClientRect()
    const line = box.top + 100

    const list = [...scroller.querySelectorAll<HTMLElement>("[data-message-id]")].flatMap((element) => {
      const id = element.dataset.messageId

      if (!id) return []
      const rect = element.getBoundingClientRect()

      return [{ id, top: rect.top, bottom: rect.bottom }]
    })

    const shown = list.filter((item) => item.bottom > box.top && item.top < box.bottom)
    const hit = shown.find((item) => item.top <= line && item.bottom >= line)

    if (hit) return hit.id

    const near = [...shown].sort((a, b) => {
      const aDistance = Math.abs(a.top - line)
      const bDistance = Math.abs(b.top - line)

      if (aDistance !== bDistance) return aDistance - bDistance

      return a.top - b.top
    })[0]

    if (near) return near.id

    return list.filter((item) => item.top <= line).at(-1)?.id ?? list[0]?.id ?? state.messageID
  }

  const setActiveMessage = (message: SessionMessageUser | undefined) => {
    messageMark = scrollMark
    setState("messageID", message?.id)
  }

  const jumpThreshold = (element: HTMLDivElement) => Math.max(400, element.clientHeight)

  const measureScrollState = (element: HTMLDivElement) => {
    const max = element.scrollHeight - element.clientHeight
    const distance = max - element.scrollTop
    const overflow = max > 1

    return { overflow, jump: overflow && distance > jumpThreshold(element) }
  }

  // Reads in the shared frame loop's read phase, before any frame's writes, so a panel resizing the timeline on
  // every frame does not force an extra layout here.
  const scheduleScrollState = (element: HTMLDivElement) => {
    scrollStateTarget = element

    if (scrollStateFrame !== undefined) return
    let next: { overflow: boolean; jump: boolean } | undefined
    scrollStateFrame = frameLoop.addMeasured(
      () => {
        const target = scrollStateTarget
        scrollStateTarget = undefined
        next = target && measureScrollState(target)
      },
      () => {
        scrollStateFrame = undefined

        if (!next || (state.scroll.overflow === next.overflow && state.scroll.jump === next.jump)) return false
        setState("scroll", next)

        return false
      },
    )
  }

  const { clearMessageHash, scrollToMessage } = useSessionHashScroll({
    sessionKey: session.identity.sessionKey,
    sessionID: () => session.identity.params.id,
    messagesReady: timeline.ready,
    visibleUserMessages,
    historyMore: timeline.history.more,
    historyLoading: timeline.history.loading,
    loadMore: loadOlder,
    currentMessageId: () => state.messageID,
    pendingMessage: () => state.pendingMessage,
    setPendingMessage: (value) => setState("pendingMessage", value),
    setActiveMessage,
    follow: {
      unpin,
      toBottom: () => {
        pin()
        scrollToEnd()
      },
    },
    scroller: () => scroller,
    anchor,
    revealMessage: (id) => revealMessage(id),
    scheduleScrollState,
    consumePendingMessage: (key) => layout.pendingMessage.consume(key),
  })

  const resume = (behavior?: ScrollBehavior) => {
    setState("messageID", undefined)
    pin()
    scrollToEnd(behavior)
    clearMessageHash()

    if (scroller) scheduleScrollState(scroller)
  }

  const navigateMessage = (offset: number) => {
    const messages = visibleUserMessages()

    if (messages.length === 0) return
    const current = state.messageID && messageMark === scrollMark ? state.messageID : cursor()
    const base = current ? messages.findIndex((message) => message.id === current) : messages.length
    const target = (base === -1 ? messages.length : base) + offset

    if (target < 0 || target > messages.length) return

    if (target === messages.length) {
      resume()

      return
    }

    unpin()
    scrollToMessage(messages[target], "auto")
  }

  // A gesture inside a nested scrollable region scrolls that region, not the timeline.
  const markUserScroll = (target?: EventTarget | null) => {
    if (!scroller) return
    const element = target instanceof Element ? target : undefined
    const nested = element?.closest("[data-scrollable]")

    if (nested && nested !== scroller) return
    scrollMark += 1
  }

  const selectionInteraction = () => {
    const selection = window.getSelection()

    if (selection && selection.toString().length > 0) unpin()
  }

  const setScrollRef = (element: HTMLDivElement | undefined) => {
    scroller = element
    setState("refs", "scroller", element)

    if (!element) return
    scheduleScrollState(element)
    fill()
  }

  async function loadOlder() {
    const owner = session.ownership.capture()

    if (timeline.history.loading() || historyRequests.has(owner.key)) return
    historyRequests.add(owner.key)
    const before = timeline.messages().length

    try {
      await timeline.history.loadOlder()
    } finally {
      historyRequests.delete(owner.key)
    }

    if (!owner.current() || timeline.messages().length <= before) return

    if (pinned() || !scroller || scroller.scrollTop >= 200 || !timeline.history.more()) return

    if (historyContinuationFrame !== undefined) cancelAnimationFrame(historyContinuationFrame)
    historyContinuationFrame = requestAnimationFrame(() => {
      historyContinuationFrame = undefined
      owner.run(onHistoryScroll)
    })
  }

  const onHistoryScroll = () => {
    if (
      historyRequests.has(session.ownership.key()) ||
      timeline.history.loading() ||
      pinned() ||
      !scroller ||
      scroller.scrollTop >= 200
    )
      return
    void loadOlder()
  }

  // Like the scroll state, measures in the shared frame loop's read phase.
  const fill = () => {
    if (fillFrame !== undefined) return
    let short = false
    fillFrame = frameLoop.addMeasured(
      () => {
        short =
          !!session.identity.params.id &&
          timeline.ready() &&
          pinned() &&
          !timeline.history.loading() &&
          !!scroller &&
          scroller.scrollHeight <= scroller.clientHeight + 1
      },
      () => {
        fillFrame = undefined

        if (short && timeline.history.more()) void loadOlder()

        return false
      },
    )
  }

  createEffect(
    on(
      () => visibleUserMessages().at(-1)?.id,
      (lastID, previousID) => {
        if (lastID && previousID && lastID > previousID) setState("messageID", undefined)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      session.identity.sessionKey,
      () => {
        pin()
        setState("messageID", undefined)
        setState("pendingMessage", undefined)
        setState("scroll", { overflow: false, jump: false })
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => session.identity.params.id,
      (id, previous) => {
        if (!id || !previous || id === previous || state.messageID || state.pendingMessage || location.hash) return
        pin()
        scrollToEnd()
      },
    ),
  )
  createEffect(
    on(
      pinned,
      (value) => {
        if (!value) return
        setState("messageID", undefined)
        clearMessageHash()
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () =>
        [
          session.identity.params.id,
          timeline.ready(),
          timeline.history.more(),
          timeline.history.loading(),
          pinned(),
          visibleUserMessages().length,
        ] as const,
      ([id, ready, more, loading, following]) => {
        if (id && ready && more && !loading && following) fill()
      },
      { defer: true },
    ),
  )
  createResizeObserver(
    () => state.refs.content,
    () => {
      if (scroller) scheduleScrollState(scroller)
      fill()
    },
  )
  createResizeObserver(
    () => state.refs.dock,
    (_rect, _element, entry) => {
      // The activity pill floats above the region out of flow, so only the docks, queue and composer count here.
      const dpr = window.devicePixelRatio || 1
      const next = Math.round((entry.borderBoxSize[0]?.blockSize ?? 0) * dpr) / dpr

      if (next === state.inset) return
      const delta = next - state.inset

      // Measured before the new inset applies: a shrinking region also keeps a reader whose end it uncovers.
      const stick = scroller
        ? pinned() || scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 10 + Math.max(0, -delta)
        : false

      setState("inset", next)

      if (stick) scrollToEnd()

      if (scroller) scheduleScrollState(scroller)
      fill()
    },
  )
  onCleanup(() => {
    if (historyContinuationFrame !== undefined) cancelAnimationFrame(historyContinuationFrame)

    scrollStateFrame?.()

    fillFrame?.()
  })

  return {
    actions: {
      navigateMessage,
      revealMessage: (id: string, partID?: string) => revealMessage(id, partID),
      revealPart: (target: string) => revealPart(target),
      resume,
      setActiveMessage,
    },
    inset: () => state.inset,
    lastUserMessage: timeline.lastUserMessage,
    resource: timeline.resource,
    ready: timeline.ready,
    scroll: state.scroll,
    scroller: () => state.refs.scroller,
    /** The part of the timeline not covered by the composer region. */
    visible: () => state.refs.visible,
    view: {
      anchor,
      markUserScroll,
      onHistoryScroll,
      pin,
      pinned,
      selectionInteraction,
      scheduleScrollState,
      setContentRef: (element: HTMLDivElement | undefined) => {
        setState("refs", "content", element)

        if (scroller) scheduleScrollState(scroller)
      },
      setDockRef: (element: HTMLDivElement | undefined) => {
        setState("refs", "dock", element)
      },
      setVisibleRef: (element: HTMLDivElement | undefined) => {
        setState("refs", "visible", element)
      },
      setRevealMessage: (reveal: (id: string, partID?: string) => void) => {
        revealMessage = reveal
      },
      setRevealPart: (reveal: (target: string) => boolean) => {
        revealPart = reveal
      },
      // The tool call the route opened the session on, revealed once per history entry.
      reveal: {
        target: () => (revealed === location.key ? undefined : location.state?.reveal),
        done: () => {
          revealed = location.key
        },
      },
      setScrollRef,
      setScrollToEnd: (scroll: (behavior?: ScrollBehavior) => void) => {
        scrollToEnd = scroll
      },
      unpin,
    },
  }
}

export type SessionTimelineInteraction = ReturnType<typeof createSessionTimelineInteraction>
