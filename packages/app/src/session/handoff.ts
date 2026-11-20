import { createEffect, createSignal, onCleanup, untrack } from "solid-js"
import type { Data } from "@opencode/client/solid"
import type { ServerSDK } from "@/runtime/server/client"
import {
  createSessionHandoffState,
  selectSessionHandoff,
  selectSessionHandoffHeld,
  transitionSessionHandoff,
  type SessionHandoffEffect,
  type SessionHandoffEvent,
  type SessionMessageHandoff,
} from "./handoff-machine"

export type { SessionMessageHandoff } from "./handoff-machine"

// Holds each session's optimistic prompt on one server until the server's admission echo, which follows the echoes of
// the switches it projects. A missed echo ends in a sync instead of a prompt that stays forever.
export function createSessionMessageHandoffs(input: {
  sdk: Pick<ServerSDK, "connection" | "event">
  data: { session: Pick<Data["session"], "invalidate" | "sync" | "pending" | "message"> }
}) {
  const connected = () => input.sdk.connection.status() === "connected"
  const [state, setState] = createSignal(createSessionHandoffState(untrack(connected)))
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const dispatch = (event: SessionHandoffEvent) => {
    const result = transitionSessionHandoff(untrack(state), event)

    if (result.state !== untrack(state)) setState(result.state)
    result.effects.forEach(run)
  }

  const run = (effect: SessionHandoffEffect) => {
    if (effect.type === "timer.cancel-all") {
      timers.forEach(clearTimeout)
      timers.clear()

      return
    }

    if (effect.type === "sync") {
      const session = input.data.session
      const id = effect.sessionID

      // The sync layer answers from cache unless invalidated.
      void Promise.try(() => {
        session.invalidate(id)
        session.pending.invalidate(id)
        session.message.invalidate(id)

        return Promise.all([session.sync(id), session.pending.sync(id), session.message.sync(id)])
      })
        .catch(() => undefined)
        .then(() => dispatch({ type: "sync.settled", sessionID: id, attempt: effect.attempt }))

      return
    }

    clearTimeout(timers.get(effect.sessionID))
    timers.delete(effect.sessionID)

    if (effect.type === "timer.cancel") return
    timers.set(
      effect.sessionID,
      setTimeout(() => {
        timers.delete(effect.sessionID)
        dispatch({ type: `${effect.timer}.timed-out`, sessionID: effect.sessionID, attempt: effect.attempt })
      }, effect.delayMs),
    )
  }

  const cleared = (item: { data: { sessionID: string; inboxID: string } }) =>
    dispatch({ type: "handoff.cleared", sessionID: item.data.sessionID, messageID: item.data.inboxID })

  const unsubscribe = [
    input.sdk.event.on("session.inbox.enqueued", cleared),
    input.sdk.event.on("session.inbox.delivered", cleared),
    input.sdk.event.on("session.inbox.cancelled", cleared),
    input.sdk.event.on("session.inbox.delivery.changed", (item) => {
      if (item.data.delivery === "queue") cleared(item)
    }),
    input.sdk.event.on("session.revert.staged", (item) =>
      dispatch({ type: "session.reverted", sessionID: item.data.sessionID, boundary: item.data.revert.messageID }),
    ),
    input.sdk.event.on("session.deleted", (item) =>
      dispatch({ type: "session.deleted", sessionID: item.data.sessionID }),
    ),
  ]

  createEffect(() => {
    const value = connected()
    untrack(() => dispatch({ type: "connection.changed", connected: value }))
  })

  onCleanup(() => {
    unsubscribe.forEach((stop) => stop())
    dispatch({ type: "disposed" })
  })

  return {
    /** The prompt a session's timeline shows before the server admits it. Reactive. */
    get: (sessionID: string | undefined) => selectSessionHandoff(state(), sessionID),
    /** Whether the prompt is held, unsent, for its Location's agents and models. Reactive. */
    held: (sessionID: string, messageID: string) => selectSessionHandoffHeld(state(), sessionID, messageID),
    forSession: (sessionID: string) => ({
      set: (handoff: SessionMessageHandoff) => dispatch({ type: "handoff.set", sessionID, handoff }),
      hold: (handoff: SessionMessageHandoff) => dispatch({ type: "handoff.held", sessionID, handoff }),
      settle: (messageID: string) => dispatch({ type: "prompt.settled", sessionID, messageID }),
      clear: (messageID: string) => dispatch({ type: "handoff.cleared", sessionID, messageID }),
    }),
  }
}
