/** Pure motion curves for the film, kept apart from the scenes so they can be checked frame by frame. */

const clamp = (value: number) => Math.min(1, Math.max(0, value))
const inOut = (t: number) => {
  const x = clamp(t)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/**
 * The exploded view's lift factor for one module, 1 (fully exploded) to 0 (flat). It drifts from 1
 * to 0.92 until `settle` ("Because we cared"), then eases to 0 in one cubic in-out curve that ends
 * `land` seconds after `snap` ("completely"), each module `delay` seconds after the last. Both pieces
 * start and stop at rest and meet at 0.92, so the motion is continuous in position and speed, and it
 * never reverses.
 */
export function explodeFactor(t: number, delay: number, settle: number, snap: number, land = 0.35) {
  if (t < settle) return 1 - 0.08 * inOut(t / settle)
  return 0.92 * (1 - inOut((t - settle - delay) / (snap + land - settle)))
}
