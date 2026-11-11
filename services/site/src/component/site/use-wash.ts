import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { onEntrance, washColumns } from "./reveal"

/**
 * The entrance wash for a grid: the first time `element` scrolls into view, `start` becomes that
 * moment (performance.now()), and each item arrives `washStep` staggers later. Armed on the client
 * only, never with reduced motion, and only while `enabled`. `columns` follows the grid's tracks (or --wash-columns).
 * Give the container `data-entrance` and `data-mounted={mounted()}` so it waits from first paint.
 */
export function createWash(
  element: () => HTMLElement | undefined,
  enabled: () => boolean = () => true,
  // Something that must start first (the open source numbers): the wash waits for its own trigger
  // and for this, then starts no sooner than 150ms after it.
  after?: () => number | undefined,
) {
  const [armed, setArmed] = createSignal(false)
  const [own, setOwn] = createSignal<number>()
  // While a replay restarts, nothing has a state, so every item starts over.
  const [restarting, setRestarting] = createSignal(false)
  const start = () => {
    if (restarting()) return undefined
    const at = own()
    if (at === undefined || !after) return at
    const first = after()
    return first === undefined ? undefined : Math.max(at, first + 150)
  }
  const [columns, setColumns] = createSignal<number>()
  // Set once the page's code runs; until then reveal.css keeps a `data-entrance` container's items unseen.
  const [mounted, setMounted] = createSignal(false)

  onMount(() => {
    setMounted(true)
    const target = element()
    if (!target) return
    const measure = () => setColumns(washColumns(target))
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(target)
    onCleanup(() => resize.disconnect())
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    createEffect(() => {
      if (!enabled()) {
        setArmed(false)
        setOwn(undefined)
        return
      }
      setArmed(true)
      onCleanup(onEntrance(target, setOwn))
    })
  })

  // Plays the wash again (a changed style or stagger), once it has played.
  const replay = () => {
    if (start() === undefined) return
    setRestarting(true)
    requestAnimationFrame(() => {
      setOwn(performance.now())
      setRestarting(false)
    })
  }

  return { armed, start, columns, mounted, replay }
}
