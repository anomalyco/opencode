import fs from "node:fs"
import path from "node:path"
import { Effect, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { Global } from "@bolt-ai/core/global"
import { InstanceState } from "@/effect/instance-state"
import DESCRIPTION from "./frames.txt"
import * as Tool from "./tool"

const MAX_FRAMES = 50

/**
 * Parse a timestamp string into seconds. Accepts plain seconds ("90", "12.5"),
 * minutes:seconds ("1:30"), and hours:minutes:seconds ("1:02:03.5").
 * Returns undefined for anything invalid.
 */
export function seconds(stamp: string): number | undefined {
  const trimmed = stamp.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  const match = trimmed.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/)
  if (!match) return undefined
  const hours = match[1] ? Number(match[1]) : 0
  const minutes = Number(match[2])
  const secs = Number(match[3])
  if (minutes >= 60 || secs >= 60) return undefined
  return hours * 3600 + minutes * 60 + secs
}

/**
 * Evenly spaced sample points (in seconds) for `count` frames across
 * `duration`, centered in each slice so the very start and end are avoided.
 */
export function spread(duration: number, count: number): number[] {
  if (duration <= 0 || count <= 0) return []
  return Array.from({ length: count }, (_, index) => Number(((duration * (index + 0.5)) / count).toFixed(3)))
}

/** Build ffmpeg args to extract one still at `at` seconds into `out`. */
export function args(video: string, at: number, out: string): string[] {
  // -ss before -i uses the fast keyframe seek; -frames:v 1 grabs a single still.
  return ["-hide_banner", "-loglevel", "error", "-ss", String(at), "-i", video, "-frames:v", "1", "-y", out]
}

export const Parameters = Schema.Struct({
  video: Schema.String.annotate({
    description: "Path to the video file, absolute or relative to the project directory",
  }),
  timestamps: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: `Timestamps to extract stills at, e.g. ["0:05", "12.5", "1:02:03.5"]. Mutually exclusive with count.`,
  }),
  count: Schema.optional(Schema.Number).annotate({
    description:
      "Number of evenly spaced stills to extract across the whole video. Mutually exclusive with timestamps.",
  }),
})

export const FramesTool = Tool.define(
  "frames",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner

    const run = Effect.fnUntraced(function* (command: string, argv: string[]) {
      let output = ""
      const code = yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(ChildProcess.make(command, argv, { stdin: "ignore" }))
          yield* Effect.forkScoped(
            Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
              Effect.sync(() => {
                output += chunk
              }),
            ),
          )
          return yield* handle.exitCode
        }),
      ).pipe(Effect.orDie)
      return { code, output }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const video = path.isAbsolute(params.video) ? params.video : path.resolve(instance.directory, params.video)
          yield* ctx.ask({
            permission: "frames",
            patterns: [video],
            always: ["*"],
            metadata: { video, timestamps: params.timestamps, count: params.count },
          })

          if (!fs.existsSync(video)) throw new Error(`video not found: ${video}`)
          if (!Bun.which("ffmpeg")) {
            throw new Error(
              "ffmpeg not found on PATH. Install it first (e.g. `apt-get install ffmpeg` or `brew install ffmpeg`) and retry.",
            )
          }
          if (!params.timestamps === !params.count) {
            throw new Error("pass exactly one of timestamps or count")
          }

          const points = params.timestamps
            ? params.timestamps.map((stamp) => ({ stamp, at: seconds(stamp) }))
            : yield* Effect.gen(function* () {
                if (!Bun.which("ffprobe")) {
                  throw new Error("count needs ffprobe to measure the video duration; pass timestamps instead")
                }
                const probe = yield* run("ffprobe", [
                  "-v",
                  "error",
                  "-show_entries",
                  "format=duration",
                  "-of",
                  "csv=p=0",
                  video,
                ])
                const duration = Number(probe.output.trim())
                if (probe.code !== 0 || !Number.isFinite(duration)) {
                  throw new Error(`could not read video duration: ${probe.output.trim() || "no ffprobe output"}`)
                }
                return spread(duration, Math.min(params.count ?? 0, MAX_FRAMES)).map((at) => ({
                  stamp: `${at}s`,
                  at,
                }))
              })

          const invalid = points.filter((point) => point.at === undefined).map((point) => point.stamp)
          if (invalid.length > 0) throw new Error(`invalid timestamps: ${invalid.join(", ")}`)
          if (points.length === 0) throw new Error("no frames requested")
          if (points.length > MAX_FRAMES) throw new Error(`too many frames requested (max ${MAX_FRAMES})`)

          const dir = path.join(Global.Path.tmp, `frames-${Date.now().toString(36)}`)
          fs.mkdirSync(dir, { recursive: true })
          const images: string[] = []
          const failures: string[] = []
          yield* Effect.forEach(
            points,
            Effect.fnUntraced(function* (point, index) {
              const out = path.join(dir, `frame-${String(index + 1).padStart(3, "0")}-at-${point.at}s.png`)
              const result = yield* run("ffmpeg", args(video, point.at ?? 0, out))
              if (result.code === 0 && fs.existsSync(out)) {
                images.push(out)
                return
              }
              failures.push(`${point.stamp}: ${result.output.trim() || `ffmpeg exited with ${result.code}`}`)
            }),
          )

          const lines: string[] = []
          if (images.length > 0) {
            lines.push(`Extracted ${images.length} frame${images.length === 1 ? "" : "s"} from ${video}:`, "")
            lines.push(...images)
            lines.push("", "Use the read tool on these paths to view the frames.")
          }
          if (failures.length > 0) {
            lines.push("", "Failed timestamps:")
            lines.push(...failures.map((failure) => `- ${failure}`))
          }

          return {
            title: `${path.basename(video)} [${images.length} frames]`,
            output: lines.join("\n"),
            metadata: { video, extracted: images.length, failed: failures.length },
          }
        }),
    }
  }),
)
