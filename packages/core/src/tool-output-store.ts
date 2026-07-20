export * as ToolOutputStore from "./tool-output-store"

import path from "path"
import { Context, Duration, Effect, Layer, Option, Predicate, Schedule, Schema } from "effect"
import { Config } from "./config"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { makeGlobalNode, makeLocationNode } from "./effect/app-node"
import { SessionSchema } from "./session/schema"
import { Identifier } from "./util/identifier"
import type { ToolOutput } from "@opencode-ai/ai"

export const MAX_LINES = 2_000
export const MAX_BYTES = 50 * 1024
export const MAX_STRUCTURED_BYTES = 16 * 1024
export const RETENTION = Duration.days(7)

export const MANAGED_DIRECTORY = "tool-output"

export interface Limits {
  readonly maxLines: number
  readonly maxBytes: number
}

export interface BoundInput {
  readonly sessionID: SessionSchema.ID
  readonly callID: string
  readonly output: ToolOutput
  readonly propagateTruncation?: boolean
}

export interface BoundResult {
  readonly output: ToolOutput
  readonly outputPaths: ReadonlyArray<string>
}

export class StorageError extends Schema.TaggedErrorClass<StorageError>()("ToolOutputStore.StorageError", {
  operation: Schema.Literals(["encode", "write"]),
  cause: Schema.Defect(),
}) {
  override get message() {
    const detail = this.cause instanceof Error ? this.cause.message : String(this.cause)
    return `Failed to ${this.operation} tool output${detail ? `: ${detail}` : ""}`
  }
}

export type Error = StorageError

export interface Interface {
  readonly limits: () => Effect.Effect<Limits>
  readonly bound: (input: BoundInput) => Effect.Effect<BoundResult, Error>
  readonly cleanup: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ToolOutputStore") {}

const takePrefix = (input: string, maximumBytes: number) => {
  let bytes = 0
  let end = 0
  for (const char of input) {
    const size = Buffer.byteLength(char, "utf-8")
    if (bytes + size > maximumBytes) break
    end += char.length
    bytes += size
  }
  return input.slice(0, end)
}

const takeSuffix = (input: string, maximumBytes: number) => {
  let bytes = 0
  let start = input.length
  while (start > 0) {
    const codeUnit = input.charCodeAt(start - 1)
    const previous = start > 1 ? input.charCodeAt(start - 2) : 0
    const next =
      codeUnit >= 0xdc00 && codeUnit <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff ? start - 2 : start - 1
    const char = input.slice(next, start)
    const size = Buffer.byteLength(char, "utf-8")
    if (bytes + size > maximumBytes) break
    start = next
    bytes += size
  }
  return input.slice(start)
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

export const contextualOverflow = (output: ToolOutput, limits: Limits) => {
  const contextual = output.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("")
  return Buffer.byteLength(contextual, "utf-8") > limits.maxBytes || lineCount(contextual) > limits.maxLines
}

export const propagateTruncation = (output: ToolOutput, limits: Limits): ToolOutput =>
  contextualOverflow(output, limits) &&
  Predicate.isObject(output.structured) &&
  "truncated" in output.structured &&
  typeof output.structured.truncated === "boolean"
    ? { ...output, structured: { ...output.structured, truncated: true } }
    : output

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : { value }

const layer = Layer.effect(
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
      yield* fs
        .writeFileString(file, content, { flag: "wx" })
        .pipe(Effect.mapError((cause) => new StorageError({ operation: "write", cause })))
      return file
    })

    const bound = Effect.fn("ToolOutputStore.bound")(function* (input: BoundInput) {
      const outputLimits = yield* limits()
      const media = input.output.content.filter((item) => item.type === "file")
      const text = input.output.content.filter((item) => item.type === "text")
      const encoded = yield* Effect.try({
        try: () => JSON.stringify(record(input.output.structured)),
        catch: (cause) => new StorageError({ operation: "encode", cause }),
      })
      const decoded: unknown = JSON.parse(encoded)
      const structured =
        typeof decoded === "object" && decoded !== null && !Array.isArray(decoded)
          ? Object.fromEntries(Object.entries(decoded))
          : yield* Effect.die(new Error("Durable tool structured output must be an object"))
      const encodedBytes = Buffer.byteLength(encoded, "utf-8")
      const contextual = input.output.content.length === 0 ? encoded : text.map((item) => item.text).join("")
      const contextualBytes = input.output.content.length === 0 ? encodedBytes : Buffer.byteLength(contextual, "utf-8")
      const structuredOverflow = encodedBytes > MAX_STRUCTURED_BYTES
      const contentOverflow = contextualBytes > outputLimits.maxBytes || lineCount(contextual) > outputLimits.maxLines
      if (!structuredOverflow && !contentOverflow)
        return {
          output: { ...input.output, structured },
          outputPaths: [],
        }

      yield* fs.ensureDir(directory).pipe(Effect.mapError((cause) => new StorageError({ operation: "write", cause })))
      const structuredPath = structuredOverflow ? yield* write(encoded) : undefined
      const contextualPath = contentOverflow
        ? input.output.content.length === 0 && structuredPath
          ? structuredPath
          : yield* write(contextual).pipe(
              Effect.onError(() =>
                structuredPath ? fs.remove(structuredPath).pipe(Effect.catch(() => Effect.void)) : Effect.void,
              ),
            )
        : undefined

      return {
        output: {
          structured: structuredPath
            ? { _truncated: true, _bytes: encodedBytes, _outputPath: structuredPath }
            : contentOverflow &&
                input.propagateTruncation === true &&
                Predicate.isObject(structured) &&
                "truncated" in structured &&
                typeof structured.truncated === "boolean"
              ? { ...structured, truncated: true }
              : structured,
          content: contentOverflow
            ? [
                {
                  type: "text" as const,
                  text: boundedPreview(
                    contextual,
                    `... output truncated; full content saved to ${contextualPath} ...`,
                    outputLimits.maxLines,
                    outputLimits.maxBytes,
                  ),
                },
                ...media,
              ]
            : input.output.content.length === 0 && structuredPath
              ? [{ type: "text" as const, text: contextual }]
              : input.output.content,
        },
        outputPaths: [...new Set([structuredPath, contextualPath].filter((value) => value !== undefined))],
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

export const node = makeLocationNode({ service: Service, layer, deps: [FSUtil.node, Global.node, Config.node] })

export const nodeWithoutConfig = makeLocationNode({ service: Service, layer, deps: [FSUtil.node, Global.node] })

/** Runs retention scanning once globally rather than once per active Location. */
export const cleanupLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* Service
    yield* store.cleanup().pipe(Effect.repeat(Schedule.spaced(Duration.hours(1))), Effect.forkScoped)
  }),
)

export const cleanupNode = makeGlobalNode({
  name: "tool-output-cleanup",
  layer: Layer.merge(layer, cleanupLayer.pipe(Layer.provide(layer))),
  deps: [FSUtil.node, Global.node],
})
