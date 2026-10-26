import { frameLoop, prefersReducedMotion, Spring, type DurationOptions } from "@opencode/ui/motion"

/**
 * One sprung number that paints itself each frame until it rests. Retargeting keeps its velocity. `travel` values
 * (positions) jump under reduced motion; others (opacity) settle in a short fade's time.
 */
export function sprung(
  initial: number,
  options: DurationOptions & { travel?: boolean },
  paint: (value: number) => void,
) {
  const spring = Spring.fromDuration(initial, options)
  let stop: (() => void) | undefined

  const snap = (value: number) => {
    stop?.()
    stop = undefined
    spring.snap(value)
    paint(value)
  }

  return {
    get value() {
      return spring.value
    },
    get target() {
      return spring.target
    },
    set(target: number) {
      const reduced = prefersReducedMotion()

      if (reduced && options.travel) return snap(target)

      const timing = reduced ? { duration: 0.18, bounce: 0 } : options
      spring.omega = (2 * Math.PI) / timing.duration
      spring.zeta = 1 - timing.bounce
      spring.set(target)
      stop ??= frameLoop.add((dt) => {
        paint(spring.step(dt))

        if (!spring.resting) return true
        stop = undefined

        return false
      })
    },
    snap,
    dispose() {
      stop?.()
      stop = undefined
    },
  }
}

/** Kit's palette, bounce 0. */
export const motion = {
  settle: { duration: 0.3, bounce: 0 },
  calm: { duration: 0.4, bounce: 0 },
} satisfies Record<string, DurationOptions>
