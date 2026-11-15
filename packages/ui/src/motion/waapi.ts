import { observeReducedMotion, prefersReducedMotion } from "./reduced"

export const ease = { out: "cubic-bezier(.22, 1, .36, 1)", pop: "cubic-bezier(.34, 1.36, .64, 1)" }

const arrivals = new WeakMap<Element, Animation>()

function arrival(el: Element, frames: Keyframe[], timing: KeyframeAnimationOptions, restart = false) {
  const previous = arrivals.get(el)

  if (previous && !restart && !prefersReducedMotion()) {
    const current = getComputedStyle(el)
    frames[0] = { ...frames[0], opacity: current.opacity || "1", transform: current.transform || "none" }
  }

  previous?.cancel()
  arrivals.delete(el)

  if (prefersReducedMotion() || !el.animate) return
  const animation = el.animate(frames, timing)
  arrivals.set(el, animation)

  const unsubscribe = observeReducedMotion(() => {
    if (prefersReducedMotion()) animation.cancel()
  })

  const cleanup = () => {
    unsubscribe()

    if (arrivals.get(el) === animation) arrivals.delete(el)
  }

  void animation.finished.then(cleanup, cleanup)
}

/**
 * Duration and delay are milliseconds. Transform ownership belongs to this element. An interrupted entrance
 * continues from where it was, unless `restart` (new content arriving, its predecessor fading out elsewhere).
 */
export function enter(
  el: Element,
  {
    x = 0,
    y = 0,
    scale = 1,
    duration = 220,
    delay = 0,
    easing = ease.out,
    restart = false,
  }: {
    x?: number
    y?: number
    scale?: number
    duration?: number
    delay?: number
    easing?: string
    restart?: boolean
  } = {},
): void {
  arrival(
    el,
    [
      { opacity: 0, transform: `translate3d(${x}px,${y}px,0) scale(${scale})` },
      { opacity: 1, transform: "none" },
    ],
    { duration, delay, easing, fill: "backwards" },
    restart,
  )
}

export function slideFrom(el: HTMLElement, previous: DOMRect, { duration = 300 }: { duration?: number } = {}): void {
  // The caller supplies the displayed previous pose; measure the untransformed destination.
  arrivals.get(el)?.cancel()
  arrivals.delete(el)

  if (prefersReducedMotion()) return
  const current = el.getBoundingClientRect()
  const x = previous.left - current.left
  const y = previous.top - current.top
  const sx = current.width ? previous.width / current.width : 1
  const sy = current.height ? previous.height / current.height : 1
  arrival(
    el,
    [
      { transformOrigin: "0 0", transform: `translate3d(${x}px,${y}px,0) scale(${sx},${sy})` },
      { transformOrigin: "0 0", transform: "none" },
    ],
    { duration, easing: ease.out },
  )
}
