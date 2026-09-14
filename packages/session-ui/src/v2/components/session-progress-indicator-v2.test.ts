import { expect, test } from "bun:test"

test("progress indicator PNG loops 36 frames at 30 fps in a 16x16 canvas", async () => {
  const png = Buffer.from(
    await Bun.file(new URL("./session-progress-indicator-v2-1x.png", import.meta.url)).arrayBuffer(),
  )
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

  const chunks: { type: string; data: Buffer }[] = []
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset)
    expect(offset + length + 12).toBeLessThanOrEqual(png.length)
    chunks.push({
      type: png.toString("ascii", offset + 4, offset + 8),
      data: png.subarray(offset + 8, offset + 8 + length),
    })
    offset += length + 12
  }

  expect(chunks[0].type).toBe("IHDR")
  expect(chunks[0].data.readUInt32BE(0)).toBe(16)
  expect(chunks[0].data.readUInt32BE(4)).toBe(16)
  expect(chunks.at(-1)?.type).toBe("IEND")

  const animation = chunks.filter((chunk) => chunk.type === "acTL")
  expect(animation).toHaveLength(1)
  expect(animation[0].data.readUInt32BE(0)).toBe(36)
  expect(animation[0].data.readUInt32BE(4)).toBe(0)

  const frames = chunks.filter((chunk) => chunk.type === "fcTL")
  expect(frames).toHaveLength(36)
  const delays = frames.map((frame) => frame.data.readUInt16BE(20) / (frame.data.readUInt16BE(22) || 100))
  expect(delays.every((delay) => delay === 1 / 30)).toBe(true)
  expect(delays.reduce((total, delay) => total + delay, 0)).toBeCloseTo(1.2, 10)
})
