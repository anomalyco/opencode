import type { Page } from "@hona/strobe"

/** A divider to drag: how far it can travel each way (px). */
export type Divider = { left: number; right: number }

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
 * Presses the divider (`selector`), moves the pointer along the drag above without letting go, and releases it where
 * it started. strobe's `page.drag` sends one move per display frame on its own clock, without waiting for the page to
 * handle each, as a hand keeps moving while the screen lags; `input.rate` says how evenly the moves went out.
 */
export function dragDivider(page: Page, selector: string, divider: Divider) {
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

  return page.drag(selector, (progress) => [offset(progress * total), 0], { duration: total * 1000 })
}

/**
 * Reads, in the page, the room the panel `panel` beside the divider `selector` has to shrink to `min` and grow to the
 * row `row` less `rest` (px). Only in setup: it reads layout.
 */
export function measureDivider(input: { panel: string; row: string; min: number; rest: number }): Divider {
  const width = document.querySelector(input.panel)!.getBoundingClientRect().width
  const row = document.querySelector(input.row)!.getBoundingClientRect().width

  return {
    left: Math.max(0, Math.min(360, width - input.min - 10)),
    right: Math.max(0, Math.min(160, row - input.rest - width - 10)),
  }
}
