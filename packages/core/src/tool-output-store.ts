export * as ToolOutputStore from "./tool-output-store"

import path from "path"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { Config } from "./config"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { NonNegativeInt, PositiveInt } from "./schema"
import { SessionSchema } from "./session/schema"
import { Identifier } from "./util/identifier"

export const MAX_LINES = 2_000
export const MAX_BYTES = 50 * 1024
export const MAX_READ_BYTES = 50 * 1024
export const RETENTION = Duration.days(7)

const URI_PREFIX = "tool-output://"
const MANAGED_DIRECTORY = path.join("tool-output", "managed")
const ID_PATTERN = /^[0-9a-f]{12}[0-9A-Za-z]{14}$/

export class Resource extends Schema.Class<Resource>("ToolOutputStore.Resource")({
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.String.pipe(Schema.optional),
  size: NonNegativeInt,
}) {}

export class Page extends Schema.Class<Page>("ToolOutputStore.Page")({
  resource: Resource,
  content: Schema.String,
  offset: NonNegativeInt,
  truncated: Schema.Boolean,
  next: NonNegativeInt.pipe(Schema.optional),
}) {}

export class AccessDeniedError extends Schema.TaggedErrorClass<AccessDeniedError>()(
  "ToolOutputStore.AccessDeniedError",
  {
    uri: Schema.String,
    sessionID: SessionSchema.ID,
  },
) {}

export class InvalidResourceError extends Schema.TaggedErrorClass<InvalidResourceError>()(
  "ToolOutputStore.InvalidResourceError",
  {
    uri: Schema.String,
  },
) {}

export class ResourceNotFoundError extends Schema.TaggedErrorClass<ResourceNotFoundError>()(
  "ToolOutputStore.ResourceNotFoundError",
  { uri: Schema.String },
) {}

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

export interface ReadInput {
  readonly sessionID: SessionSchema.ID
  readonly uri: string
  /** Zero-based byte offset. Returned `next` values preserve UTF-8 boundaries. */
  readonly offset?: number
  readonly limit?: number
}

export type TruncateResult =
  | { readonly content: string; readonly truncated: false }
  | { readonly content: string; readonly truncated: true; readonly resource: Resource }

interface Record {
  readonly version: 1
  readonly id: string
  readonly uri: string
  readonly sessionID: string
  readonly toolCallID: string
  readonly mime: string
  readonly name?: string
  readonly size: number
  readonly created: number
}

export interface Interface {
  readonly limits: () => Effect.Effect<{ readonly maxLines: number; readonly maxBytes: number }>
  readonly write: (input: WriteInput) => Effect.Effect<Resource>
  readonly truncate: (input: TruncateInput) => Effect.Effect<TruncateResult>
  readonly read: (
    input: ReadInput,
  ) => Effect.Effect<Page, AccessDeniedError | InvalidResourceError | ResourceNotFoundError>
  readonly cleanup: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ToolOutputStore") {}

const uri = (id: string) => URI_PREFIX + id

const idFromUri = (input: string) => {
  if (!input.startsWith(URI_PREFIX)) return
  const id = input.slice(URI_PREFIX.length)
  if (!ID_PATTERN.test(id)) return
  return id
}

const validRecord = (input: unknown, id: string): input is Record => {
  if (!input || typeof input !== "object") return false
  const record = input as Partial<Record>
  return (
    record.version === 1 &&
    record.id === id &&
    record.uri === uri(id) &&
    typeof record.sessionID === "string" &&
    typeof record.toolCallID === "string" &&
    typeof record.mime === "string" &&
    (record.name === undefined || typeof record.name === "string") &&
    typeof record.size === "number" &&
    Number.isSafeInteger(record.size) &&
    record.size >= 0 &&
    typeof record.created === "number" &&
    Number.isFinite(record.created)
  )
}

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

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const config = yield* Effect.serviceOption(Config.Service)
    const directory = path.join(global.data, MANAGED_DIRECTORY)
    const metadataPath = (id: string) => path.join(directory, `${id}.json`)
    const contentPath = (id: string) => path.join(directory, `${id}.txt`)

    const load = Effect.fn("ToolOutputStore.load")(function* (resourceUri: string) {
      const id = idFromUri(resourceUri)
      if (!id) return yield* Effect.fail(new InvalidResourceError({ uri: resourceUri }))
      const text = yield* fs.readFileStringSafe(metadataPath(id)).pipe(Effect.orDie)
      if (!text) return yield* Effect.fail(new ResourceNotFoundError({ uri: resourceUri }))
      const record = yield* Effect.sync(() => JSON.parse(text)).pipe(Effect.catch(() => Effect.void))
      if (!validRecord(record, id)) return yield* Effect.fail(new ResourceNotFoundError({ uri: resourceUri }))
      const info = yield* fs.stat(contentPath(id)).pipe(Effect.catch(() => Effect.void))
      if (!info || info.type !== "File" || Number(info.size) !== record.size)
        return yield* Effect.fail(new ResourceNotFoundError({ uri: resourceUri }))
      return record
    })

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
      const id = Identifier.ascending()
      const resourceUri = uri(id)
      const size = Buffer.byteLength(input.content, "utf-8")
      const record: Record = {
        version: 1,
        id,
        uri: resourceUri,
        sessionID: input.sessionID,
        toolCallID: input.toolCallID,
        mime: input.mime ?? "text/plain",
        ...(input.name === undefined ? {} : { name: input.name }),
        size,
        created: Date.now(),
      }
      yield* fs.ensureDir(directory).pipe(Effect.orDie)
      yield* fs.writeFileString(contentPath(id), input.content, { flag: "wx" }).pipe(Effect.orDie)
      yield* fs.writeFileString(metadataPath(id), JSON.stringify(record), { flag: "wx" }).pipe(
        Effect.onError(() => fs.remove(contentPath(id)).pipe(Effect.catch(() => Effect.void))),
        Effect.orDie,
      )
      return new Resource({
        uri: resourceUri,
        mime: record.mime,
        ...(record.name === undefined ? {} : { name: record.name }),
        size,
      })
    })

    const truncate = Effect.fn("ToolOutputStore.truncate")(function* (input: TruncateInput) {
      const configured = yield* limits()
      const maxLines = input.maxLines ?? configured.maxLines
      const maxBytes = input.maxBytes ?? configured.maxBytes
      if (input.content.split("\n").length <= maxLines && Buffer.byteLength(input.content, "utf-8") <= maxBytes) {
        return { content: input.content, truncated: false } as const
      }
      const resource = yield* write(input)
      const bounded = preview(input.content, maxLines, maxBytes)
      const marker = `... output truncated; full content available as ${resource.uri} ...`
      return {
        content: bounded.tail ? `${bounded.head}\n\n${marker}\n\n${bounded.tail}` : `${bounded.head}\n\n${marker}`,
        truncated: true,
        resource,
      } as const
    })

    const read = Effect.fn("ToolOutputStore.read")(function* (input: ReadInput) {
      const record = yield* load(input.uri)
      if (record.sessionID !== input.sessionID) {
        return yield* Effect.fail(new AccessDeniedError({ uri: input.uri, sessionID: input.sessionID }))
      }
      const offset = Math.max(0, Math.min(input.offset ?? 0, record.size))
      const limit = Math.max(1, Math.min(input.limit ?? MAX_READ_BYTES, MAX_READ_BYTES))
      const bytes = yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fs.open(contentPath(record.id), { flag: "r" }).pipe(Effect.orDie)
          yield* file.seek(offset, "start")
          const chunk = yield* file.readAlloc(Math.min(limit + 3, record.size - offset)).pipe(Effect.orDie)
          return Option.getOrElse(chunk, () => new Uint8Array())
        }),
      )
      let start = 0
      while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++
      let end = Math.min(start + limit, bytes.length)
      while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
      if (end === start && end < bytes.length) {
        end = Math.min(start + limit, bytes.length)
        while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end++
      }
      const absoluteStart = offset + start
      const absoluteEnd = offset + end
      const truncated = absoluteEnd < record.size
      return new Page({
        resource: new Resource({
          uri: record.uri,
          mime: record.mime,
          ...(record.name === undefined ? {} : { name: record.name }),
          size: record.size,
        }),
        content: Buffer.from(bytes.subarray(start, end)).toString("utf-8"),
        offset: absoluteStart,
        truncated,
        ...(truncated ? { next: absoluteEnd } : {}),
      })
    })

    const cleanup = Effect.fn("ToolOutputStore.cleanup")(function* () {
      const entries = yield* fs.readDirectory(directory).pipe(Effect.catch(() => Effect.succeed([])))
      const cutoff = Date.now() - Duration.toMillis(RETENTION)
      const ids = new Set(
        entries.flatMap((entry) => {
          const match = entry.match(/^([0-9a-f]{12}[0-9A-Za-z]{14})\.(?:json|txt)$/)
          return match ? [match[1]] : []
        }),
      )
      const removeIfPresent = (target: string) =>
        fs.existsSafe(target).pipe(Effect.flatMap((exists) => (exists ? fs.remove(target) : Effect.void)))
      const removePair = (id: string) =>
        Effect.gen(function* () {
          yield* removeIfPresent(contentPath(id))
          yield* removeIfPresent(metadataPath(id))
        }).pipe(Effect.catch(() => Effect.void))
      for (const id of ids) {
        const text = yield* fs.readFileStringSafe(metadataPath(id)).pipe(Effect.catch(() => Effect.succeed(undefined)))
        const contentExists = yield* fs.existsSafe(contentPath(id))
        if (!text) {
          if (!contentExists) continue
          const info = yield* fs.stat(contentPath(id)).pipe(Effect.catch(() => Effect.void))
          const modified = info
            ? info.mtime.pipe(
                Option.map((date) => date.getTime()),
                Option.getOrElse(() => 0),
              )
            : 0
          if (modified < cutoff) yield* removePair(id)
          continue
        }
        const record = yield* Effect.try({
          try: () => JSON.parse(text),
          catch: () => new globalThis.Error("Invalid metadata"),
        }).pipe(Effect.catch(() => Effect.succeed(undefined)))
        const info = contentExists ? yield* fs.stat(contentPath(id)).pipe(Effect.catch(() => Effect.void)) : undefined
        if (
          !contentExists ||
          !validRecord(record, id) ||
          !info ||
          info.type !== "File" ||
          Number(info.size) !== record.size ||
          record.created < cutoff
        )
          yield* removePair(id)
      }
    })

    return Service.of({ limits, write, truncate, read, cleanup })
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
