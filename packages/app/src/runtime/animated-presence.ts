import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import {
  createAnimatedPresenceState,
  selectAnimatedAnimate,
  selectAnimatedShow,
  selectAnimatedValue,
  transitionAnimatedPresence,
  type AnimatedPresenceState,
} from "./presence-machine"
import { createPresence } from "./presence"

export function createAnimatedPresence<T>(
  value: Accessor<T | undefined>,
  element: Accessor<HTMLElement | null>,
  identity?: Accessor<unknown>,
  minimumDuration = 0,
) {
  const hasIdentity = identity !== undefined
  // The attempt of the last linger whose timer fired; the machine ignores it unless that linger is still running.
  const [elapsed, setElapsed] = createSignal(-1)
  let timer: ReturnType<typeof setTimeout> | undefined

  // A memo, not an effect, so a read right after `value` changes already sees the next state. A sync with unchanged
  // inputs returns the same state, so re-running for a timer applies only the timer.
  const machine = createMemo<AnimatedPresenceState<T>>(
    (previous) =>
      transitionAnimatedPresence(
        transitionAnimatedPresence(previous, {
          type: "sync",
          value: value(),
          identity: identity?.(),
          hasIdentity,
          minimumDuration,
          now: Date.now(),
        }),
        { type: "linger.elapsed", attempt: elapsed() },
      ),
    createAnimatedPresenceState({ value: untrack(value), identity: untrack(() => identity?.()), now: Date.now() }),
  )

  createEffect(() => {
    const state = machine()
    clearTimeout(timer)

    if (state.status !== "lingering") return
    const attempt = state.attempt
    // Rounded up: a timer cut short by a fraction of a millisecond would leave the linger running.
    timer = setTimeout(() => setElapsed(attempt), Math.ceil(state.delayMs))
  })

  onCleanup(() => clearTimeout(timer))

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
