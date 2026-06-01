import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"

export function useCountdown(expiresAt: Accessor<number | undefined>) {
  const [remaining, setRemaining] = createSignal(0)

  createEffect(() => {
    const expires = expiresAt()
    if (!expires) return

    let raf: number | undefined
    const tick = () => {
      setRemaining(Math.max(0, (expires - Date.now()) / 1000))
      if (expires - Date.now() > 0) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    onCleanup(() => {
      if (raf !== undefined) cancelAnimationFrame(raf)
    })
  })

  return remaining
}
