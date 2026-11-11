import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLocation } from "@solidjs/router"
import { createEffect, createMemo, createSignal, on, onCleanup, untrack, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { frameLoop } from "@opencode/ui/motion"
import type { SessionModel } from "../model"
import { createTimelineCursor } from "./cursor"
import { cursorMessageID, freshCursorMessageID, hasFreshCursorOrSeek, SCROLL_MOVED_EVENT } from "./cursor-machine"
import { createTimelineFollow } from "./follow"
import {
  canRequestFillProbe,
  canRequestScrollPage,
  createTimelineHistoryState,
  DISPOSED_HISTORY_EVENT,
  FILL_REQUESTED_EVENT,
  HISTORY_LOAD_TIMEOUT_MS,
  HISTORY_RETRY_COOLDOWN_MS,
  HISTORY_SCROLL_THRESHOLD,
  historySeekStatus,
  SCROLL_TOP_EVENT,
  SEEK_REQUESTED_EVENT,
  transitionTimelineHistory,
  type TimelineHistoryEffect,
  type TimelineHistoryEvent,
} from "./history-machine"
import { createRouteRevealState, routeRevealTarget, transitionRouteReveal } from "./machine"
import { createTimelineModel } from "./model"

/** `visible`: the conversation is on screen, not behind another narrow-screen view. */
export function createSessionTimelineInteraction(session: SessionModel, visible: Accessor<boolean>) {
  const location = useLocation<{ reveal?: string }>()
  const timeline = createTimelineModel({ session })

  const [state, setState] = createStore<{
    scroll: { overflow: boolean; jump: boolean }
    /** The composer region's height; the timeline scrolls on underneath it and fades out at its top. */
    inset: number
    refs: {
      scroller: HTMLDivElement | undefined
      dock: HTMLDivElement | undefined
      visible: HTMLDivElement | undefined
    }
  }>({
    scroll: {
      overflow: false,
      jump: false,
    },
    inset: 0,
    refs: {
      scroller: undefined,
      dock: undefined,
      visible: undefined,
    },
  })

  // The single source of truth for "follow the newest content". The virtualizer feeds it scroll geometry and the
  // reader's input; everything else only expresses explicit intent.
  const follow = createTimelineFollow(session.identity.sessionKey)
  const detach = () => follow.dispatch({ type: "detach" })

  let scroller: HTMLDivElement | undefined
  const [revealState, setRevealState] = createSignal(createRouteRevealState())
  createEffect(() => {
    const event = { type: "route.synced", entryKey: location.key, target: location.state?.reveal } as const
    setRevealState((current) => transitionRouteReveal(current, event))
  })

  // The active timeline's navigation, registered by its virtualizer.
  let revealMessage = (_id: string, _partID?: string) => {}

  let revealPart = (_target: string) => false

  let scrollToEnd = (_behavior?: ScrollBehavior) => {}

  let page = (_direction: 1 | -1) => {}

  let scrollStateFrame: (() => void) | undefined
  let scrollStateTarget: HTMLDivElement | undefined
  const [historyState, setHistoryState] = createSignal(createTimelineHistoryState())
  let historyProbe: (() => void) | undefined
  let historyLoad: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | undefined
  let historyCooldown: ReturnType<typeof setTimeout> | undefined
  // Changes only when an older page lands or the transcript is replaced, not while a reply streams.
  const oldestMessage = createMemo(() => timeline.messages()[0]?.id)
  const visibleUserMessages = timeline.visibleUserMessages
  const anchor = (id: string) => `message-${id}`

  // The prompt at the top of the view, or the last chosen one when no prompt header is mounted there.
  const promptInView = () => {
    if (!scroller) return cursorMessageID(untrack(cursor.state))
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

    return list.filter((item) => item.top <= line).at(-1)?.id ?? list[0]?.id ?? cursorMessageID(untrack(cursor.state))
  }

  const setActiveMessage = (messageID: string | undefined) =>
    cursor.dispatch({ type: "message.select", messageID, following: untrack(follow.following) })

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

  const cursor = createTimelineCursor({
    sessionKey: session.identity.sessionKey,
    viewReady: createMemo(() => !!session.identity.params.id && timeline.ready() && !!state.refs.scroller && visible()),
    following: follow.following,
    visibleUserMessages,
    syncing: () => timeline.resource.loading,
    revertMessageID: session.data.revertMessageID,
    oldestMessageID: oldestMessage,
    historyStatus: createMemo(() => historySeekStatus(historyState())),
    scroller: () => scroller,
    anchor,
    revealMessage: (id) => revealMessage(id),
    detach,
    toEnd: () => {
      follow.dispatch({ type: "follow" })
      scrollToEnd()

      if (scroller) scheduleScrollState(scroller)
    },
    seekHistory: () => dispatchHistory(SEEK_REQUESTED_EVENT),
    // A route reveal, still waiting or holding its tool call in place, keeps the session off its end.
    revealing: () => !!follow.anchor() || !!routeRevealTarget(revealState()),
  })

  let resumeFrame: (() => void) | undefined

  const resume = (behavior?: ScrollBehavior) => {
    cursor.clear()
    const attempt = follow.beginReturn()
    // Scrolls on the next frame, before it paints. A submit resumes from its key handler right after changing the
    // DOM, where reading the scroll range would force a layout that the frame then repeats. Input that stops
    // following before then makes the attempt stale, and the machine drops it.
    resumeFrame?.()
    resumeFrame = frameLoop.add(() => {
      resumeFrame = undefined
      const before = follow.peek()
      follow.dispatch({ type: "return.run", attempt })

      if (follow.peek() !== before) scrollToEnd(behavior)

      return false
    })

    if (scroller) scheduleScrollState(scroller)
  }

  const navigateMessage = (offset: number) => {
    const messages = visibleUserMessages()

    if (messages.length === 0) return
    const current = freshCursorMessageID(untrack(cursor.state)) ?? promptInView()
    const base = current ? messages.findIndex((message) => message.id === current) : messages.length
    const target = (base === -1 ? messages.length : base) + offset

    if (target < 0 || target > messages.length) return

    if (target === messages.length) {
      resume()

      return
    }

    cursor.jump(messages[target].id, "auto")
  }

  // A gesture inside a nested scrollable region scrolls that region, not the timeline.
  const markUserScroll = (target?: EventTarget | null) => {
    if (!scroller || !hasFreshCursorOrSeek(untrack(cursor.state))) return
    const element = target instanceof Element ? target : undefined
    const nested = element?.closest("[data-scrollable]")

    if (nested && nested !== scroller) return
    cursor.dispatch(SCROLL_MOVED_EVENT)
  }

  const setScrollRef = (element: HTMLDivElement | undefined) => {
    scroller = element
    setState("refs", "scroller", element)

    if (!element) return
    scheduleScrollState(element)
    requestFill()
  }

  const onHistoryScroll = () => {
    if (
      !scroller ||
      scroller.scrollTop >= HISTORY_SCROLL_THRESHOLD ||
      !canRequestScrollPage(untrack(historyState)) ||
      untrack(follow.following)
    )
      return
    dispatchHistory(SCROLL_TOP_EVENT)
  }

  // Runs inside the virtualizer's ref and resize effects, so it reads untracked: they must not rerun on each phase.
  const requestFill = () => {
    if (!canRequestFillProbe(untrack(historyState)) || !untrack(follow.following)) return
    dispatchHistory(FILL_REQUESTED_EVENT)
  }

  function dispatchHistory(event: TimelineHistoryEvent) {
    untrack(() => {
      const current = historyState()
      const next = transitionTimelineHistory(current, event)

      if (next.state !== current) setHistoryState(next.state)
      next.effects.forEach(runHistory)
    })
  }

  function runHistory(effect: TimelineHistoryEffect) {
    if (effect.type === "probe.schedule") {
      historyProbe?.()
      let load = false
      // Like the scroll state, measures in the shared frame loop's read phase.
      historyProbe = frameLoop.addMeasured(
        () => {
          load =
            !!scroller &&
            (effect.probe === "fill"
              ? follow.following() && scroller.scrollHeight <= scroller.clientHeight + 1
              : !follow.following() && scroller.scrollTop < HISTORY_SCROLL_THRESHOLD)
        },
        () => {
          historyProbe = undefined
          dispatchHistory({ type: "probe.settled", attempt: effect.attempt, load })

          return false
        },
      )

      return
    }

    if (effect.type === "probe.cancel") {
      historyProbe?.()
      historyProbe = undefined

      return
    }

    if (effect.type === "load.start") {
      abortHistoryLoad()
      const previous = oldestMessage()

      const load = {
        controller: new AbortController(),
        timer: setTimeout(
          () => dispatchHistory({ type: "page.timed-out", attempt: effect.attempt }),
          HISTORY_LOAD_TIMEOUT_MS,
        ),
      }

      // Every outcome settles in the machine, which drops a result whose attempt is no longer current.
      const settle = (event: TimelineHistoryEvent) => {
        clearTimeout(load.timer)

        if (historyLoad === load) historyLoad = undefined
        dispatchHistory(event)
      }

      historyLoad = load
      timeline.history.loadMore(effect.sessionID, load.controller.signal).then(
        () =>
          settle({
            type: "page.loaded",
            attempt: effect.attempt,
            previous,
            oldest: oldestMessage(),
            more: timeline.history.more(),
            following: follow.following(),
          }),
        () => settle({ type: "page.failed", attempt: effect.attempt }),
      )

      return
    }

    if (effect.type === "load.abort") {
      abortHistoryLoad()

      return
    }

    clearTimeout(historyCooldown)
    historyCooldown = undefined

    if (effect.type === "cooldown.cancel") return
    historyCooldown = setTimeout(() => {
      historyCooldown = undefined
      dispatchHistory({ type: "cooldown.settled", attempt: effect.attempt, following: follow.following() })
    }, HISTORY_RETRY_COOLDOWN_MS)
  }

  function abortHistoryLoad() {
    if (!historyLoad) return
    clearTimeout(historyLoad.timer)
    historyLoad.controller.abort()
    historyLoad = undefined
  }

  createEffect(
    on(session.identity.sessionKey, () => setState("scroll", { overflow: false, jump: false }), { defer: true }),
  )
  createEffect(
    on(
      () => session.identity.params.id,
      (id, previous) => {
        // A switch resets the cursor, so only a `#message-<id>` or other hash can hold the new session elsewhere.
        if (!id || !previous || id === previous || location.hash) return
        follow.dispatch({ type: "follow" })
        scrollToEnd()
      },
    ),
  )
  createEffect(() => {
    const id = session.identity.params.id

    dispatchHistory({
      type: "sync",
      target: id ? { sessionKey: session.identity.sessionKey(), sessionID: id } : undefined,
      ready: timeline.ready(),
      more: timeline.history.more(),
      following: follow.following(),
      oldest: oldestMessage(),
    })
  })
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
        ? follow.following() ||
          scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 10 + Math.max(0, -delta)
        : false

      setState("inset", next)

      if (stick) scrollToEnd()

      if (scroller) scheduleScrollState(scroller)
      requestFill()
    },
  )
  onCleanup(() => {
    dispatchHistory(DISPOSED_HISTORY_EVENT)

    resumeFrame?.()

    scrollStateFrame?.()
  })

  return {
    actions: {
      navigateMessage,
      page: (direction: 1 | -1) => page(direction),
      // Find and tool reveals move the view like a scroll, so the chosen prompt is no longer where navigation starts.
      revealMessage: (id: string, partID?: string) => {
        cursor.dispatch(SCROLL_MOVED_EVENT)
        revealMessage(id, partID)
      },
      revealPart: (target: string) => {
        cursor.dispatch(SCROLL_MOVED_EVENT)

        return revealPart(target)
      },
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
    follow,
    view: {
      anchor,
      markUserScroll,
      onHistoryScroll,
      scheduleScrollState,
      contentResized: () => {
        if (scroller) scheduleScrollState(scroller)
        requestFill()
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
      // The tool call the route opened the session on, attempted once per history entry.
      reveal: {
        pending: () => routeRevealTarget(untrack(revealState)),
        consume: (entryKey: string) =>
          setRevealState((current) => transitionRouteReveal(current, { type: "reveal.attempted", entryKey })),
      },
      setScrollRef,
      setScrollToEnd: (scroll: (behavior?: ScrollBehavior) => void) => {
        scrollToEnd = scroll
      },
      setPage: (scroll: (direction: 1 | -1) => void) => {
        page = scroll
      },
    },
  }
}

export type SessionTimelineInteraction = ReturnType<typeof createSessionTimelineInteraction>
