import { afterEach, expect, test, vi } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ImageFrame } from "../../src/recording/encode.js"

const encoded = vi.hoisted(() => ({ frames: [] as ReadonlyArray<ImageFrame> }))

vi.mock("../../src/recording/encode.js", () => ({
  encodeFrames: vi.fn(async (frames: ReadonlyArray<ImageFrame>) => {
    encoded.frames = frames
  }),
}))

import { exportRecording } from "../../src/recording/export.js"

const directories: string[] = []

afterEach(async () => {
  encoded.frames = []
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

test("deduplicates equal snapshots with distinct identities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drive-export-dedupe-test-"))
  directories.push(directory)
  const timeline = join(directory, "timeline.jsonl")
  await writeFile(
    timeline,
    [
      JSON.stringify({ type: "header", version: 1, cols: 8, rows: 2, encoding: "base64" }),
      JSON.stringify({
        type: "output",
        at_ms: 0,
        data: Buffer.from("ready").toString("base64"),
      }),
      JSON.stringify({ type: "output", at_ms: 500, data: "" }),
      "",
    ].join("\n"),
  )

  await exportRecording(timeline, join(directory, "video.mp4"))

  expect(encoded.frames).toHaveLength(31)
  expect(new Set(encoded.frames.map((frame) => frame.key))).toHaveLength(1)
})
