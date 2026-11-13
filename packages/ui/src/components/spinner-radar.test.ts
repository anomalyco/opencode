import { expect, test } from "bun:test"
import { radarDots, radarKeyframes } from "./spinner-radar"

test("the radar's dots fit the viewBox and light within one loop", () => {
  const dots = radarDots()

  expect(dots).toHaveLength(25)
  dots.forEach((dot) => {
    expect(dot.x).toBeGreaterThanOrEqual(0)
    expect(dot.x + dot.size).toBeLessThanOrEqual(16)
    expect(dot.at).toBeGreaterThanOrEqual(0)
    expect(dot.at).toBeLessThan(1)
    expect(dot.still).toBeGreaterThanOrEqual(0.2)
    expect(dot.still).toBeLessThanOrEqual(1)
  })
})

test("the radar's brightest dot is never more than half a dot from its head", () => {
  const css = radarKeyframes("radar")
  // Head keyframes are linear, so each dot's opacity is a straight line between stops.
  expect(css).not.toContain("cubic-bezier")
  const shapes = [...css.matchAll(/@keyframes [\w-]+\{(.*?)\}\}/g)].map((match) =>
    [...match[1]!.matchAll(/([\d.]+)%\{opacity:([\d.]+)/g)].map((stop) => [Number(stop[1]), Number(stop[2])] as const),
  )
  const opacity = (shape: number, percent: number) => {
    const stops = shapes[shape]!
    const next = stops.findIndex(([at]) => at >= percent)
    if (next <= 0) return stops[0]![1]
    const [p0, o0] = stops[next - 1]!
    const [p1, o1] = stops[next]!
    return o0 + ((o1 - o0) * (percent - p0)) / (p1 - p0)
  }
  const dots = radarDots()
  const centre = dots.find((dot) => dot.steady)!
  const ring = dots
    .filter((dot) => !dot.steady)
    .map((dot) => ({
      ...dot,
      ring: Math.round(Math.max(Math.abs(dot.x + dot.size / 2 - 8), Math.abs(dot.y + dot.size / 2 - 8))),
    }))
  const wrap = (turns: number) => turns - Math.round(turns)

  Array.from({ length: 360 }, (_, step) => step / 360).forEach((head) => {
    const lit = ring.map((dot) => opacity(dot.shape, ((((head - dot.at) % 1) + 1) % 1) * 100))
    const top = Math.max(...lit)
    const brightest = ring.filter((_, index) => lit[index]! > top - 1e-9)

    expect(top).toBeGreaterThan(centre.still)
    brightest.forEach((dot) => {
      const offset = wrap(dot.at - head)
      // The gap to the neighbour on the head's side, on the dot's own ring.
      const gap = Math.min(
        ...ring
          .filter(
            (other) =>
              other.ring === dot.ring && other !== dot && Math.sign(wrap(other.at - dot.at)) === -Math.sign(offset),
          )
          .map((other) => Math.abs(wrap(other.at - dot.at))),
      )
      expect(Math.abs(offset)).toBeLessThanOrEqual(gap / 2 + 0.003)
    })
  })
})
