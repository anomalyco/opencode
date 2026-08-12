import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, extname } from "node:path"
import { encodeFrames } from "./encode.js"
import { replayRecording, type ReplayOptions } from "./replay.js"
import { CellHeight, CellWidth, renderFrame } from "./render.js"

export interface ExportRecordingOptions extends ReplayOptions {
  ffmpegPath?: string
  header?: string | ((atMs: number) => string)
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}

export interface ExportRecordingResult {
  frames: number
  durationMs: number
  width: number
  height: number
}

export async function exportRecording(
  timelinePath: string,
  outputPath: string,
  options: ExportRecordingOptions = {},
): Promise<ExportRecordingResult> {
  options.signal?.throwIfAborted()
  const frames = await replayRecording(timelinePath, options)
  options.signal?.throwIfAborted()
  const final = frames.at(-1)!
  let cols = 0
  let rows = 0
  for (const sample of frames) {
    cols = Math.max(cols, sample.frame.cols)
    rows = Math.max(rows, sample.frame.rows)
  }
  const extension = extname(outputPath).toLowerCase()
  const header = (atMs: number) =>
    typeof options.header === "function" ? options.header(atMs) : options.header
  const progress = progressReporter(options.onProgress)
  await mkdir(dirname(outputPath), { recursive: true })

  if (extension === ".png") {
    await writeFile(
      outputPath,
      renderFrame(final.frame, { cols, rows, header: header(final.atMs) }),
      { signal: options.signal },
    )
    progress(100)
  } else if (extension === ".mp4") {
    const frameKeys = new WeakMap<object, string>()
    await encodeFrames(
      frames.map((sample) => {
        const label = header(sample.atMs)
        let frameKey = frameKeys.get(sample.frame)
        if (frameKey === undefined) {
          frameKey = createHash("sha256").update(JSON.stringify(sample.frame)).digest("hex")
          frameKeys.set(sample.frame, frameKey)
        }
        return {
          atMs: sample.atMs,
          key: JSON.stringify([frameKey, label]),
          render: () => renderFrame(sample.frame, { cols, rows, header: label }),
        }
      }),
      outputPath,
      options,
    )
  } else {
    throw new Error(`Unsupported recording output extension: ${extension || "(none)"}`)
  }

  return {
    frames: frames.length,
    durationMs: final.atMs,
    width: cols * CellWidth,
    height: rows * CellHeight + (options.header ? 40 : 0),
  }
}

function progressReporter(onProgress?: (percent: number) => void) {
  let reported = 0
  return (percent: number) => {
    const target = Math.min(100, Math.floor(percent / 10) * 10)
    while (reported < target) {
      reported += 10
      onProgress?.(reported)
    }
  }
}
