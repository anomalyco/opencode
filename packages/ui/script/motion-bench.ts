import { Spring } from "../src/motion/spring"

const springs = Array.from({ length: 1000 }, (_, i) => new Spring(i).set(i + 100))

const timings = new Float64Array(600)

for (let frame = -120; frame < timings.length; frame++) {
  // Retarget every frame so the benchmark never degenerates to resting fast paths.
  for (let i = 0; i < springs.length; i++) springs[i]!.set(i + (frame % 2 ? 100 : -100))
  const start = performance.now()

  for (let i = 0; i < springs.length; i++) springs[i]!.step(1 / 60)

  if (frame >= 0) timings[frame] = performance.now() - start
}

timings.sort()

console.log(
  JSON.stringify(
    { springs: 1000, hz: 60, frames: timings.length, medianMs: timings[300], p95Ms: timings[570], maxMs: timings[599] },
    null,
    2,
  ),
)
