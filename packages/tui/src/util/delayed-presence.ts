import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"

export function createDelayedPresence<T>(source: Accessor<T | undefined>, delay: number | ((value: T) => number)) {
  const [visible, setVisible] = createSignal(false)

  createEffect(() => {
    const value = source()
    setVisible(false)
    if (value === undefined) return

    const remaining = typeof delay === "function" ? delay(value) : delay
    if (remaining <= 0) {
      setVisible(true)
      return
    }

    const timer = setTimeout(() => setVisible(true), remaining)
    onCleanup(() => clearTimeout(timer))
  })

  return visible
}
