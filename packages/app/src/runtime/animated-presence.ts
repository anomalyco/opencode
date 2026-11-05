import { createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import {
  createAnimatedPresenceState,
  DISPOSED_ANIMATED_EVENT,
  selectAnimatedAnimate,
  selectAnimatedShow,
  selectAnimatedValue,
  transitionAnimatedPresence,
  type AnimatedPresenceEvent,
} from "./presence-machine"
import { createPresence } from "./presence"

export function createAnimatedPresence<T>(
  value: Accessor<T | undefined>,
  element: Accessor<HTMLElement | null>,
  identity?: Accessor<unknown>,
  minimumDuration = 0,
) {
  const hasIdentity = identity !== undefined
  let current = createAnimatedPresenceState(untrack(value), untrack(() => identity?.()), Date.now())
  const [machine, setMachine] = createSignal(current)
  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: AnimatedPresenceEvent<T>) => {
    const previous = current
    const next = transitionAnimatedPresence(previous, event)

    if (next === previous) return
    current = next

    if (previous.status === "lingering") {
      clearTimeout(timer)
      timer = undefined
    }

    if (next.status === "lingering") {
      const attempt = next.attempt
      // Rounded up: a timer cut short by a fraction of a millisecond would leave the linger unfinished.
      timer = setTimeout(() => dispatch({ type: "linger.elapsed", attempt }), Math.ceil(next.delayMs))
    }

    if (next.status !== "disposed") setMachine(next)
  }

  createEffect(() => {
    const nextValue = value()
    const nextIdentity = identity?.()

    untrack(() =>
      dispatch({ type: "sync", value: nextValue, identity: nextIdentity, hasIdentity, minimumDuration, now: Date.now() }),
    )
  })

  onCleanup(() => dispatch(DISPOSED_ANIMATED_EVENT))

  const presence = createPresence({
    show: () => selectAnimatedShow(machine()),
    element,
    // A change that does not animate (another identity) must not wait for the previous identity's exit.
    instant: () => !selectAnimatedAnimate(machine()),
  })

  return {
    ...presence,
    show: () => selectAnimatedShow(machine()),
    animate: () => selectAnimatedAnimate(machine()),
    value: () => selectAnimatedValue(machine()),
  }
}
