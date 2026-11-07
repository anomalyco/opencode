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
const MAX_LINE_LENGTH = 2_000
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

export class OffsetOutOfRangeError extends Schema.TaggedError<OffsetOutOfRangeError>()(
  "ReadTool.OffsetOutOfRangeError",
  { offset: Schema.Number, lines: Schema.Number },
) {
  override get message() {
    return `Offset ${this.offset} is out of range for this file (${this.lines} ${this.lines === 1 ? "line" : "lines"})`
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

export type ReadError =
  | Environment.NotFound
  | Environment.Failed
  | BinaryFileError
  | MediaIngestLimitError
  | OffsetOutOfRangeError
  | PathKindError

export const PageInput = Schema.Struct({
  offset: Schema.optionalKey(NonNegativeInt),
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
    Effect.catchTag("Environment.WrongKind", (error) => {
      if (error.actual !== "directory")
        return Effect.fail(new PathKindError({ resource, expected: "a file or directory" }))
      return files.list(input).pipe(
        Effect.map((entries) => list(entries, page, virtual ? "/" : path.sep)),
        Effect.catchTag("Environment.WrongKind", () =>
          Effect.fail(new PathKindError({ resource, expected: "a file or directory" })),
        ),
      )
    }),
  )
  if (first instanceof ListPage) return first

  const media = Mime.detect(first.bytes)
  if (MEDIA_MIMES.has(media)) {
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
    return {
      type: "file" as const,
      uri: virtual ? resource : pathToFileURL(input).href,
      name: virtual ? path.posix.basename(input) : path.basename(input),
      content: new TextDecoder().decode(first.bytes).split("\n").map(clampLine).join("\n"),
      encoding: "utf8" as const,
      mime: mimeType(input),
    }
  }

  const offset = page.offset || 1
  const limit = Math.min(page.limit || MAX_READ_LINES, MAX_READ_LINES)
  // The old multi-chunk path decoded from the selected line, not from the start of the file.
  const stripBOMLine = first.bytes.length >= first.info.size ? 1 : offset
  const entries: string[] = []
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true })
  const prefix = new Uint8Array(MAX_LINE_LENGTH * 4)
  let prefixLength = 0
  let lineBytes = 0
  let lineBinary = false
  let binary = false
  let current = first.bytes
  let bytes = 0
  let line = 1
  let size = 0
  let next: number | undefined
  let ended = false

  const finishLine = (unterminated = false) => {
    const number = line++
    if (number < offset) {
      binary ||= lineBinary
      return
    }
    if (entries.length >= limit || size >= MAX_READ_BYTES) {
      next = number
      return
    }
    let value = decoder.decode(prefix.subarray(0, prefixLength))
    if (number === stripBOMLine && value.startsWith("\uFEFF")) {
      value = value.slice(1)
      if (unterminated && value.length === 0) return
    }
    if (value.endsWith("\r")) value = value.slice(0, -1)
    const text = clampLine(value)
    const length = Buffer.byteLength(text, "utf-8") + (entries.length > 0 ? 1 : 0)
    if (size + length > MAX_READ_BYTES) {
      next = number
      return
    }
    entries.push(text)
    size += length
    binary ||= lineBinary
  }

  while (true) {
    bytes += current.length
    const eof = ended || bytes >= first.info.size
    for (let start = 0; start < current.length && next === undefined; ) {
      const newline = current.indexOf(10, start)
      const end = newline === -1 ? current.length : newline
      const segment = current.subarray(start, end)
      if (!binary && !lineBinary) lineBinary = segment.includes(0)
      lineBytes += segment.length
      // Retain enough UTF-8 bytes to recover the clamped UTF-16 prefix and detect truncation.
      if (line >= offset && prefixLength < prefix.length) {
        const retained = segment.subarray(0, prefix.length - prefixLength)
        prefix.set(retained, prefixLength)
        prefixLength += retained.length
      }
      if (newline === -1) break
      finishLine()
      prefixLength = 0
      lineBytes = 0
      lineBinary = false
      start = newline + 1
    }
    if (next !== undefined)
      return yield* makeTextPage(input, resource, { entries, offset, next }, binary, line - 1)
    if (eof) {
      if (lineBytes > 0) finishLine(true)
      return yield* makeTextPage(input, resource, { entries, offset, next }, binary, line - 1)
    }
    if (entries.length >= limit)
      return yield* makeTextPage(input, resource, { entries, offset, next: offset + entries.length }, binary, line - 1)

    const chunk = yield* readFile(files, input, resource, { offset: bytes, length: FIRST_CHUNK })
    current = chunk.bytes
    ended = current.length === 0
  }
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

const makeTextPage = Effect.fnUntraced(function* (
  input: AbsolutePath,
  resource: string,
  result: { entries: string[]; offset: number; next: number | undefined },
  binary: boolean,
  lines: number,
) {
  if (binary) return yield* new BinaryFileError({ resource })
  if (result.entries.length === 0 && result.offset !== 1)
    return yield* new OffsetOutOfRangeError({ offset: result.offset, lines })
  return new TextPage({
    type: "text-page",
    content: result.entries.join("\n"),
    mime: mimeType(input),
    offset: result.offset,
    truncated: result.next !== undefined,
    ...(result.next === undefined ? {} : { next: result.next }),
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

const clampLine = (line: string) =>
  line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : line

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
