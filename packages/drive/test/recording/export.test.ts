import { afterEach, expect, test } from "vitest"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createCanvas, loadImage } from "@napi-rs/canvas"
import { encodeFrames, exportRecording, joinFrames, renderFrame } from "../../src/recording/index.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

test("exports the final frame as a PNG and creates its parent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drive-export-test-"))
  directories.push(directory)
  const timeline = join(directory, "timeline.jsonl")
  await writeFile(
    timeline,
    `${JSON.stringify({ type: "header", version: 1, cols: 4, rows: 2, encoding: "base64" })}\n` +
      `${JSON.stringify({ type: "output", at_ms: 0, data: Buffer.from("hi").toString("base64") })}\n`,
  )
  const output = join(directory, "nested", "frame.png")
  const result = await exportRecording(timeline, output)
  expect(result).toEqual({ frames: 1, durationMs: 0, width: 40, height: 40 })
  expect((await readFile(output)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect((await stat(output)).size).toBeGreaterThan(100)
})

test("rejects invalid encoding frame rates", async () => {
  await expect(
    encodeFrames(
      [{ atMs: 0, key: "frame", render: () => Buffer.alloc(0) }],
      join(tmpdir(), "invalid-frame-rate.mp4"),
      { fps: 0 },
    ),
  ).rejects.toThrow("fps must be a positive finite number")
})

test("renders an optional recording header", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drive-export-header-test-"))
  directories.push(directory)
  const timeline = join(directory, "timeline.jsonl")
  await writeFile(
    timeline,
    `${JSON.stringify({ type: "header", version: 1, cols: 4, rows: 2, encoding: "base64" })}\n` +
      `${JSON.stringify({ type: "output", at_ms: 0, data: Buffer.from("hi").toString("base64") })}\n`,
  )
  const output = join(directory, "frame.png")
  const result = await exportRecording(timeline, output, { header: "Before · Submit prompt" })
  const data = await readFile(output)

  expect(result.height).toBe(80)
  expect(data.readUInt32BE(20)).toBe(80)
})

test("exports resized recordings on a stable maximum-size canvas", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drive-export-resize-test-"))
  directories.push(directory)
  const timeline = join(directory, "timeline.jsonl")
  await writeFile(
    timeline,
    [
      JSON.stringify({
        type: "header",
        version: 1,
        cols: 8,
        rows: 4,
        encoding: "base64",
      }),
      JSON.stringify({
        type: "output",
        at_ms: 0,
        data: Buffer.from("wide").toString("base64"),
      }),
      JSON.stringify({ type: "resize", at_ms: 100, cols: 4, rows: 2 }),
      JSON.stringify({
        type: "output",
        at_ms: 100,
        data: Buffer.from("small").toString("base64"),
      }),
      "",
    ].join("\n"),
  )
  const output = join(directory, "frame.png")
  const result = await exportRecording(timeline, output)
  const data = await readFile(output)

  expect(result).toEqual({ frames: 7, durationMs: 100, width: 80, height: 80 })
  expect(data.readUInt32BE(16)).toBe(80)
  expect(data.readUInt32BE(20)).toBe(80)
})

test("centers capture glyphs vertically in their cells", async () => {
  const image = await loadImage(
    renderFrame({
      cols: 2,
      rows: 1,
      cursor: { row: 0, col: 0, visible: false },
      lines: [
        {
          spans: [{ text: "Mg", width: 2, fg: 0xffffff, bg: 0x080808, attributes: 0 }],
        },
      ],
    }),
  )
  const canvas = createCanvas(20, 20)
  const context = canvas.getContext("2d")
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, 20, 20).data
  const inkRows = Array.from({ length: 20 }, (_, row) => row).filter((row) =>
    Array.from({ length: 20 }, (_, column) => (row * 20 + column) * 4).some(
      (offset) => pixels[offset] !== 8 || pixels[offset + 1] !== 8 || pixels[offset + 2] !== 8,
    ),
  )

  expect((inkRows[0]! + inkRows.at(-1)!) / 2).toBe(10.5)
})

test("renders block elements edge-to-edge", async () => {
  const image = await loadImage(
    renderFrame({
      cols: 3,
      rows: 1,
      cursor: { row: 0, col: 0, visible: false },
      lines: [
        {
          spans: [
            {
              text: "█▀▄",
              width: 3,
              fg: 0xffffff,
              bg: 0x080808,
              attributes: 0,
            },
          ],
        },
      ],
    }),
  )
  const canvas = createCanvas(30, 20)
  const context = canvas.getContext("2d")
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, 30, 20).data
  const pixel = (column: number, row: number) =>
    Array.from(pixels.subarray((row * 30 + column) * 4, (row * 30 + column) * 4 + 4))

  expect(pixel(0, 0)).toEqual([255, 255, 255, 255])
  expect(pixel(9, 19)).toEqual([255, 255, 255, 255])
  expect(pixel(10, 0)).toEqual([255, 255, 255, 255])
  expect(pixel(19, 9)).toEqual([255, 255, 255, 255])
  expect(pixel(10, 10)).toEqual([8, 8, 8, 255])
  expect(pixel(20, 9)).toEqual([8, 8, 8, 255])
  expect(pixel(20, 10)).toEqual([255, 255, 255, 255])
  expect(pixel(29, 19)).toEqual([255, 255, 255, 255])
})

test("joins rendered frames horizontally", async () => {
  const frame = {
    cols: 2,
    rows: 1,
    cursor: { row: 0, col: 0, visible: false },
    lines: [{ spans: [{ text: "hi", width: 2, fg: 0xffffff, bg: 0x080808, attributes: 0 }] }],
  }
  const joined = await joinFrames(renderFrame(frame), renderFrame(frame))

  expect(joined.readUInt32BE(16)).toBe(40)
  expect(joined.readUInt32BE(20)).toBe(20)
})

test("renders the canonical OpenCode symbol set with the fallback font", async () => {
  const symbols = [..."△⇆⊙⚙✱↳◌◈⟳▸▾■⬝⬥⬩⬪"]
  const image = await loadImage(
    renderFrame({
      cols: symbols.length,
      rows: 1,
      cursor: { row: 0, col: 0, visible: false },
      lines: [
        {
          spans: [
            {
              text: symbols.join(""),
              width: symbols.length,
              fg: 0xffffff,
              bg: 0x080808,
              attributes: 0,
            },
          ],
        },
      ],
    }),
  )
  const canvas = createCanvas(symbols.length * 10, 20)
  const context = canvas.getContext("2d")
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const masks = symbols.map((_, cell) => {
    const mask = new Uint8Array(10 * 20)
    const columns: number[] = []
    for (let row = 0; row < 20; row++) {
      for (let column = 0; column < 10; column++) {
        const source = (row * canvas.width + cell * 10 + column) * 4
        const ink = pixels[source] !== 8 || pixels[source + 1] !== 8 || pixels[source + 2] !== 8
        mask[row * 10 + column] = ink ? 1 : 0
        if (ink) columns.push(column)
      }
    }
    const center = (Math.min(...columns) + Math.max(...columns)) / 2
    expect(Math.abs(center - 4.5)).toBeLessThanOrEqual(0.5)
    return Bun.hash(mask)
  })

  expect(new Set(masks).size).toBe(symbols.length)
})

test("accepts valid capture font overrides", async () => {
  const font = new URL("../../assets/fonts/commit-mono/CommitMono-400-Regular.otf", import.meta.url)
  const child = renderImport({ OPENCODE_DRIVE_FONT: fileURLToPath(font) })
  expect(await child.exited).toBe(0)
})

test("rejects invalid capture font overrides", async () => {
  const child = renderImport({
    OPENCODE_DRIVE_FONT: "/missing/capture-font.woff2",
  })
  const stderr = new Response(child.stderr).text()
  expect(await child.exited).toBe(1)
  expect(await stderr).toContain("Failed to register capture font: /missing/capture-font.woff2")
})

if (Bun.which("ffmpeg") && Bun.which("ffprobe")) {
  test("preserves irregular frame timing at the requested frame rate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "drive-encode-ffmpeg-test-"))
    directories.push(directory)
    const image = (background: number) =>
      renderFrame({
        cols: 1,
        rows: 1,
        cursor: { row: 0, col: 0, visible: false },
        lines: [{ spans: [{ text: " ", width: 1, fg: 0xffffff, bg: background, attributes: 0 }] }],
      })
    const output = join(directory, "video.mp4")
    await encodeFrames(
      [
        { atMs: 0, key: "red", render: () => image(0xff0000) },
        { atMs: 1_000, key: "green", render: () => image(0x00ff00) },
        { atMs: 1_200, key: "blue", render: () => image(0x0000ff) },
      ],
      output,
      { fps: 5 },
    )

    expect(probeVideo(output)).toEqual(["5/1", "1.400000", "7"])

    const finalFrame = join(directory, "final.png")
    const decoded = Bun.spawnSync([
      "ffmpeg",
      "-v",
      "error",
      "-i",
      output,
      "-vf",
      "reverse",
      "-frames:v",
      "1",
      finalFrame,
    ])
    expect(decoded.exitCode).toBe(0)
    const final = await loadImage(finalFrame)
    const canvas = createCanvas(final.width, final.height)
    const context = canvas.getContext("2d")
    context.drawImage(final, 0, 0)
    const pixel = context.getImageData(5, 10, 1, 1).data
    expect(pixel[2]).toBeGreaterThan(200)
    expect(pixel[0]).toBeLessThan(80)
  })

  test("exports a 60 FPS H.264 MP4 with the off-grid final frame", async () => {
    const directory = await mkdtemp(join(tmpdir(), "drive-export-ffmpeg-test-"))
    directories.push(directory)
    const timeline = join(directory, "timeline.jsonl")
    await writeFile(
      timeline,
      [
        JSON.stringify({
          type: "header",
          version: 1,
          cols: 4,
          rows: 2,
          encoding: "base64",
        }),
        JSON.stringify({
          type: "output",
          at_ms: 0,
          data: Buffer.from("\x1b[48;2;255;0;0mAAAA").toString("base64"),
        }),
        JSON.stringify({
          type: "output",
          at_ms: 455,
          data: Buffer.from("\r\x1b[48;2;0;0;255mBBBB").toString("base64"),
        }),
        "",
      ].join("\n"),
    )
    const output = join(directory, "video.mp4")
    const progress: number[] = []
    const result = await exportRecording(timeline, output, { onProgress: (percent) => progress.push(percent) })
    const data = await readFile(output)
    expect(result.frames).toBe(29)
    expect(result.durationMs).toBe(455)
    expect(data.subarray(4, 8).toString()).toBe("ftyp")
    expect(data.length).toBeGreaterThan(500)
    expect(progress).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])

    expect(probeVideo(output)).toEqual(["60/1", "0.483333", "29"])

    const finalFrame = join(directory, "final.png")
    const decoded = Bun.spawnSync([
      "ffmpeg",
      "-v",
      "error",
      "-i",
      output,
      "-vf",
      "reverse",
      "-frames:v",
      "1",
      finalFrame,
    ])
    expect(decoded.exitCode).toBe(0)
    const image = await loadImage(finalFrame)
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext("2d")
    context.drawImage(image, 0, 0)
    const pixel = context.getImageData(9, 19, 1, 1).data
    expect(pixel[2]).toBeGreaterThan(200)
    expect(pixel[0]).toBeLessThan(80)
  })
}

function probeVideo(path: string) {
  const probe = Bun.spawnSync([
    "ffprobe",
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=avg_frame_rate,duration,nb_frames",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ])
  expect(probe.exitCode).toBe(0)
  return probe.stdout.toString().trim().split("\n")
}

function renderImport(env: Record<string, string>) {
  return Bun.spawn([process.execPath, "-e", 'await import("./src/recording/render.ts")'], {
    cwd: join(import.meta.dirname, "../.."),
    env: { ...Bun.env, ...env },
    stdout: "ignore",
    stderr: "pipe",
  })
}
