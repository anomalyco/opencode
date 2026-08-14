import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"

export function createDelayedPresence<T>(
  source: Accessor<T | undefined>,
  delay: number | ((value: T) => number),
  equals?: (previous: T, next: T) => boolean,
) {
  const [visible, setVisible] = createSignal(false)
  const value = equals
    ? createMemo(source, undefined, {
        equals: (previous, next) => {
          if (previous === undefined || next === undefined) return previous === next
          return equals(previous, next)
        },
      })
    : source

  createEffect(() => {
    const current = value()
    setVisible(false)
    if (current === undefined) return

    const remaining = typeof delay === "function" ? delay(current) : delay
    if (remaining <= 0) {
      setVisible(true)
      return
    }

    const timer = setTimeout(() => setVisible(true), remaining)
    onCleanup(() => clearTimeout(timer))
  })

  return visible
}
