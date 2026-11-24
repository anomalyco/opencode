import type { SessionMessageUser } from "@opencode/client/promise"
import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, createSignal, on, onCleanup, onMount, untrack, type Accessor } from "solid-js"
import {
  CLEAR_WITHOUT_HASH_EVENT,
  createTimelineCursorState,
  DISPOSED_CURSOR_EVENT,
  LATEST_ADVANCED_EVENT,
  pendingCursorMessageID,
  SESSION_CHANGED_EVENT,
  transitionTimelineCursor,
  VIEW_READY_EVENT,
  VIEW_UNREADY_EVENT,
  type TimelineCursorEffect,
  type TimelineCursorEvent,
} from "./cursor-machine"
import type { HistorySeekStatus } from "./history-machine"

/** The active prompt, the route's `#message-<id>` target, and the scroll that brings either into view. */
export function createTimelineCursor(input: {
  sessionKey: Accessor<string>
  /** The session's messages are ready and its timeline is mounted and on screen. */
  viewReady: Accessor<boolean>
  following: Accessor<boolean>
  visibleUserMessages: Accessor<SessionMessageUser[]>
  /** The transcript's first sync is still under way. */
  syncing: Accessor<boolean>
  revertMessageID: Accessor<string | undefined>
  oldestMessageID: Accessor<string | undefined>
  historyStatus: Accessor<HistorySeekStatus>
  scroller: () => HTMLDivElement | undefined
  anchor: (id: string) => string
  revealMessage: (id: string) => void
  detach: () => void
  toEnd: () => void
  seekHistory: () => void
  /** The route opens the session on a tool call instead of its end. */
  revealing: () => boolean
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const [cursorState, setCursorState] = createSignal(createTimelineCursorState())
  let seekFrame: number | undefined
  let applyFrame: number | undefined

  function dispatch(event: TimelineCursorEvent) {
    untrack(() => {
      const current = cursorState()
      const next = transitionTimelineCursor(current, event)

      if (next.state !== current) setCursorState(next.state)
      next.effects.forEach(run)
    })
  }

  function run(effect: TimelineCursorEffect) {
    if (effect.type === "follow.detach") return input.detach()

    if (effect.type === "follow.end") return input.toEnd()

    if (effect.type === "history.seek") return input.seekHistory()

    if (effect.type === "hash.set")
      return navigate(location.pathname + location.search + `#${input.anchor(effect.messageID)}`, { replace: true })

    if (effect.type === "hash.clear") return navigate(location.pathname + location.search, { replace: true })

    if (effect.type === "anchor.scroll") {
      const target = document.getElementById(effect.id)

      if (!target) return input.toEnd()
      input.detach()
      scrollToElement(target, "auto")

      return
    }

    if (effect.type === "apply.schedule" || effect.type === "apply.cancel") {
      if (applyFrame !== undefined) cancelAnimationFrame(applyFrame)
      applyFrame = undefined

      if (effect.type === "apply.cancel") return
      // A frame later, once the virtualizer has registered its navigation.
      applyFrame = requestAnimationFrame(() => {
        applyFrame = undefined
        dispatch({
          type: "hash.applied",
          attempt: effect.attempt,
          hash: location.hash.slice(1),
          reveal: input.revealing(),
        })
      })

      return
    }

    if (seekFrame !== undefined) cancelAnimationFrame(seekFrame)
    seekFrame = undefined

    if (effect.type === "seek.cancel") return

    if (effect.type === "seek.start") return dispatch(probe(effect, effect.behavior === "smooth"))
    seekFrame = requestAnimationFrame(() => {
      seekFrame = undefined
      dispatch(probe(effect, false))
    })
  }

  // A mounted prompt is close enough to glide to; any other is first brought in by the virtualizer.
  function probe(
    effect: { attempt: number; messageID: string; behavior: ScrollBehavior },
    glide: boolean,
  ): TimelineCursorEvent {
    const mounted = glide ? document.getElementById(input.anchor(effect.messageID)) : null

    if (!mounted) input.revealMessage(effect.messageID)
    const element = mounted ?? document.getElementById(input.anchor(effect.messageID))

    if (!element || !scrollToElement(element, effect.behavior)) return { type: "seek.missing", attempt: effect.attempt }

    return { type: "seek.landed", attempt: effect.attempt }
  }

  function scrollToElement(element: HTMLElement, behavior: ScrollBehavior) {
    const root = input.scroller()

    if (!root) return false
    const sticky = root.querySelector("[data-session-title]")
    const inset = sticky instanceof HTMLElement ? sticky.offsetHeight : 0
    const top = element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - inset
    root.scrollTo({ top: Math.max(0, top), behavior })

    return true
  }

  function clear() {
    const hash = location.hash.slice(1)

    dispatch(hash ? { type: "clear", hash } : CLEAR_WITHOUT_HASH_EVENT)
  }

  // Runs first on a session switch, so nothing below sees the previous session's cursor.
  createEffect(on(input.sessionKey, () => dispatch(SESSION_CHANGED_EVENT), { defer: true }))
  createEffect(() => {
    input.sessionKey()
    dispatch(input.viewReady() ? VIEW_READY_EVENT : VIEW_UNREADY_EVENT)
  })
  createEffect(
    on(
      () => location.hash,
      (hash) => dispatch({ type: "hash.changed", hash: hash.slice(1), viewReady: untrack(input.viewReady) }),
      { defer: true },
    ),
  )
  // Subscribes to the transcript and history only while a target is pending.
  createEffect(() => {
    const id = pendingCursorMessageID(cursorState())

    if (!id) return
    dispatch({
      type: "target.synced",
      messageID: id,
      loaded: input.visibleUserMessages().some((message) => message.id === id),
      viewReady: input.viewReady(),
      syncing: input.syncing(),
      revertMessageID: input.revertMessageID(),
      oldestMessageID: input.oldestMessageID(),
      history: input.historyStatus(),
      hash: untrack(() => location.hash.slice(1)),
    })
  })
  // Not deferred: a deferred `on` passes no previous input to its first change.
  createEffect(
    on(
      () => input.visibleUserMessages().at(-1)?.id,
      (lastID, previousID) => {
        if (lastID && previousID && lastID > previousID) dispatch(LATEST_ADVANCED_EVENT)
      },
    ),
  )
  // A new session starts out following; only the reader's own return to the end clears the route's hash.
  createEffect(
    on([input.sessionKey, input.following], ([key, following], previous) => {
      if (following && previous?.[0] === key) clear()
    }),
  )

  onMount(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual"
  })

  onCleanup(() => dispatch(DISPOSED_CURSOR_EVENT))

  return {
    state: cursorState,
    dispatch,
    clear,
    jump: (messageID: string, behavior: ScrollBehavior) =>
      dispatch({
        type: "message.jump",
        messageID,
        behavior,
        hash: location.hash.slice(1),
        viewReady: untrack(input.viewReady),
      }),
  }
}
