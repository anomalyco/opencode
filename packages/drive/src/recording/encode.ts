import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { runFfmpeg } from "./ffmpeg.js"
import { resolveFps } from "./frame-rate.js"

export interface ImageFrame {
  readonly atMs: number
  readonly key: string
  readonly render: () => Buffer | Promise<Buffer>
}

export interface EncodeOptions {
  readonly ffmpegPath?: string
  readonly fps?: number
  readonly onProgress?: (percent: number) => void
  readonly signal?: AbortSignal
}

export async function encodeFrames(
  frames: ReadonlyArray<ImageFrame>,
  output: string,
  options: EncodeOptions = {},
) {
  const final = frames.at(-1)
  if (!final) throw new Error("recording has no frames")
  const fps = resolveFps(options.fps)
  const frameIntervalMs = 1000 / fps
  await mkdir(dirname(output), { recursive: true })
  const directory = await mkdtemp(join(tmpdir(), "opencode-drive-recording-"))
  const progress = progressReporter(options.onProgress)
  try {
    const unique = new Map<string, string>()
    const renderedFrames: string[] = []
    for (const [index, frame] of frames.entries()) {
      options.signal?.throwIfAborted()
      let rendered = unique.get(frame.key)
      if (!rendered) {
        const hash = createHash("sha256").update(frame.key).digest("hex")
        rendered = `unique-${hash}.png`
        await writeFile(join(directory, rendered), await frame.render(), { signal: options.signal })
        unique.set(frame.key, rendered)
      }
      renderedFrames.push(rendered)
      progress(((index + 1) / frames.length) * 90)
    }
    const concat = join(directory, "frames.ffconcat")
    const firstAtMs = frames[0]!.atMs
    const lastFrameIndex = Math.max(0, Math.ceil((final.atMs - firstAtMs) / frameIntervalMs - 1e-9))
    const entries: string[] = []
    let sourceIndex = 0
    for (let index = 0; index <= lastFrameIndex; index++) {
      const atMs = firstAtMs + index * frameIntervalMs
      while (frames[sourceIndex + 1] && frames[sourceIndex + 1]!.atMs <= atMs + 1e-9) sourceIndex++
      entries.push(`file ${renderedFrames[sourceIndex]!}`)
    }
    await writeFile(concat, `ffconcat version 1.0\n${entries.join("\n")}\n`, {
      signal: options.signal,
    })
    await runFfmpeg(
      options.ffmpegPath ?? "ffmpeg",
      [
        "-y",
        "-r",
        String(fps),
        "-safe",
        "0",
        "-f",
        "concat",
        "-i",
        concat,
        "-c:v",
        "libx264",
        "-crf",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-fps_mode",
        "cfr",
        output,
      ],
      options.signal,
    )
    progress(100)
  } finally {
    await rm(directory, { recursive: true, force: true })
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
