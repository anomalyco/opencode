import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"

export function createDelayedPresence<T>(source: Accessor<T | undefined>, delay: number) {
  const [visible, setVisible] = createSignal(false)

  createEffect(() => {
    const value = source()
    setVisible(false)
    if (value === undefined) return

    const timer = setTimeout(() => setVisible(true), delay)
    onCleanup(() => clearTimeout(timer))
  })

  return visible
}
