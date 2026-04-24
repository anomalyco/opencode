import { describe, expect, test } from "bun:test"
import {
  optimizeMedia,
  optimizeParts,
  isAttachable,
  getMetrics,
  registerOptimizer,
  type MediaInput,
  type MediaOutput,
} from "../../../../src/cli/cmd/tui/util/media-optimize"

describe("isAttachable", () => {
  test("accepts image mimes", () => {
    expect(isAttachable("image/png")).toBe(true)
    expect(isAttachable("image/jpeg")).toBe(true)
    expect(isAttachable("image/webp")).toBe(true)
    expect(isAttachable("image/svg+xml")).toBe(true)
  })

  test("accepts audio mimes", () => {
    expect(isAttachable("audio/wav")).toBe(true)
    expect(isAttachable("audio/mpeg")).toBe(true)
    expect(isAttachable("audio/ogg")).toBe(true)
  })

  test("accepts video mimes", () => {
    expect(isAttachable("video/mp4")).toBe(true)
    expect(isAttachable("video/webm")).toBe(true)
  })

  test("accepts PDF", () => {
    expect(isAttachable("application/pdf")).toBe(true)
  })

  test("rejects non-media mimes", () => {
    expect(isAttachable("text/plain")).toBe(false)
    expect(isAttachable("application/json")).toBe(false)
    expect(isAttachable("application/octet-stream")).toBe(false)
  })
})

describe("optimizeMedia", () => {
  const tinyPng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="

  test("passes through SVG unchanged", async () => {
    const svg = Buffer.from("<svg></svg>").toString("base64")
    const result = await optimizeMedia({ content: svg, mime: "image/svg+xml" })
    expect(result.changed).toBe(false)
    expect(result.parts).toHaveLength(1)
    expect(result.parts[0].content).toBe(svg)
    expect(result.parts[0].mime).toBe("image/svg+xml")
  })

  test("passes through small images unchanged", async () => {
    const result = await optimizeMedia({ content: tinyPng, mime: "image/png" })
    expect(result.changed).toBe(false)
    expect(result.parts).toHaveLength(1)
    expect(result.parts[0].content).toBe(tinyPng)
  })

  test("passes through PDF unchanged (placeholder)", async () => {
    const pdf = Buffer.from("%PDF-1.4 fake").toString("base64")
    const result = await optimizeMedia({ content: pdf, mime: "application/pdf" })
    expect(result.changed).toBe(false)
    expect(result.parts).toHaveLength(1)
    expect(result.parts[0].mime).toBe("application/pdf")
  })

  test("passes through unknown mime unchanged", async () => {
    const data = Buffer.from("hello").toString("base64")
    const result = await optimizeMedia({ content: data, mime: "application/octet-stream" })
    expect(result.changed).toBe(false)
    expect(result.parts).toHaveLength(1)
  })

  test("never throws on invalid input", async () => {
    const result = await optimizeMedia({ content: "not-valid-base64!!!", mime: "image/png" })
    expect(result.changed).toBe(false)
    expect(result.parts).toHaveLength(1)
  })

  test("preserves filename through pass-through", async () => {
    const result = await optimizeMedia({
      content: tinyPng,
      mime: "image/png",
      filename: "screenshot.png",
    })
    expect(result.parts[0].filename).toBe("screenshot.png")
  })

  test("respects disabled config", async () => {
    const big = Buffer.alloc(200_000, 0xff).toString("base64")
    const result = await optimizeMedia({ content: big, mime: "image/png" }, { disabled: true })
    expect(result.changed).toBe(false)
    expect(result.parts[0].content).toBe(big)
  })

  test("returns single part for audio without ffmpeg", async () => {
    const wav = Buffer.from("RIFF\x00\x00\x00\x00WAVEfmt ").toString("base64")
    const result = await optimizeMedia({ content: wav, mime: "audio/wav" })
    expect(result.parts.length).toBeGreaterThanOrEqual(1)
    expect(result.parts[0].mime).toMatch(/^audio\//)
  })

  test("returns single part for video without ffmpeg", async () => {
    const mp4 = Buffer.from("\x00\x00\x00\x18ftypmp42").toString("base64")
    const result = await optimizeMedia({ content: mp4, mime: "video/mp4" })
    expect(result.parts.length).toBeGreaterThanOrEqual(1)
  })
})

describe("registerOptimizer", () => {
  test("external optimizer overrides builtin", async () => {
    const dispose = registerOptimizer("image", async (input: MediaInput) => ({
      parts: [{ content: "custom", mime: "image/jpeg", filename: input.filename }],
      changed: true,
    }))

    const big = Buffer.alloc(200_000, 0xff).toString("base64")
    const result = await optimizeMedia({ content: big, mime: "image/png", filename: "test.png" })
    expect(result.changed).toBe(true)
    expect(result.parts[0].content).toBe("custom")

    dispose()

    // After dispose, should fall back to builtin (which passes through since
    // the buffer is not a valid image for sips/magick)
    const result2 = await optimizeMedia({ content: big, mime: "image/png" })
    expect(result2.parts[0].content).not.toBe("custom")
  })

  test("dispose unregisters the override", async () => {
    const dispose = registerOptimizer("audio", async () => ({
      parts: [{ content: "overridden", mime: "audio/wav" }],
      changed: true,
    }))
    dispose()

    const wav = Buffer.from("RIFF\x00\x00\x00\x00WAVEfmt ").toString("base64")
    const result = await optimizeMedia({ content: wav, mime: "audio/wav" })
    // Should not have the override content
    expect(result.parts[0].content).not.toBe("overridden")
  })
})

describe("getMetrics", () => {
  test("records metrics when optimization occurs", async () => {
    const before = getMetrics().length
    const dispose = registerOptimizer("image", async (input: MediaInput) => ({
      parts: [{ content: "smaller", mime: "image/jpeg", filename: input.filename }],
      changed: true,
    }))

    const big = Buffer.alloc(200_000, 0xff).toString("base64")
    await optimizeMedia({ content: big, mime: "image/png", filename: "shot.png" })
    dispose()

    const metrics = getMetrics()
    expect(metrics.length).toBeGreaterThan(before)
    const last = metrics[metrics.length - 1]
    expect(last.mime).toBe("image/png")
    expect(last.tool).toBe("plugin:image")
    expect(last.originalBytes).toBeGreaterThan(0)
    expect(last.durationMs).toBeGreaterThanOrEqual(0)
  })

  test("does not record metrics when unchanged", async () => {
    const before = getMetrics().length
    const tinyPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
    await optimizeMedia({ content: tinyPng, mime: "image/png" })
    expect(getMetrics().length).toBe(before)
  })
})

describe("optimizeParts", () => {
  test("passes through text parts unchanged", async () => {
    const parts = [
      { type: "text", text: "hello world" },
      { type: "text", text: "more text" },
    ]
    const result = await optimizeParts(parts)
    expect(result.parts).toEqual(parts)
    expect(result.metrics).toHaveLength(0)
  })

  test("passes through non-data-url file parts", async () => {
    const parts = [
      { type: "file", mime: "image/png", url: "https://example.com/img.png", filename: "img.png" },
    ]
    const result = await optimizeParts(parts)
    expect(result.parts).toEqual(parts)
  })

  test("passes through small image file parts", async () => {
    const tinyPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
    const parts = [
      { type: "file", mime: "image/png", url: `data:image/png;base64,${tinyPng}`, filename: "tiny.png" },
    ]
    const result = await optimizeParts(parts)
    expect(result.parts).toHaveLength(1)
    expect(result.parts[0]).toEqual(parts[0])
  })

  test("optimizes file parts with registered optimizer", async () => {
    const dispose = registerOptimizer("image", async (input: MediaInput) => ({
      parts: [{ content: "optimized-data", mime: "image/jpeg", filename: input.filename }],
      changed: true,
    }))

    const big = Buffer.alloc(200_000, 0xff).toString("base64")
    const parts = [
      { type: "text", text: "describe this" },
      { type: "file", mime: "image/png", url: `data:image/png;base64,${big}`, filename: "big.png" },
    ]
    const result = await optimizeParts(parts)
    dispose()

    expect(result.parts).toHaveLength(2)
    expect(result.parts[0]).toEqual(parts[0])
    expect(result.parts[1].mime).toBe("image/jpeg")
    expect(result.parts[1].url).toBe("data:image/jpeg;base64,optimized-data")
    expect(result.metrics.length).toBeGreaterThan(0)
  })

  test("respects disabled config", async () => {
    const dispose = registerOptimizer("image", async () => ({
      parts: [{ content: "should-not-appear", mime: "image/jpeg" }],
      changed: true,
    }))

    const big = Buffer.alloc(200_000, 0xff).toString("base64")
    const parts = [
      { type: "file", mime: "image/png", url: `data:image/png;base64,${big}`, filename: "big.png" },
    ]
    const result = await optimizeParts(parts, { disabled: true })
    dispose()

    expect(result.parts).toEqual(parts)
  })
})
