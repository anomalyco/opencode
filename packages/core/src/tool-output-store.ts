export * as ToolOutputStore from "./tool-output-store"

import path from "path"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { Config } from "./config"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { SessionSchema } from "./session/schema"
import { Identifier } from "./util/identifier"
import type { ToolOutput } from "@opencode-ai/llm"

export const MAX_LINES = 2_000
export const MAX_BYTES = 50 * 1024
export const MAX_INLINE_MEDIA_BYTES = 5 * 1024 * 1024
export const RETENTION = Duration.days(7)

export const MANAGED_DIRECTORY = "tool-output"

export interface BoundInput {
  readonly sessionID: SessionSchema.ID
  readonly toolCallID: string
  readonly output: ToolOutput
}

export interface BoundResult {
  readonly output: ToolOutput
  readonly outputPaths: ReadonlyArray<string>
}

export class StorageError extends Schema.TaggedErrorClass<StorageError>()("ToolOutputStore.StorageError", {
  operation: Schema.Literals(["encode", "write"]),
  cause: Schema.Defect,
}) {}

export class MediaLimitError extends Schema.TaggedErrorClass<MediaLimitError>()("ToolOutputStore.MediaLimitError", {
  mime: Schema.String,
  bytes: Schema.Int,
  limit: Schema.Int,
}) {}

export type Error = StorageError | MediaLimitError

export interface Interface {
  readonly limits: () => Effect.Effect<{ readonly maxLines: number; readonly maxBytes: number }>
  readonly bound: (input: BoundInput) => Effect.Effect<BoundResult, Error>
  readonly cleanup: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ToolOutputStore") {}

const takePrefix = (input: string, maximumBytes: number) => {
  let bytes = 0
  let content = ""
  for (const char of input) {
    const size = Buffer.byteLength(char, "utf-8")
    if (bytes + size > maximumBytes) break
    content += char
    bytes += size
  }
  return content
}

const takeSuffix = (input: string, maximumBytes: number) => {
  let bytes = 0
  const content: string[] = []
  for (const char of Array.from(input).toReversed()) {
    const size = Buffer.byteLength(char, "utf-8")
    if (bytes + size > maximumBytes) break
    content.unshift(char)
    bytes += size
  }
  return content.join("")
}

const preview = (text: string, maxLines: number, maxBytes: number) => {
  const lines = text.split("\n")
  const headLines = Math.ceil(maxLines / 2)
  const tailLines = Math.floor(maxLines / 2)
  const sampled =
    lines.length <= maxLines
      ? text
      : [
          lines.slice(0, headLines).join("\n"),
          ...(tailLines > 0 ? [lines.slice(lines.length - tailLines).join("\n")] : []),
        ].join("\n")
  if (Buffer.byteLength(sampled, "utf-8") <= maxBytes) {
    return lines.length <= maxLines
      ? { head: sampled, tail: "" }
      : {
          head: lines.slice(0, headLines).join("\n"),
          tail: tailLines > 0 ? lines.slice(lines.length - tailLines).join("\n") : "",
        }
  }
  const headBytes = Math.ceil(maxBytes / 2)
  const tailBytes = Math.floor(maxBytes / 2)
  return { head: takePrefix(sampled, headBytes), tail: takeSuffix(sampled, tailBytes) }
}

const boundedPreview = (text: string, marker: string, maxLines: number, maxBytes: number) => {
  const markerOnly = takePrefix(marker, maxBytes).split("\n").slice(0, maxLines).join("\n")
  const markerBytes = Buffer.byteLength(marker, "utf-8")
  if (maxLines <= 4 || maxBytes <= markerBytes + 4) return markerOnly
  const bounded = preview(text, maxLines - 4, maxBytes - markerBytes - 4)
  return bounded.tail ? `${bounded.head}\n\n${marker}\n\n${bounded.tail}` : `${bounded.head}\n\n${marker}`
}

const lineCount = (text: string) => {
  let count = 1
  for (const char of text) if (char === "\n") count++
  return count
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const config = yield* Effect.serviceOption(Config.Service)
    const directory = path.join(global.data, MANAGED_DIRECTORY)
    const limits = Effect.fn("ToolOutputStore.limits")(function* () {
      if (Option.isNone(config)) return { maxLines: MAX_LINES, maxBytes: MAX_BYTES }
      const entries = yield* config.value.entries().pipe(Effect.catch(() => Effect.succeed([] as Config.Entry[])))
      const configured = Object.assign(
        {},
        ...entries.flatMap((entry) => (entry.type === "document" ? [entry.info.tool_output ?? {}] : [])),
      )
      return { maxLines: configured.max_lines ?? MAX_LINES, maxBytes: configured.max_bytes ?? MAX_BYTES }
    })

    const write = Effect.fn("ToolOutputStore.write")(function* (content: string) {
      const file = path.join(directory, `tool_${Identifier.ascending()}`)
      yield* fs.ensureDir(directory).pipe(Effect.mapError((cause) => new StorageError({ operation: "write", cause })))
      yield* fs
        .writeFileString(file, content, { flag: "wx" })
        .pipe(Effect.mapError((cause) => new StorageError({ operation: "write", cause })))
      return file
    })

    const bound = Effect.fn("ToolOutputStore.bound")(function* (input: BoundInput) {
      const outputLimits = yield* limits()
      const media = input.output.content.filter((item) => item.type === "file")
      let mediaBytes = 0
      for (const item of media) {
        if (item.source.type !== "data") continue
        mediaBytes += Buffer.byteLength(item.source.data, "utf-8")
        if (mediaBytes > MAX_INLINE_MEDIA_BYTES)
          return yield* new MediaLimitError({ mime: item.mime, bytes: mediaBytes, limit: MAX_INLINE_MEDIA_BYTES })
      }
      const contextual = {
        structured: media.length > 0 ? {} : input.output.structured,
        content: input.output.content.filter((item) => item.type === "text"),
      }
      const encoded = yield* Effect.try({
        try: () => JSON.stringify(contextual, null, 2),
        catch: (cause) => new StorageError({ operation: "encode", cause }),
      })
      if (lineCount(encoded) <= outputLimits.maxLines && Buffer.byteLength(encoded, "utf-8") <= outputLimits.maxBytes)
        return {
          output: { structured: contextual.structured, content: input.output.content },
          outputPaths: [],
        }

      const outputPath = yield* write(encoded)
      const marker = `... output truncated; full content saved to ${outputPath} ...`

      return {
        output: {
          structured: {},
          content: [
            {
              type: "text" as const,
              text: boundedPreview(encoded, marker, outputLimits.maxLines, outputLimits.maxBytes),
            },
            ...media,
          ],
        },
        outputPaths: [outputPath],
      }
    })

    const cleanup = Effect.fn("ToolOutputStore.cleanup")(function* () {
      const entries = yield* fs.readDirectory(directory).pipe(Effect.catch(() => Effect.succeed([])))
      const cutoff = Date.now() - Duration.toMillis(RETENTION)
      for (const entry of entries) {
        if (!entry.startsWith("tool_")) continue
        const file = path.join(directory, entry)
        const info = yield* fs.stat(file).pipe(Effect.catch(() => Effect.void))
        const modified = info?.mtime.pipe(
          Option.map((date) => date.getTime()),
          Option.getOrElse(() => 0),
        )
        if (modified !== undefined && modified < cutoff) yield* fs.remove(file).pipe(Effect.catch(() => Effect.void))
      }
    })

    return Service.of({ limits, bound, cleanup })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FSUtil.defaultLayer), Layer.provide(Global.defaultLayer))

/** Runs retention scanning once globally rather than once per active Location. */
export const cleanupLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* Service
    yield* store.cleanup().pipe(Effect.repeat(Schedule.spaced(Duration.hours(1))), Effect.forkScoped)
  }),
)

export const defaultCleanupLayer = Layer.merge(defaultLayer, cleanupLayer.pipe(Layer.provide(defaultLayer)))
