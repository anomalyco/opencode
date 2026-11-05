import { createComputed, getOwner, onCleanup, untrack, type Accessor } from "solid-js"
import {
  createLinkCheckState,
  selectLinkCheckActive,
  selectLinkCheckDisposed,
  transitionLinkCheck,
  type LinkCheckEffect,
  type LinkCheckEvent,
} from "./link-check-machine"

/**
 * Asks whether a link's file exists only while its timeline is selected. Plugins check links for the selected
 * session alone, so a hidden timeline's answer would be a false negative: a check asked while hidden, or one that
 * comes back negative after the timeline was hidden, even briefly, waits and asks again once it is selected. Once the
 * timeline's owner goes away, every check still waiting answers `false`.
 */
export function createLinkCheck(active: Accessor<boolean>, check: (href: string) => boolean | Promise<boolean>) {
  const machine = { state: createLinkCheckState(untrack(active)) }
  const waiters = new Map<number, PromiseWithResolvers<boolean>>()

  const dispatch = (event: LinkCheckEvent) => {
    const next = transitionLinkCheck(machine.state, event)

    machine.state = next.state
    next.effects.forEach(run)

    return next.id
  }

  const run = (effect: LinkCheckEffect) => {
    // A microtask after the timeline is selected, so the routed session has settled before the check runs.
    if (effect.type === "schedule.wake") return queueMicrotask(() => dispatch({ type: "wake", epoch: effect.epoch }))

    if (effect.type === "check") return answer(effect.id, Promise.try(() => untrack(() => check(effect.href))))
    const waiter = waiters.get(effect.id)
    waiters.delete(effect.id)

    if (effect.type === "resolve") return waiter?.resolve(effect.value)
    waiter?.reject(effect.cause)
  }

  const answer = (id: number, result: Promise<boolean>) =>
    void result.then(
      (found) => dispatch({ type: "settled", id, found }),
      (cause: unknown) => dispatch({ type: "failed", id, cause }),
    )

  const wait = (id: number | undefined) => {
    if (id === undefined) return false
    const waiter = Promise.withResolvers<boolean>()
    waiters.set(id, waiter)

    return waiter.promise
  }

  createComputed(() => {
    const next = active()

    untrack(() => dispatch({ type: "sync", active: next }))
  })

  if (getOwner()) onCleanup(() => dispatch({ type: "disposed" }))

  return (href: string): boolean | Promise<boolean> => {
    if (selectLinkCheckDisposed(machine.state)) return false

    if (!selectLinkCheckActive(machine.state)) return wait(dispatch({ type: "defer", href }))
    const result = untrack(() => check(href))

    if (result === true || result === false) return result
    const id = dispatch({ type: "start", href })
    const pending = wait(id)

    if (id !== undefined) answer(id, result)

    return pending
  }
}
