import type { SessionMessageUser } from "@opencode/client/promise"
import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, createSignal, on, onCleanup, onMount, untrack, type Accessor } from "solid-js"
import { messageIdFromHash } from "../message-id-from-hash"
import {
  CLEAR_CURSOR_EVENT,
  createTimelineCursorState,
  DISPOSED_CURSOR_EVENT,
  LATEST_ADVANCED_EVENT,
  pendingCursorMessageID,
  SESSION_CHANGED_EVENT,
  transitionTimelineCursor,
  type TimelineCursorEffect,
  type TimelineCursorEvent,
} from "./cursor-machine"

/** The active prompt, the route's `#message-<id>` target, and the scroll that brings either into view. */
export function createTimelineCursor(input: {
  sessionKey: Accessor<string>
  sessionID: Accessor<string | undefined>
  ready: Accessor<boolean>
  following: Accessor<boolean>
  visibleUserMessages: Accessor<SessionMessageUser[]>
  scroller: () => HTMLDivElement | undefined
  anchor: (id: string) => string
  revealMessage: (id: string) => void
  detach: () => void
  toEnd: () => void
  /** Whether history can page toward a pending target now; read tracked, so paging resumes after each page. */
  historySeekable: Accessor<boolean>
  seekHistory: () => void
}) {
  const location = useLocation<{ reveal?: string }>()
  const navigate = useNavigate()
  const [cursorState, setCursorState] = createSignal(createTimelineCursorState())
  let seekFrame: number | undefined
  let applyFrame: { id: number; initial: boolean } | undefined

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

    if (effect.type === "hash.set") {
      const hash = `#${input.anchor(effect.messageID)}`

      if (location.hash !== hash) navigate(location.pathname + location.search + hash, { replace: true })

      return
    }

    if (effect.type === "hash.clear") {
      if (location.hash) navigate(location.pathname + location.search, { replace: true })

      return
    }

    if (effect.type === "anchor.scroll") {
      const target = document.getElementById(effect.id)

      if (!target) return input.toEnd()
      input.detach()
      scrollToElement(target, "auto")

      return
    }

    cancelSeek()

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

  function cancelSeek() {
    if (seekFrame !== undefined) cancelAnimationFrame(seekFrame)
    seekFrame = undefined
  }

  // Applies the hash a frame later, once the virtualizer has registered its navigation. A session switch that also
  // changes the hash stays an initial apply.
  function scheduleApply(initial: boolean) {
    const merged = initial || (applyFrame?.initial ?? false)

    if (applyFrame) cancelAnimationFrame(applyFrame.id)
    applyFrame = {
      initial: merged,
      id: requestAnimationFrame(() => {
        applyFrame = undefined
        const hash = location.hash.slice(1)

        dispatch({
          type: "hash.applied",
          hash,
          messageID: messageIdFromHash(hash),
          initial: merged,
          reveal: !!location.state?.reveal,
        })
      }),
    }
  }

  // Runs first on a session switch, so nothing below sees the previous session's cursor.
  createEffect(on(input.sessionKey, () => dispatch(SESSION_CHANGED_EVENT), { defer: true }))
  createEffect(
    on(
      () => (input.sessionID() && input.ready() ? input.sessionKey() : undefined),
      (key) => {
        if (key) scheduleApply(true)
      },
    ),
  )
  createEffect(
    on(
      () => location.hash,
      () => {
        if (untrack(input.sessionID) && untrack(input.ready)) scheduleApply(false)
      },
      { defer: true },
    ),
  )
  createEffect(() => {
    const id = pendingCursorMessageID(cursorState())

    if (!id || !input.sessionID() || !input.ready()) return

    if (input.visibleUserMessages().some((message) => message.id === id))
      return dispatch({ type: "target.loaded", messageID: id })

    if (input.historySeekable()) input.seekHistory()
  })
  createEffect(
    on(
      () => input.visibleUserMessages().at(-1)?.id,
      (lastID, previousID) => {
        if (lastID && previousID && lastID > previousID) dispatch(LATEST_ADVANCED_EVENT)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      input.following,
      (following) => {
        if (following) dispatch(CLEAR_CURSOR_EVENT)
      },
      { defer: true },
    ),
  )

  onMount(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual"
  })

  onCleanup(() => {
    if (applyFrame) cancelAnimationFrame(applyFrame.id)
    dispatch(DISPOSED_CURSOR_EVENT)
  })

  return { state: cursorState, dispatch }
}
