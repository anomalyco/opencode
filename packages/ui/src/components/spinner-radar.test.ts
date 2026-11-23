import { expect, test } from "bun:test"
import { inflateSync } from "node:zlib"
import { radarDots, radarFps, radarFrameCount, radarOpacity } from "./spinner-radar"

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

// The committed frames must be the radar's: run `bun run generate:spinner` after changing spinner-radar.ts.
test("spinner-frames.css holds the radar's frames as a looping 90 fps APNG", async () => {
  const css = await Bun.file(new URL("./spinner-frames.css", import.meta.url)).text()
  const png = Buffer.from(/--spinner-frames: url\("data:image\/png;base64,([^"]+)"\)/.exec(css)![1]!, "base64")

  const chunks = Array.from({ length: png.length }).reduce<{ offset: number; list: { type: string; data: Buffer }[] }>(
    (state) => {
      if (state.offset >= png.length) return state
      const length = png.readUInt32BE(state.offset)

      return {
        offset: state.offset + length + 12,
        list: [
          ...state.list,
          {
            type: png.toString("ascii", state.offset + 4, state.offset + 8),
            data: png.subarray(state.offset + 8, state.offset + 8 + length),
          },
        ],
      }
    },
    { offset: 8, list: [] },
  ).list

  const animation = chunks.find((chunk) => chunk.type === "acTL")!
  expect(animation.data.readUInt32BE(0)).toBe(radarFrameCount)
  expect(animation.data.readUInt32BE(4)).toBe(0)

  const controls = chunks.filter((chunk) => chunk.type === "fcTL")
  expect(controls).toHaveLength(radarFrameCount)
  controls.forEach((control) => {
    expect(control.data.readUInt16BE(20) / control.data.readUInt16BE(22)).toBe(1 / radarFps)
  })

  const frames = chunks
    .filter((chunk) => chunk.type === "IDAT" || chunk.type === "fdAT")
    .map((chunk) => inflateSync(chunk.type === "IDAT" ? chunk.data : chunk.data.subarray(4)))

  expect(frames).toHaveLength(radarFrameCount)

  // Each dot owns a 3×3 block of a 15×15 grey-alpha frame; read the alpha at its centre texel.
  const dots = radarDots()

  frames.forEach((frame, index) => {
    const alpha = dots.map((_, dot) => frame[(Math.floor(dot / 5) * 3 + 1) * 31 + 1 + ((dot % 5) * 3 + 1) * 2 + 1])
    expect(alpha).toEqual(dots.map((dot) => Math.round(radarOpacity(dot, index / radarFrameCount) * 255)))
  })
})
