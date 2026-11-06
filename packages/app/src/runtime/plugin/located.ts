import { batch, createEffect, createMemo, createSignal, getOwner, onCleanup, untrack } from "solid-js"
import type { SessionRef } from "@opencode/plugin/gui"
import { same } from "@/runtime/persistence/equality"
import {
  createLocatedWritesState,
  selectLocatedDraining,
  selectLocatedSessionBusy,
  selectLocatedWaitingKeys,
  transitionLocatedWrites,
  type LocatedWritesEvent,
} from "./located-machine"

/**
 * Layout writes find a session's stored layout through its location, which is unknown until the server reports it
 * (for example after a server re-authenticates). `hold` keeps such a write and runs it once the location is known; a
 * session's writes always run in call order. A write whose session stays unlocated for `LOCATED_WRITE_TTL_MS` is
 * dropped.
 */
export function createLocatedWrites() {
  const [writesState, setWritesState] = createSignal(createLocatedWritesState())
  // The latest ref per session with held writes, whose location the watcher below reads.
  const refs = new Map<string, SessionRef>()
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  const waiting = createMemo(() => selectLocatedWaitingKeys(writesState()), [], { equals: same })

  const dispatch = (event: LocatedWritesEvent) => {
    const next = transitionLocatedWrites(untrack(writesState), event)

    setWritesState(next.state)
    next.effects.forEach((effect) => {
      // Promise.try runs each write synchronously and isolates a throw from the writes behind it.
      if (effect.type === "run")
        return void Promise.try(effect.run).catch((cause: unknown) => console.error("[plugin]", cause))

      // Each step takes the next write off the queue before running it, and a write it makes joins the end.
      if (effect.type === "drain")
        return batch(() => {
          while (selectLocatedDraining(untrack(writesState), effect.key))
            dispatch({ type: "drain.next", key: effect.key })
        })

      if (effect.type === "schedule.expire")
        return void timers.set(
          effect.id,
          setTimeout(() => {
            timers.delete(effect.id)
            dispatch({ type: "expire", id: effect.id })
          }, effect.timeoutMs),
        )

      effect.ids.forEach((id) => {
        clearTimeout(timers.get(id))
        timers.delete(id)
      })
    })
  }

  // Drains each session whose location the server has reported.
  createEffect(() => {
    const keys = waiting()
    Array.from(refs.keys()).forEach((key) => {
      if (!untrack(() => selectLocatedSessionBusy(writesState(), key))) refs.delete(key)
    })
    const ready = keys.filter((key) => refs.get(key)?.location)

    if (ready.length === 0) return
    untrack(() => batch(() => ready.forEach((key) => dispatch({ type: "drain.start", key }))))
  })

  if (getOwner()) onCleanup(() => dispatch({ type: "disposed" }))

  return {
    hold(session: SessionRef, run: () => void) {
      const located = Boolean(untrack(() => session.location))

      if (!located || selectLocatedSessionBusy(untrack(writesState), session.key)) refs.set(session.key, session)
      dispatch({ type: "write", key: session.key, located, run })
    },
    /** Whether a write for the session would wait behind earlier ones. */
    pending: (key: string) => selectLocatedSessionBusy(untrack(writesState), key),
  }
}
