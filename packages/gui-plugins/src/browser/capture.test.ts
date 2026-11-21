import { expect, test } from "bun:test"
import { CAPTURE_DEADLINE_MS, captureCoordinator, captureScale, cropPixels, FULL_PAGE_DEADLINE_MS, jpegFits, pngFits, undrawable, undrawableMessage } from "./capture"

const shown = { minimized: false, visible: true, appHidden: false }

test("full capture limits include zoom and DPI, after scaling to maxWidth", () => {
  expect(captureScale({ width: 1000, height: 4000 }, 2, 1000)).toBe(0.5)
  expect(() => captureScale({ width: 1000, height: 4001 }, 2, 2000)).toThrow("16 megapixels")
  expect(() => captureScale({ width: 100, height: 16385 }, 1, 1000)).toThrow("16384 pixels")
})

test("crop uses the returned pixels, including fractional edge overlaps at non-default zoom", () => {
  // A 200 DIP view rendered at 150% DPI, at page zoom 2: one CSS pixel covers three bitmap pixels.
  const crop = (x: number, y: number, width: number, height: number) => cropPixels({ x, y, width, height }, { width: 300, height: 240 }, 200, 2)
  expect(crop(10, 20, 4, 5)).toEqual({ x: 30, y: 60, width: 12, height: 15 })
  expect(crop(99.95, 79.95, 2, 2)).toEqual({ x: 299, y: 239, width: 1, height: 1 })
  expect(crop(-2, -2, 2.05, 2.05)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  expect(crop(100, 0, 1, 1)).toBeUndefined()
  expect(crop(0, 80, 1, 1)).toBeUndefined()
})

function coordinator() {
  let now = 0
  const jobs = new Set<{ at: number; run: () => void }>()
  const events: string[] = []

  const capture = captureCoordinator(() => events.push("begin"), () => events.push("end"), (ms, run) => {
    const task = { at: now + ms, run }
    jobs.add(task)

    return () => jobs.delete(task)
  })

  const advance = (ms: number) => {
    now += ms

    for (const job of [...jobs].sort((a, b) => a.at - b.at)) {
      if (job.at > now || !jobs.delete(job)) continue
      job.run()
    }
  }

  return { capture, advance, events, jobs }
}

test("a full-page redraw keeps its subscription beyond the viewport deadline", async () => {
  const c = coordinator()
  const shot = c.capture(false, new AbortController().signal, () => new Promise<void>(() => {}), FULL_PAGE_DEADLINE_MS)
  c.advance(CAPTURE_DEADLINE_MS)
  expect(c.events).toEqual(["begin"])
  // A never-shown tab on macOS took 5.6 s for about 15.6 MP: the deadline leaves it room, inside the tool's 60 s.
  c.advance(6_000 - CAPTURE_DEADLINE_MS)
  expect(c.events).toEqual(["begin"])
  c.advance(FULL_PAGE_DEADLINE_MS - 6_000)
  await expect(shot).rejects.toThrow("15 seconds")
  expect(c.events).toEqual(["begin", "end"])
})

test("overlapping hidden and stalled visible captures share a subscription until the last release", async () => {
  const c = coordinator()
  const one = Promise.withResolvers<void>()
  const two = Promise.withResolvers<void>()
  const signal = new AbortController().signal
  const visible = c.capture(true, signal, () => one.promise)
  c.advance(99)
  expect(c.events).toEqual([])
  c.advance(1)
  expect(c.events).toEqual(["begin"])
  const hidden = c.capture(false, signal, () => two.promise)
  one.reject(new Error("navigation"))
  await expect(visible).rejects.toThrow("navigation")
  expect(c.events).toEqual(["begin"])
  two.resolve()
  await hidden
  expect(c.events).toEqual(["begin", "end"])
  expect(c.jobs.size).toBe(0)
})

test("timeout aborts the redraw and releases once; successful or cancelled visible calls leave no fallback", async () => {
  const c = coordinator()
  const controller = new AbortController()
  const later = Promise.withResolvers<void>()
  const stopped: boolean[] = []

  const hidden = c.capture(false, controller.signal, stop => {
    stop.addEventListener("abort", () => stopped.push(true))

    return later.promise
  })

  expect(c.events).toEqual(["begin"])
  c.advance(2500)
  await expect(hidden).rejects.toThrow("No fresh frame")
  expect(stopped).toEqual([true])
  later.resolve()
  await c.capture(true, controller.signal, () => Promise.resolve())
  const cancelled = c.capture(true, controller.signal, () => new Promise<void>(() => {}))
  controller.abort()
  await expect(cancelled).rejects.toThrow("cancelled")
  c.advance(3000)
  expect(c.events).toEqual(["begin", "end"])
  expect(c.jobs.size).toBe(0)
})

test("reuse the redraw's PNG only when its actual dimensions and transfer size fit", () => {
  const png = Buffer.alloc(32)
  png.writeUInt32BE(800, 16)
  png.writeUInt32BE(600, 20)
  expect(pngFits(png, 800, 32)).toBe(true)
  expect(pngFits(png, 799, 32)).toBe(false)
  expect(pngFits(png, 800, 31)).toBe(false)
  expect(pngFits(png.subarray(0, 23), 800, 32)).toBe(false)
  png.writeUInt32BE(0, 20)
  expect(pngFits(png, 800, 32)).toBe(false)
})

test("reuse the redraw's JPEG only when its frame header dimensions and transfer size fit", () => {
  const segment = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]

  const frame = (marker: number, width: number, height: number) =>
    segment(marker, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])

  const jpeg = (...segments: number[][]) => Buffer.from([0xff, 0xd8, ...segments.flat(), 0xff, 0xd9])
  // JFIF and a Huffman table (0xc4, in the frame-marker range) precede the frame header; the scan follows it.
  const app = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
  const table = segment(0xc4, Array(20).fill(0))
  const scan = segment(0xda, [1, 1, 0, 0, 0x3f, 0])
  const image = jpeg(app, table, frame(0xc0, 800, 600), scan)
  expect(jpegFits(image, 800, image.length)).toBe(true)
  expect(jpegFits(image, 799, image.length)).toBe(false)
  expect(jpegFits(image, 800, image.length - 1)).toBe(false)
  expect(jpegFits(jpeg(app, frame(0xc2, 800, 600), scan), 800, 1_000)).toBe(true)
  expect(jpegFits(jpeg(app, frame(0xc0, 800, 0), scan), 800, 1_000)).toBe(false)
  expect(jpegFits(jpeg(app, scan, frame(0xc0, 800, 600)), 800, 1_000)).toBe(false)
  expect(jpegFits(image.subarray(0, 30), 800, 1_000)).toBe(false)
  expect(jpegFits(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 800, 1_000)).toBe(false)
})

test.each([
  { platform: "darwin", window: shown, expected: undefined },
  { platform: "darwin", window: { ...shown, minimized: true, visible: false }, expected: "minimized" },
  { platform: "darwin", window: { ...shown, appHidden: true }, expected: "hidden" },
  { platform: "darwin", window: { ...shown, visible: false }, expected: "hidden" },
  // Windows keeps drawing a minimized window, so its screenshot still works.
  { platform: "win32", window: { ...shown, minimized: true, visible: false }, expected: undefined },
  { platform: "linux", window: { ...shown, minimized: true }, expected: undefined },
] as const)("a $platform window $window cannot draw: $expected", ({ platform, window, expected }) => {
  expect(undrawable({ platform, ...window })).toBe(expected)
})

test.each(["minimized", "hidden"] as const)("the %s message asks for the window, not the connection", (reason) => {
  const message = undrawableMessage(reason)

  expect(message).toContain("restore the OpenCode window")
  expect(message).not.toMatch(/connection|reload|crash/i)
})

test("a redraw timeout never presents a cached image as a successful capture", () => {
  expect(undrawableMessage("stalled")).toContain("No cached screenshot was returned")
})
