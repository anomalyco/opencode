import { expect, test } from "bun:test"
import { radarDots, radarFrames, radarOpacity, radarSpriteSvg, radarStylesheet } from "./spinner-radar"

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
    const lit = ring.map((dot) => radarOpacity(dot, head))
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

test("the sprite strip bakes every frame into one vertical SVG mask", () => {
  const svg = radarSpriteSvg()
  const css = radarStylesheet("radar")

  expect(svg).toContain(`viewBox='0 0 16 ${radarFrames * 16}'`)
  expect(svg).toContain("fill-opacity='1'")
  expect((svg.match(/<rect /g) ?? []).length).toBe(radarFrames * 25)
  expect(css).toContain("@keyframes radar{")
  expect(css).toContain(`steps(${radarFrames},end)`)
})
