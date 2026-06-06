export * as ToolOutputStore from "./tool-output-store"

import path from "path"
import { Context, Duration, Effect, Layer, Option, Schedule } from "effect"
import { Config } from "./config"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { SessionSchema } from "./session/schema"
import { Identifier } from "./util/identifier"
import type { ToolOutput } from "@opencode-ai/llm"

export const MAX_LINES = 2_000
export const MAX_BYTES = 50 * 1024
export const RETENTION = Duration.days(7)

export const MANAGED_DIRECTORY = "tool-output"

export interface WriteInput {
  readonly sessionID: SessionSchema.ID
  readonly toolCallID: string
  readonly content: string
  readonly mime?: string
  readonly name?: string
}

export interface TruncateInput extends WriteInput {
  readonly maxLines?: number
  readonly maxBytes?: number
}

export type TruncateResult =
  | { readonly content: string; readonly truncated: false }
  | { readonly content: string; readonly truncated: true; readonly outputPath: string }

export interface BoundInput {
  readonly sessionID: SessionSchema.ID
  readonly toolCallID: string
  readonly output: ToolOutput
}

export interface BoundResult {
  readonly output: ToolOutput
  readonly outputPaths: ReadonlyArray<string>
}

export interface Interface {
  readonly limits: () => Effect.Effect<{ readonly maxLines: number; readonly maxBytes: number }>
  readonly write: (input: WriteInput) => Effect.Effect<string>
  readonly truncate: (input: TruncateInput) => Effect.Effect<TruncateResult>
  readonly bound: (input: BoundInput) => Effect.Effect<BoundResult>
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

    const write = Effect.fn("ToolOutputStore.write")(function* (input: WriteInput) {
      const file = path.join(directory, `tool_${Identifier.ascending()}`)
      yield* fs.ensureDir(directory).pipe(Effect.orDie)
      yield* fs.writeFileString(file, input.content, { flag: "wx" }).pipe(Effect.orDie)
      return file
    })

    const truncate = Effect.fn("ToolOutputStore.truncate")(function* (input: TruncateInput) {
      const configured = yield* limits()
      const maxLines = input.maxLines ?? configured.maxLines
      const maxBytes = input.maxBytes ?? configured.maxBytes
      if (input.content.split("\n").length <= maxLines && Buffer.byteLength(input.content, "utf-8") <= maxBytes) {
        return { content: input.content, truncated: false } as const
      }
      const outputPath = yield* write(input)
      const marker = `... output truncated; full content saved to ${outputPath} ...`
      return {
        content: boundedPreview(input.content, marker, maxLines, maxBytes),
        truncated: true,
        outputPath,
      } as const
    })

    const bound = Effect.fn("ToolOutputStore.bound")(function* (input: BoundInput) {
      const text = input.output.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n\n")
      const structured = yield* Effect.sync(() => JSON.stringify(input.output.structured)).pipe(
        Effect.catch(() => Effect.succeed(String(input.output.structured))),
      )
      const content = text || input.output.content.length > 0 ? text : structured
      if (content === undefined) return { output: input.output, outputPaths: [] }

      const truncated = yield* truncate({
        sessionID: input.sessionID,
        toolCallID: input.toolCallID,
        content,
        mime: "text/plain",
        name: `${input.toolCallID}.txt`,
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Unable to retain complete tool output", cause).pipe(
            Effect.andThen(limits()),
            Effect.map(({ maxLines, maxBytes }) => {
              const marker = "... output truncated; omitted content could not be retained ..."
              return {
                content: boundedPreview(content, marker, maxLines, maxBytes),
                truncated: true as const,
              }
            }),
          ),
        ),
      )
      if (!truncated.truncated) return { output: input.output, outputPaths: [] }

      return {
        output: {
          structured: input.output.structured,
          content: [
            { type: "text" as const, text: truncated.content },
            ...input.output.content.filter((item) => item.type === "file"),
          ],
        },
        outputPaths: "outputPath" in truncated ? [truncated.outputPath] : [],
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

    return Service.of({ limits, write, truncate, bound, cleanup })
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
