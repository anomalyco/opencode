// 1,000 springs, retargeted every frame so they never settle into their resting fast path. strobe's
// script host loads this module once per block and calls `frames` (perf/motion.bench.ts).
import { Spring } from "../src/motion/spring"

const springs = Array.from({ length: 1000 }, (_, i) => new Spring(i).set(i + 100))

let frame = 0

/** `count` frames at 60 Hz: every spring retargets, then steps. */
export function frames(count: number) {
  for (const end = frame + count; frame < end; frame++) {
    for (let i = 0; i < springs.length; i++) springs[i]!.set(i + (frame % 2 ? 100 : -100))

    for (let i = 0; i < springs.length; i++) springs[i]!.step(1 / 60)
  }
}
