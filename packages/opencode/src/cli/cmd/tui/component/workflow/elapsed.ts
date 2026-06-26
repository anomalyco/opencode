import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"

export function useElapsed(startAt: Accessor<number | undefined>) {
  const [secs, setSecs] = createSignal(0)
  createEffect(() => {
    const start = startAt()
    if (!start) {
      setSecs(0)
      return
    }
    const tick = () => setSecs(Math.max(0, Math.round((Date.now() - start) / 1000)))
    tick()
    const t = setInterval(tick, 1000)
    onCleanup(() => clearInterval(t))
  })
  return secs
}

export function useCountdown(targetAt: Accessor<number | undefined>) {
  const [secs, setSecs] = createSignal(0)
  createEffect(() => {
    const target = targetAt()
    if (!target) {
      setSecs(0)
      return
    }
    const tick = () => setSecs(Math.max(0, Math.round((target - Date.now()) / 1000)))
    tick()
    const t = setInterval(tick, 1000)
    onCleanup(() => clearInterval(t))
  })
  return secs
}