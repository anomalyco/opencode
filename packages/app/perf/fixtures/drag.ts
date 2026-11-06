import type { Page } from "@playwright/test"

/** A divider to drag: its centre, how far it can travel each way (px), and the display's frame period (ms). */
export type Divider = { x: number; y: number; left: number; right: number; period: number }

type Leg = { seconds: number; at: (progress: number) => number }

const ease = (from: number, to: number, seconds: number): Leg => ({
  seconds,
  at: (progress) => from + ((to - from) * (1 - Math.cos(Math.PI * progress))) / 2,
})

// Whole cycles, so a jiggle ends where it began.
const jiggle = (around: number, amplitude: number, cycles: number, seconds: number): Leg => ({
  seconds,
  at: (progress) => around + amplitude * Math.sin(2 * Math.PI * cycles * progress),
})

/**
 * How a hand drags a divider, as offsets from where the drag starts against time, scaled by the room each way: a slow
 * stretch one way, a jiggle there, a fast throw the other way, a slow pull back, a small jiggle and home. 4.95 s.
 */
function legs(divider: Divider) {
  const l = -divider.left
  const r = divider.right

  return [
    ease(0, 0.8 * l, 1.2),
    jiggle(0.8 * l, 0.15 * divider.left, 3, 0.75),
    ease(0.8 * l, r, 0.6),
    ease(r, l, 1.5),
    ease(l, 0.4 * l, 0.4),
    jiggle(0.4 * l, 0.1 * divider.left, 3, 0.5),
    ease(0.4 * l, 0, 0.5),
  ]
}

/**
 * Presses the divider, moves the pointer once per display frame along the drag above without letting go, and releases
 * it where it started. strobe's driver has no pointer drag (`page.move` does not hold a button, and its `until:
 * "frame"` waits two animation frames and a round trip per move), so Playwright's mouse drives the drag, from the
 * runner, paced by the display's frame period on the wall clock. A frame the page misses is skipped, as a hand keeps
 * moving while the screen lags.
 */
export async function dragDivider(mouse: Page["mouse"], divider: Divider) {
  const path = legs(divider)
  const total = path.reduce((sum, leg) => sum + leg.seconds, 0)

  const offset = (seconds: number) => {
    let left = seconds

    for (const leg of path) {
      if (left <= leg.seconds) return leg.at(left / leg.seconds)
      left -= leg.seconds
    }

    return 0
  }

  await mouse.move(divider.x, divider.y)
  await mouse.down()
  const began = performance.now()

  for (let frame = 1; ; frame++) {
    const wait = began + frame * divider.period - performance.now()

    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    frame = Math.max(frame, Math.floor((performance.now() - began) / divider.period))
    const seconds = (performance.now() - began) / 1000

    if (seconds >= total) break
    await mouse.move(divider.x + offset(seconds), divider.y)
  }

  await mouse.move(divider.x, divider.y)
  await mouse.up()
}

/**
 * Reads, in the page, where the divider `selector` sits, the room its panel `panel` has to shrink to `min` and grow to
 * the row `row` less `rest` (px), and the display's frame period over 30 frames. Only in setup: it reads layout.
 */
export function measureDivider(input: { selector: string; panel: string; row: string; min: number; rest: number }) {
  return new Promise<Divider>((resolve) => {
    const box = document.querySelector(input.selector)!.getBoundingClientRect()
    const width = document.querySelector(input.panel)!.getBoundingClientRect().width
    const row = document.querySelector(input.row)!.getBoundingClientRect().width
    const times: number[] = []

    const tick = (time: number) => {
      times.push(time)

      if (times.length < 31) return requestAnimationFrame(tick)
      resolve({
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
        left: Math.max(0, Math.min(360, width - input.min - 10)),
        right: Math.max(0, Math.min(160, row - input.rest - width - 10)),
        period: (times[30]! - times[0]!) / 30,
      })
    }

    requestAnimationFrame(tick)
  })
}
