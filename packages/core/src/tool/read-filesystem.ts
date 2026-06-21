export * as ReadToolFileSystem from "./read-filesystem"

import path from "path"
import { pathToFileURL } from "url"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { AbsolutePath, PositiveInt, RelativePath } from "../schema"

export const MAX_READ_LINES = 2_000
export const MAX_READ_BYTES = 50 * 1024
export const MAX_MEDIA_INGEST_BYTES = 20 * 1024 * 1024
const MAX_LINE_LENGTH = 2_000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`

export class BinaryFileError extends Error {
  constructor(readonly resource: string) {
    super(`Cannot read binary file: ${resource}`)
    this.name = "BinaryFileError"
  }
}

export class MediaIngestLimitError extends Error {
  constructor(
    readonly resource: string,
    readonly maximumBytes: number,
  ) {
    super(`Media exceeds ${maximumBytes} byte ingestion limit: ${resource}`)
    this.name = "MediaIngestLimitError"
  }
}

export class MalformedUtf8Error extends Error {
  constructor(readonly resource: string) {
    super(`File is not valid UTF-8: ${resource}`)
    this.name = "MalformedUtf8Error"
  }
}

export class OffsetOutOfRangeError extends Error {
  constructor(readonly offset: number) {
    super(`Offset ${offset} is out of range`)
    this.name = "OffsetOutOfRangeError"
  }
}

export class PathKindError extends Error {
  constructor(
    readonly resource: string,
    readonly expected: "a file" | "a directory" | "a file or directory",
  ) {
    super(`Path is not ${expected}: ${resource}`)
    this.name = "PathKindError"
  }
}

export type InspectError = FSUtil.Error | PathKindError
export type ReadError =
  | FSUtil.Error
  | BinaryFileError
  | MediaIngestLimitError
  | MalformedUtf8Error
  | OffsetOutOfRangeError
  | PathKindError

export const PageInput = Schema.Struct({
  offset: PositiveInt.pipe(Schema.optional),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_READ_LINES)).pipe(Schema.optional),
})
export type PageInput = typeof PageInput.Type

export class TextPage extends Schema.Class<TextPage>("ReadTool.TextPage")({
  type: Schema.Literal("text-page"),
  content: Schema.String,
  mime: Schema.String,
  offset: PositiveInt,
  truncated: Schema.Boolean,
  next: PositiveInt.pipe(Schema.optional),
}) {}

export class ListPage extends Schema.Class<ListPage>("ReadTool.ListPage")({
  entries: Schema.Array(FileSystem.Entry),
  truncated: Schema.Boolean,
  next: PositiveInt.pipe(Schema.optional),
}) {}

export interface Interface {
  readonly inspect: (path: AbsolutePath) => Effect.Effect<"file" | "directory", InspectError>
  readonly read: (
    path: AbsolutePath,
    resource: string,
    page?: PageInput,
  ) => Effect.Effect<FileSystem.Content | TextPage, ReadError>
  readonly list: (path: AbsolutePath, page?: PageInput) => Effect.Effect<ListPage, FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ReadToolFileSystem") {}

const extensions = new Set([
  ".zip",
  ".tar",
  ".gz",
  ".exe",
  ".dll",
  ".so",
  ".class",
  ".jar",
  ".war",
  ".7z",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".bin",
  ".dat",
  ".obj",
  ".o",
  ".a",
  ".lib",
  ".wasm",
  ".pyc",
  ".pyo",
])
const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((value, index) => bytes[index] === value)
const imageMime = (bytes: Uint8Array) => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]))
    return "image/webp"
}
const binary = (resource: string, bytes: Uint8Array) => {
  if (extensions.has(path.extname(resource).toLowerCase())) return true
  if (bytes.length === 0) return false
  let nonPrintable = 0
  for (const byte of bytes) {
    if (byte === 0) return true
    if (byte < 9 || (byte > 13 && byte < 32)) nonPrintable++
  }
  return nonPrintable / bytes.length > 0.3
}
const decodeUtf8 = (resource: string, decoder: TextDecoder, bytes?: Uint8Array, stream = false) =>
  Effect.sync(() => decoder.decode(bytes, stream ? { stream: true } : undefined)).pipe(
    Effect.catchDefect((error) =>
      error instanceof TypeError ? Effect.fail(new MalformedUtf8Error(resource)) : Effect.die(error),
    ),
  )

export const inspect = Effect.fn("ReadTool.inspect")(function* (fs: FSUtil.Interface, input: string) {
  const info = yield* fs.stat(input)
  const type = info.type === "File" ? "file" : info.type === "Directory" ? "directory" : undefined
  if (!type) return yield* Effect.fail(new PathKindError(input, "a file or directory"))
  return type
})

export const read = Effect.fn("ReadTool.read")(function* (
  fs: FSUtil.Interface,
  input: string,
  resource: string,
  page: PageInput = {},
) {
  const real = yield* fs.realPath(input)
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const file = yield* fs.open(real, { flag: "r" })
      const info = yield* file.stat
      if (info.type !== "File") return yield* Effect.fail(new PathKindError(resource, "a file"))
      const first = Option.getOrElse(
        yield* file.readAlloc(Math.min(64 * 1024, Number(info.size) || 4 * 1024)),
        () => new Uint8Array(),
      )
      const mime = imageMime(first)
      if (mime) {
        if (info.size > MAX_MEDIA_INGEST_BYTES)
          return yield* Effect.fail(new MediaIngestLimitError(resource, MAX_MEDIA_INGEST_BYTES))
        const chunks = [first]
        let total = first.length
        while (total <= MAX_MEDIA_INGEST_BYTES) {
          const chunk = yield* file.readAlloc(Math.min(64 * 1024, MAX_MEDIA_INGEST_BYTES + 1 - total))
          if (Option.isNone(chunk)) break
          chunks.push(chunk.value)
          total += chunk.value.length
        }
        if (total > MAX_MEDIA_INGEST_BYTES)
          return yield* Effect.fail(new MediaIngestLimitError(resource, MAX_MEDIA_INGEST_BYTES))
        return {
          uri: pathToFileURL(real).href,
          name: path.basename(real),
          content: Buffer.concat(
            chunks.map((chunk) => Buffer.from(chunk)),
            total,
          ).toString("base64"),
          encoding: "base64" as const,
          mime,
        }
      }
      if (startsWith(first, [0x25, 0x50, 0x44, 0x46]) || binary(resource, first))
        return yield* Effect.fail(new BinaryFileError(resource))
      const paged = info.size > MAX_READ_BYTES || page.offset !== undefined || page.limit !== undefined
      if (!paged) {
        const decoder = new TextDecoder("utf-8", { fatal: true })
        const text = [yield* decodeUtf8(resource, decoder, first, true)]
        while (true) {
          const chunk = yield* file.readAlloc(64 * 1024)
          if (Option.isNone(chunk)) break
          if (chunk.value.includes(0)) return yield* Effect.fail(new BinaryFileError(resource))
          text.push(yield* decodeUtf8(resource, decoder, chunk.value, true))
        }
        text.push(yield* decodeUtf8(resource, decoder))
        return {
          uri: pathToFileURL(real).href,
          name: path.basename(real),
          content: text.join(""),
          encoding: "utf8" as const,
          mime: FSUtil.mimeType(real),
        }
      }
      const offset = page.offset ?? 1
      const limit = Math.min(page.limit ?? MAX_READ_LINES, MAX_READ_LINES)
      const lines: string[] = []
      const decoder = new TextDecoder("utf-8", { fatal: true })
      let pending = ""
      let discard = false
      let line = 1
      let bytes = 0
      let found = false
      let truncated = false
      let next: number | undefined
      const append = (input: string) => {
        if (line < offset) {
          line++
          return
        }
        if (lines.length >= limit || bytes >= MAX_READ_BYTES) {
          truncated = true
          next ??= line++
          return
        }
        found = true
        const text = input.length > MAX_LINE_LENGTH ? input.slice(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : input
        const size = Buffer.byteLength(text, "utf-8") + (lines.length > 0 ? 1 : 0)
        if (bytes + size > MAX_READ_BYTES) {
          truncated = true
          next ??= line++
          return
        }
        lines.push(text)
        bytes += size
        line++
      }
      const consume = (input: string) => {
        let text = input
        while (true) {
          const index = text.indexOf("\n")
          if (index === -1) {
            if (!discard) {
              pending += text
              if (pending.length > MAX_LINE_LENGTH) {
                pending = pending.slice(0, MAX_LINE_LENGTH + 1)
                discard = true
              }
            }
            break
          }
          const current = pending + (discard ? "" : text.slice(0, index))
          pending = ""
          discard = false
          text = text.slice(index + 1)
          append(current.endsWith("\r") ? current.slice(0, -1) : current)
        }
      }
      if (first.includes(0)) return yield* Effect.fail(new BinaryFileError(resource))
      consume(yield* decodeUtf8(resource, decoder, first, true))
      while (true) {
        const chunk = yield* file.readAlloc(64 * 1024)
        if (Option.isNone(chunk)) break
        if (chunk.value.includes(0)) return yield* Effect.fail(new BinaryFileError(resource))
        consume(yield* decodeUtf8(resource, decoder, chunk.value, true))
      }
      const tail = yield* decodeUtf8(resource, decoder)
      if (!discard) pending += tail
      if (pending) append(pending.endsWith("\r") ? pending.slice(0, -1) : pending)
      if (!found && offset !== 1) return yield* Effect.fail(new OffsetOutOfRangeError(offset))
      return new TextPage({
        type: "text-page",
        content: lines.join("\n"),
        mime: FSUtil.mimeType(real),
        offset,
        truncated,
        ...(next === undefined ? {} : { next }),
      })
    }),
  )
})

export const list = Effect.fn("ReadTool.list")(function* (fs: FSUtil.Interface, input: string, page: PageInput = {}) {
  const real = yield* fs.realPath(input)
  const items = yield* fs.readDirectoryEntries(real)
  const offset = page.offset ?? 1
  const limit = Math.min(page.limit ?? MAX_READ_LINES, MAX_READ_LINES)
  const entries = yield* Effect.forEach(
    items,
    (item) =>
      Effect.gen(function* () {
        const absolute = path.join(real, item.name)
        const target = yield* fs.realPath(absolute).pipe(Effect.catch(() => Effect.void))
        if (!target || !FSUtil.contains(real, target)) return
        const info = yield* fs.stat(target).pipe(Effect.catch(() => Effect.void))
        const type = info?.type === "Directory" ? "directory" : info?.type === "File" ? "file" : undefined
        if (!type) return
        return new FileSystem.Entry({
          path: RelativePath.make(item.name + (type === "directory" ? path.sep : "")),
          type,
          mime: type === "directory" ? "application/x-directory" : FSUtil.mimeType(target),
        })
      }),
    { concurrency: 16 },
  )
  const visible = entries
    .filter((item): item is FileSystem.Entry => item !== undefined)
    .sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1))
  const selected = visible.slice(offset - 1, offset - 1 + limit)
  const truncated = offset - 1 + selected.length < visible.length
  return new ListPage({ entries: selected, truncated, ...(truncated ? { next: offset + selected.length } : {}) })
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    return Service.of({
      inspect: (path) => inspect(fs, path),
      read: (path, resource, page) => read(fs, path, resource, page),
      list: (path, page) => list(fs, path, page),
    })
  }),
)
