export * as ReadToolFileSystem from "./read-filesystem.js"

import path from "path"
import { pathToFileURL } from "url"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { lookup } from "mime-types"
import { Environment } from "../environment/index.js"
import type { Files } from "../environment/index.js"
import { FileSystem } from "../filesystem.js"
import { Mime } from "../mime.js"
import { AbsolutePath, NonNegativeInt, PositiveInt, RelativePath } from "../schema.js"

export const MAX_READ_LINES = 2_000
export const MAX_READ_BYTES = 50 * 1024
export const MAX_MEDIA_INGEST_BYTES = 20 * 1024 * 1024
const FIRST_CHUNK = 256 * 1024
const TAIL_LINES = 100
const MAX_LINE_LENGTH = 2_000
// Enough UTF-8 bytes for the clamped prefix, including a BOM and a partial code point at the end.
const LINE_BYTES = 4 * (MAX_LINE_LENGTH + 1)
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
export const MEDIA_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"])

export class BinaryFileError extends Schema.TaggedError<BinaryFileError>()("ReadTool.BinaryFileError", {
  resource: Schema.String,
}) {
  override get message() {
    return `Cannot read binary file: ${this.resource}`
  }
}

export class MediaIngestLimitError extends Schema.TaggedError<MediaIngestLimitError>()(
  "ReadTool.MediaIngestLimitError",
  {
    resource: Schema.String,
    maximumBytes: Schema.Number,
  },
) {
  override get message() {
    return `Media exceeds ${this.maximumBytes} byte ingestion limit: ${this.resource}`
  }
}

export class PathKindError extends Schema.TaggedError<PathKindError>()("ReadTool.PathKindError", {
  resource: Schema.String,
  expected: Schema.Literals(["a file", "a file or directory"]),
}) {
  override get message() {
    return `Path is not ${this.expected}: ${this.resource}`
  }
}

export class DirectoryOffsetError extends Schema.TaggedError<DirectoryOffsetError>()("ReadTool.DirectoryOffsetError", {
  resource: Schema.String,
}) {
  override get message() {
    return `A negative offset only works for files, and ${this.resource} is a directory`
  }
}

export type ReadError =
  | Environment.NotFound
  | Environment.Failed
  | BinaryFileError
  | MediaIngestLimitError
  | PathKindError
  | DirectoryOffsetError

export const PageInput = Schema.Struct({
  offset: Schema.optionalKey(Schema.Int),
  limit: Schema.optionalKey(NonNegativeInt),
})
export type PageInput = typeof PageInput.Type

export const FileContent = Schema.Struct({
  type: Schema.Literal("file"),
  ...FileSystem.Content.fields,
}).annotate({ identifier: "ReadTool.FileContent" })
export type FileContent = typeof FileContent.Type

export class TextPage extends Schema.Class<TextPage>("ReadTool.TextPage")({
  type: Schema.Literal("text-page"),
  content: Schema.String,
  lineCount: NonNegativeInt,
  mime: Schema.String,
  offset: PositiveInt,
  truncated: Schema.Boolean,
  next: Schema.optionalKey(PositiveInt),
}) {}

export interface ListEntry extends Schema.Schema.Type<typeof ListEntry> {}
export const ListEntry = Schema.Struct({
  path: RelativePath,
  type: Schema.Literals(["file", "directory", "symlink"]),
}).annotate({ identifier: "ReadTool.ListEntry" })

export class ListPage extends Schema.Class<ListPage>("ReadTool.ListPage")({
  type: Schema.Literal("list-page"),
  entries: Schema.Array(ListEntry),
  truncated: Schema.Boolean,
  next: Schema.optionalKey(PositiveInt),
}) {}

export interface Interface {
  readonly list: (path: AbsolutePath) => ReturnType<Files["list"]>
  readonly read: (
    path: AbsolutePath,
    resource: string,
    page?: PageInput,
  ) => Effect.Effect<FileContent | TextPage | ListPage, ReadError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ReadToolFileSystem") {}

const mimeType = (value: string) => lookup(value) || "application/octet-stream"

export const read = Effect.fn("ReadTool.read")(function* (
  files: Files,
  input: AbsolutePath,
  resource: string,
  page: PageInput = {},
) {
  const virtual = resource.startsWith("skill://")
  const first = yield* files.read(input, { offset: 0, length: FIRST_CHUNK }).pipe(
    Effect.catchTag("Environment.WrongKind", (error) =>
      Effect.gen(function* () {
        if (error.actual !== "directory") return yield* new PathKindError({ resource, expected: "a file or directory" })
        if (page.offset !== undefined && page.offset < 0) return yield* new DirectoryOffsetError({ resource })
        return yield* files.list(input).pipe(
          Effect.map((entries) => list(entries, page, virtual ? "/" : path.sep)),
          Effect.catchTag("Environment.WrongKind", () =>
            Effect.fail(new PathKindError({ resource, expected: "a file or directory" })),
          ),
        )
      }),
    ),
  )
  if (first instanceof ListPage) return first

  const media = Mime.detectMedia(first.bytes)
  if (media && MEDIA_MIMES.has(media)) {
    if (first.info.size > MAX_MEDIA_INGEST_BYTES)
      return yield* new MediaIngestLimitError({ resource, maximumBytes: MAX_MEDIA_INGEST_BYTES })
    const whole = yield* readFile(files, input, resource)
    return {
      type: "file" as const,
      uri: virtual ? resource : pathToFileURL(input).href,
      name: virtual ? path.posix.basename(input) : path.basename(input),
      content: Buffer.from(whole.bytes).toString("base64"),
      encoding: "base64" as const,
      mime: media,
    }
  }

  const paged = first.info.size > MAX_READ_BYTES || page.offset !== undefined || page.limit !== undefined
  if (!paged) {
    if (first.bytes.includes(0)) return yield* new BinaryFileError({ resource })
    const lines = new TextDecoder().decode(first.bytes).split("\n")
    // A final separator ends the last physical line; keep it in whole-file content.
    const count = lines.at(-1) === "" ? lines.length - 1 : lines.length
    if (count <= MAX_READ_LINES) {
      const content = lines.map(clampLine).join("\n")
      if (Buffer.byteLength(content) <= MAX_READ_BYTES)
        return {
          type: "file" as const,
          uri: virtual ? resource : pathToFileURL(input).href,
          name: virtual ? path.posix.basename(input) : path.basename(input),
          content,
          encoding: "utf8" as const,
          mime: mimeType(input),
        }
    }
  }

  return yield* textPage(files, input, resource, first, page)
})

const readFile = (
  files: Files,
  input: AbsolutePath,
  resource: string,
  range?: { readonly offset: number; readonly length: number },
) =>
  files
    .read(input, range)
    .pipe(
      Effect.catchTag("Environment.WrongKind", () => Effect.fail(new PathKindError({ resource, expected: "a file" }))),
    )

// The first line ending in a chunk may have started many chunks earlier.
type Checkpoint = { byte: number; length: number; firstLine: number; start: number; lastLine: number }

const textPage = Effect.fnUntraced(function* (
  files: Files,
  input: AbsolutePath,
  resource: string,
  first: { bytes: Uint8Array; info: { size: number } },
  page: PageInput,
) {
  const requested = page.offset || 1
  const limit = Math.min(page.limit || MAX_READ_LINES, MAX_READ_LINES)
  const checkpoints: Checkpoint[] = []
  const entries: string[] = []
  let size = 0
  let from = requested
  let tail = false
  let consumed = 0
  let next: number | undefined
  let firstNul = Infinity
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true })

  const range = (offset: number, length: number) => readFile(files, input, resource, { offset, length })
  const reread = Effect.fnUntraced(function* (offset: number, length: number) {
    const { bytes } = yield* range(offset, length)
    if (bytes.length === length) return bytes
    const result = new Uint8Array(length)
    result.set(bytes)
    let filled = bytes.length
    while (filled < length) {
      const more = yield* range(offset + filled, length - filled)
      if (more.bytes.length === 0) break
      result.set(more.bytes, filled)
      filled += more.bytes.length
    }
    return result.subarray(0, filled)
  })

  // Select complete lines in this chunk. Only a split line's displayable prefix ever needs a separate read.
  const collect = Effect.fnUntraced(function* (point: Checkpoint, chunk: Uint8Array) {
    let start = point.start
    let local = Math.max(0, start - point.byte)
    for (let line = point.firstLine; line < from && local < chunk.length; local++) {
      if (chunk[local] !== 10) continue
      line++
      start = point.byte + local + 1
    }
    for (let line = Math.max(point.firstLine, from); line <= point.lastLine; line++) {
      if (!tail && (entries.length >= limit || size >= MAX_READ_BYTES)) {
        next = line
        return
      }
      const lf = chunk.indexOf(10, local)
      const end = point.byte + (lf < 0 ? chunk.length : lf)
      const length = Math.min(LINE_BYTES, end - start)
      const bytes =
        start >= point.byte
          ? chunk.subarray(start - point.byte, start - point.byte + length)
          : start + length <= first.bytes.length
            ? first.bytes.subarray(start, start + length)
            : yield* reread(start, length)
      let text = decoder.decode(bytes)
      // Single-chunk pages decode from byte zero. Streamed pages decode from the selected line,
      // except a past-end tail, whose embedded BOM remains content.
      if (
        text.startsWith("\uFEFF") &&
        (start === 0 || (!tail && line === from && first.bytes.length < first.info.size))
      )
        text = text.slice(1)
      text = clampLine(text.endsWith("\r") ? text.slice(0, -1) : text)
      const cost = Buffer.byteLength(text) + (entries.length > 0 ? 1 : 0)
      if (!tail && size + cost > MAX_READ_BYTES) {
        next = line
        return
      }
      entries.push(text)
      size += cost
      consumed = end + Number(lf >= 0)
      local = lf + 1
      start = end + 1
    }
  })

  let byte = 0
  let total = 0
  let start = 0
  let chunk = first.bytes
  let lastByte = 0
  while (chunk.length > 0) {
    lastByte = byte
    if (firstNul === Infinity) {
      const nul = chunk.indexOf(0)
      if (nul >= 0) firstNul = byte + nul
    }
    let count = 0
    for (let i = 0; i < chunk.length; i++) count += Number(chunk[i] === 10)
    if (count > 0) {
      const point = { byte, length: chunk.length, firstLine: total + 1, start, lastLine: total + count }
      checkpoints.push(point)
      total += count
      if (requested > 0 && total >= requested) yield* collect(point, chunk)
      start = byte + chunk.lastIndexOf(10) + 1
    }
    byte += chunk.length
    // Any byte after a full page starts another line, even if that line has no newline for megabytes.
    if (next === undefined && (entries.length >= limit || size >= MAX_READ_BYTES) && consumed < byte)
      next = requested + entries.length
    if (next !== undefined || byte >= first.info.size) break
    const more = yield* range(byte, FIRST_CHUNK)
    if (more.bytes.length === 0) break
    chunk = more.bytes
  }

  // EOF ends an unterminated line. A trailing newline already ended the last one.
  if (next === undefined && start < byte) {
    total++
    const point = { byte: lastByte, length: chunk.length, firstLine: total, start, lastLine: total }
    checkpoints.push(point)
    if (requested > 0 && total >= requested) yield* collect(point, chunk)
  }
  if (requested < 0 || requested > total) {
    tail = requested > total
    from = Math.max(1, total + 1 + (tail ? -Math.min(page.limit || TAIL_LINES, TAIL_LINES) : requested))
    // Each checkpoint covers disjoint line numbers. Seek to the chunk ending the first selected line;
    // chunks in the middle of a long line have no checkpoint and are never reread.
    for (const point of checkpoints) {
      if (point.lastLine < from) continue
      const bytes =
        point.byte === 0 ? first.bytes : point.byte === lastByte ? chunk : yield* reread(point.byte, point.length)
      yield* collect(point, bytes)
      if (next !== undefined) break
    }
    if (tail) {
      while (size > MAX_READ_BYTES) {
        size -= Buffer.byteLength(entries.shift() ?? "") + 1
        from++
      }
      consumed = byte
    }
  }

  if (firstNul < consumed) return yield* new BinaryFileError({ resource })
  return new TextPage({
    type: "text-page",
    content: entries.join("\n"),
    lineCount: entries.length,
    mime: mimeType(input),
    offset: from,
    truncated: next !== undefined,
    ...(next === undefined ? {} : { next }),
  })
})

const list = (items: ReadonlyArray<Environment.DirEntry>, page: PageInput, sep = path.sep) => {
  const offset = page.offset || 1
  const limit = Math.min(page.limit || MAX_READ_LINES, MAX_READ_LINES)
  const visible = items
    .flatMap((item) =>
      item.type === "other"
        ? []
        : [
            ListEntry.make({
              path: RelativePath.make(item.name + (item.type === "directory" ? sep : "")),
              type: item.type,
            }),
          ],
    )
    .sort((a, b) =>
      a.type === "directory"
        ? b.type === "directory"
          ? a.path.localeCompare(b.path)
          : -1
        : b.type === "directory"
          ? 1
          : a.path.localeCompare(b.path),
    )
  const selected = visible.slice(offset - 1, offset - 1 + limit)
  const truncated = offset - 1 + selected.length < visible.length
  return new ListPage({
    type: "list-page",
    entries: selected,
    truncated,
    ...(truncated ? { next: offset + selected.length } : {}),
  })
}

const clampLine = (line: string) => {
  if (line.length <= MAX_LINE_LENGTH) return line
  const code = line.charCodeAt(MAX_LINE_LENGTH - 1)
  const end = code >= 0xd800 && code <= 0xdbff ? MAX_LINE_LENGTH - 1 : MAX_LINE_LENGTH
  return line.slice(0, end) + MAX_LINE_SUFFIX
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    return Service.of({
      list: environment.files.list,
      read: (path, resource, page) => read(environment.files, path, resource, page),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Environment.node] })
