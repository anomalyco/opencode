import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"

/**
 * Tracks an element's height via ResizeObserver.
 * Returns a reactive signal that updates whenever the element resizes.
 */
export function useElementHeight(
  ref: Accessor<HTMLElement | undefined> | (() => HTMLElement | undefined),
  initial = 0,
): Accessor<number> {
  const [height, setHeight] = createSignal(initial)

  createEffect(() => {
    const el = ref()
    if (!el) return
    setHeight(el.getBoundingClientRect().height)
    const observer = new ResizeObserver(() => {
      setHeight(el.getBoundingClientRect().height)
    })
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  })

  return height
}
