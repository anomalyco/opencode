import { OptimizedBuffer, RGBA } from "@opentui/core"
import { afterEach, expect, test } from "bun:test"
import { GoUpsellArtPainter } from "../../src/component/bg-pulse-render"

const buffers: OptimizedBuffer[] = []

afterEach(() => {
  buffers.splice(0).forEach((buffer) => buffer.destroy())
})

function buffer(width = 40, height = 12) {
  const result = OptimizedBuffer.create(width, height, "unicode", { respectAlpha: false })
  buffers.push(result)
  return result
}

function painter() {
  const result = new GoUpsellArtPainter()
  result.setBackgroundPanel(RGBA.fromHex("#161616"))
  result.setPrimary(RGBA.fromHex("#f5a742"))
  result.setLogoBase(RGBA.fromHex("#b0b0b0"))
  return result
}

function snapshot(buffer: OptimizedBuffer) {
  return {
    char: buffer.buffers.char.slice(),
    attributes: buffer.buffers.attributes.slice(),
    fg: buffer.buffers.fg.slice(),
    bg: buffer.buffers.bg.slice(),
  }
}

test("pulse changes colors across frames without changing the logo cells", () => {
  const art = painter()
  const frame = buffer()
  art.render(frame, { rgb: true, cache: false })
  const first = snapshot(frame)
  art.render(frame, { rgb: true, cache: false, deltaTime: 1150 })
  const next = snapshot(frame)

  expect(next.char).toEqual(first.char)
  expect(next.attributes).toEqual(first.attributes)
  expect(next.fg).not.toEqual(first.fg)
  expect(next.bg).not.toEqual(first.bg)
  expect(next.char.some((char) => char !== 32)).toBeTrue()

  art.render(frame, { rgb: true, cache: false })
  expect(snapshot(frame)).toEqual(next)
})

test.each([false, true])("all 138 cold and warm phases match uncached frames with rgb=%s", (rgb) => {
  const cached = painter()
  const frame = buffer()
  const expected = buffer()
  let previous = 0
  for (let cycle = 0; cycle < 2; cycle++) {
    for (let phase = 0; phase < 138; phase++) {
      const time = cycle * 4600 + (phase / 138) * 4600
      cached.render(frame, { rgb, deltaTime: time - previous })
      painter().render(expected, { rgb, deltaTime: (phase / 138) * 4600, cache: false })
      expect(snapshot(frame)).toEqual(snapshot(expected))
      cached.render(frame, { rgb, deltaTime: 2300 })
      cached.render(frame, { rgb, deltaTime: 2300 })
      expect(snapshot(frame)).toEqual(snapshot(expected))
      previous = time
    }
  }
})

test("repeated phases do not touch buffer cells", () => {
  const art = painter()
  const frame = buffer()
  art.render(frame, { rgb: true })
  // Any redraw or cache copy would overwrite these sentinel channels.
  frame.buffers.fg[0] ^= 255
  frame.buffers.bg[0] ^= 255
  const marked = snapshot(frame)
  art.render(frame, { rgb: true })
  art.render(frame, { rgb: true, deltaTime: 10 })
  expect(snapshot(frame)).toEqual(marked)
})

test("an uncached render cannot leave the repeated-phase guard stale", () => {
  const art = painter()
  const frame = buffer()
  art.render(frame, { rgb: true })
  const first = snapshot(frame)
  art.render(frame, { rgb: true, cache: false, deltaTime: 20 })
  expect(snapshot(frame)).not.toEqual(first)
  art.render(frame, { rgb: true })
  expect(snapshot(frame)).toEqual(first)
})

test.each(["setBackgroundPanel", "setPrimary", "setLogoBase"] as const)("%s invalidates cached colors", (setter) => {
  const cached = painter()
  const direct = painter()
  const frame = buffer()
  const expected = buffer()
  cached.render(frame, { rgb: true })
  const before = snapshot(frame)
  const color = RGBA.fromHex("#2060a0")

  expect(cached[setter](color)).toBeTrue()
  expect(cached[setter](RGBA.clone(color))).toBeFalse()
  direct[setter](color)
  cached.render(frame, { rgb: true })
  direct.render(expected, { rgb: true, cache: false })

  expect(snapshot(frame)).not.toEqual(before)
  expect(snapshot(frame)).toEqual(snapshot(expected))
})

test("resize and terminal color capability invalidate cached geometry", () => {
  const cached = painter()
  const frame = buffer()
  cached.render(frame, { rgb: true })

  for (const [width, height, rgb] of [
    [40, 12, false],
    [60, 16, false],
    [5, 2, true],
    [40, 12, true],
  ] as const) {
    frame.resize(width, height)
    const expected = buffer(width, height)
    painter().render(expected, { rgb, cache: false })
    cached.render(frame, { rgb })
    expect(snapshot(frame)).toEqual(snapshot(expected))
    cached.render(frame, { rgb })
    expect(snapshot(frame)).toEqual(snapshot(expected))
  }
})
