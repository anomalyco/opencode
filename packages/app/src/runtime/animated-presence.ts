import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import createPresence from "solid-presence"

export function createAnimatedPresence<T>(
  value: Accessor<T | undefined>,
  element: Accessor<HTMLElement | null>,
  identity?: Accessor<unknown>,
  minimumDuration = 0,
) {
  const [tick, setTick] = createSignal(0)
  const animation = createMemo<{
    identity?: unknown
    show: boolean
    animate: boolean
    value: T | undefined
    started: number
  }>((previous) => {
    tick()
    const currentIdentity = identity?.()
    const current = value()
    const same = !identity || previous?.identity === currentIdentity
    const started = same && previous?.show ? previous.started : performance.now()
    const remaining =
      current === undefined && same && previous?.show ? minimumDuration - (performance.now() - started) : 0
    const show = current !== undefined || remaining > 0
    if (remaining > 0) {
      const timer = setTimeout(() => setTick((value) => value + 1), remaining)
      onCleanup(() => clearTimeout(timer))
    }
    return {
      identity: currentIdentity,
      show,
      started,
      animate: previous !== undefined && same && (previous.animate || previous.show !== show),
      value: current ?? (same ? previous?.value : undefined),
    }
  })
  const presence = createPresence({ show: () => animation().show, element })
  return {
    ...presence,
    show: () => animation().show,
    animate: () => animation().animate,
    value: () => animation().value,
  }
}
