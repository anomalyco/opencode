export * as ReadToolFileSystem from "./read-filesystem.js"

import path from "path"
import { pathToFileURL } from "url"
import { TextBoundary } from "@opencode/util/text-boundary"
import { Effect, Schema } from "effect"
import { Environment } from "../environment/index.js"
import type { Files } from "../environment/index.js"
import { Mime } from "../mime.js"
import { AbsolutePath, NonNegativeInt, PositiveInt } from "../schema.js"

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

export const TextContent = Schema.Struct({
  type: Schema.Literal("text"),
  content: Schema.String,
  offset: PositiveInt,
  lineCount: NonNegativeInt,
  next: Schema.optionalKey(PositiveInt).annotate({
    description: "The line to continue reading from. Absent when the content reaches the end of the file.",
  }),
}).annotate({ identifier: "ReadTool.TextContent" })
export type TextContent = typeof TextContent.Type

export const DirectoryContent = Schema.Struct({
  type: Schema.Literal("directory"),
  entries: Schema.Array(Schema.String),
  next: Schema.optionalKey(PositiveInt).annotate({
    description: "The entry to continue reading from. Absent when the listing reaches the last entry.",
  }),
}).annotate({ identifier: "ReadTool.DirectoryContent" })
export type DirectoryContent = typeof DirectoryContent.Type

export const MediaContent = Schema.Struct({
  type: Schema.Literal("media"),
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "ReadTool.MediaContent" })
export type MediaContent = typeof MediaContent.Type

export const Output = Schema.Union([TextContent, DirectoryContent, MediaContent])
export type Output = typeof Output.Type

// Media bytes travel beside the reference so the tool can attach them without storing them in its output.
export type Media = MediaContent & { readonly name: string; readonly bytes: Uint8Array }

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
  if ("type" in first) return first

  const media = Mime.detectMedia(first.bytes)
  if (media && MEDIA_MIMES.has(media)) {
    if (first.info.size > MAX_MEDIA_INGEST_BYTES)
      return yield* new MediaIngestLimitError({ resource, maximumBytes: MAX_MEDIA_INGEST_BYTES })
    const whole = yield* readFile(files, input, resource)
    return {
      type: "media" as const,
      uri: virtual ? resource : pathToFileURL(input).href,
      mime: media,
      name: virtual ? path.posix.basename(input) : path.basename(input),
      bytes: whole.bytes,
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
        return { type: "text" as const, content, offset: 1, lineCount: count }
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
  return {
    type: "text" as const,
    content: entries.join("\n"),
    offset: from,
    lineCount: entries.length,
    ...(next === undefined ? {} : { next }),
  }
})

const list = (items: ReadonlyArray<Environment.DirEntry>, page: PageInput, sep = path.sep): DirectoryContent => {
  const offset = page.offset || 1
  const limit = Math.min(page.limit || MAX_READ_LINES, MAX_READ_LINES)
  const visible = items
    .flatMap((item) =>
      item.type === "other"
        ? []
        : [{ name: item.name + (item.type === "directory" ? sep : ""), directory: item.type === "directory" }],
    )
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
  const selected = visible.slice(offset - 1, offset - 1 + limit)
  return {
    type: "directory",
    entries: selected.map((entry) => entry.name),
    ...(offset - 1 + selected.length < visible.length ? { next: offset + selected.length } : {}),
  }
}

const clampLine = (line: string) =>
  line.length <= MAX_LINE_LENGTH ? line : TextBoundary.head(line, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX
