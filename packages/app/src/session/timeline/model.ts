import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { useServer } from "@/runtime/server/current"
import type { SessionModel } from "../model"
import {
  createTimelineSyncState,
  DISPOSED_TIMELINE_SYNC_EVENT,
  isTimelineReady,
  isTimelineSyncing,
  LEADING_TURN_LOAD_TIMEOUT_MS,
  LEADING_TURN_PAGE_DELAY_MS,
  leadingTurnNeedsParent,
  resolveLeadingAssistant,
  sameTarget,
  TIMELINE_SYNC_TIMEOUT_MS,
  timelineSyncError,
  transitionTimelineSync,
  type TimelineSyncEffect,
  type TimelineSyncEvent,
  type TimelineSyncTarget,
} from "./sync-machine"

// The leading turn first seen in each transcript, kept across route remounts.
const leadingAssistants = new WeakMap<SessionMessageInfo[], string>()

export function createTimelineModel(input: { session: Pick<SessionModel, "identity" | "history"> }) {
  const server = useServer()
  const data = server.ctx.data
  const [syncState, setSyncState] = createSignal(createTimelineSyncState())
  let syncTimer: ReturnType<typeof setTimeout> | undefined
  let pauseTimer: ReturnType<typeof setTimeout> | undefined
  let pageLoad: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | undefined

  const target = createMemo(
    (): TimelineSyncTarget | undefined => {
      const sessionID = input.session.identity.sessionID()

      return sessionID ? { sessionKey: input.session.identity.sessionKey(), sessionID } : undefined
    },
    undefined,
    { equals: sameTarget },
  )

  const dispatch = (event: TimelineSyncEvent) =>
    untrack(() => {
      const current = syncState()
      const next = transitionTimelineSync(current, event)

      if (next.state !== current) setSyncState(next.state)
      next.effects.forEach(run)
    })

  const run = (effect: TimelineSyncEffect) => {
    if (effect.type === "sync.start") {
      clearTimeout(syncTimer)
      const id = effect.target.sessionID
      const attempt = effect.attempt
      const timer = setTimeout(() => dispatch({ type: "sync.timed-out", attempt }), TIMELINE_SYNC_TIMEOUT_MS)

      const settle = (event: TimelineSyncEvent) => {
        clearTimeout(timer)

        if (syncTimer === timer) syncTimer = undefined
        dispatch(event)
      }

      syncTimer = timer
      Promise.all([data.session.message.sync(id), data.session.pending.sync(id)]).then(
        () => {
          const messages = data.session.message.list(id)
          const assistantID = resolveLeadingAssistant(leadingAssistants, messages)

          settle({
            type: "sync.succeeded",
            attempt,
            assistantID,
            needsParent: !!assistantID && leadingTurnNeedsParent(messages, assistantID),
            more: data.session.message.more(id),
          })
        },
        // The error boundary rethrows it, so a rejection without a value still needs one.
        (error) =>
          settle({ type: "sync.failed", attempt, error: error instanceof Object ? error : new Error(String(error)) }),
      )

      return
    }

    if (effect.type === "sync.cancel") {
      clearTimeout(syncTimer)
      syncTimer = undefined

      return
    }

    if (effect.type === "pause.start") {
      clearTimeout(pauseTimer)
      pauseTimer = setTimeout(() => {
        pauseTimer = undefined
        dispatch({
          type: "enrich.paused",
          attempt: effect.attempt,
          needsParent: leadingTurnNeedsParent(data.session.message.list(effect.sessionID), effect.assistantID),
          more: data.session.message.more(effect.sessionID),
          loading: data.session.message.loading(effect.sessionID),
        })
      }, LEADING_TURN_PAGE_DELAY_MS)

      return
    }

    if (effect.type === "pause.cancel") {
      clearTimeout(pauseTimer)
      pauseTimer = undefined

      return
    }

    abortPage()

    if (effect.type === "page.abort") return

    const load = {
      controller: new AbortController(),
      timer: setTimeout(() => {
        load.controller.abort()
        settle(false)
      }, LEADING_TURN_LOAD_TIMEOUT_MS),
    }

    // Settles once: the timeout aborts the request, whose rejection then finds the load already gone.
    const settle = (succeeded: boolean) => {
      if (pageLoad !== load) return
      clearTimeout(load.timer)
      pageLoad = undefined
      dispatch({
        type: "enrich.page-settled",
        attempt: effect.attempt,
        succeeded,
        needsParent: leadingTurnNeedsParent(data.session.message.list(effect.sessionID), effect.assistantID),
        more: data.session.message.more(effect.sessionID),
      })
    }

    pageLoad = load
    data.session.message.loadMore(effect.sessionID, { signal: load.controller.signal }).then(
      () => settle(true),
      () => settle(false),
    )
  }

  const abortPage = () => {
    if (!pageLoad) return
    clearTimeout(pageLoad.timer)
    pageLoad.controller.abort()
    pageLoad = undefined
  }

  createEffect(() => dispatch({ type: "target.changed", target: target() }))
  onCleanup(() => dispatch(DISPOSED_TIMELINE_SYNC_EVENT))

  // Enrich the partial leading group without withholding the already loaded tail. Undelivered inbox rows
  // load with the inbox, not the transcript, so alone they are no tail; a first prompt shows through its handoff.
  const ready = createMemo(() =>
    isTimelineReady(syncState(), target(), () => {
      const id = target()?.sessionID

      return (
        !!id &&
        (data.session.message.list(id).some((message) => !data.session.input.has(id, message.id)) ||
          !!server.ctx.handoff.get(id))
      )
    }),
  )

  const more = () => {
    const id = input.session.identity.sessionID()

    return id ? data.session.message.more(id) : false
  }

  return {
    history: {
      loadMore: (id: string, signal: AbortSignal) => data.session.message.loadMore(id, { signal }),
      more,
    },
    lastUserMessage: input.session.history.lastUserMessage,
    messages: input.session.history.messages,
    ready,
    // Never suspends or throws: `loading` covers only the newest page, and `error` belongs to the current session.
    resource: {
      get loading() {
        return isTimelineSyncing(syncState(), target())
      },
      get error() {
        return timelineSyncError(syncState(), target())
      },
    },
    visibleUserMessages: input.session.history.visibleUserMessages,
  }
}
