export * as ReadToolFileSystem from "./read-filesystem"

import path from "path"
import { pathToFileURL } from "url"
import { Context, Effect, Layer, Option, Schema, Scope } from "effect"
import { systemError } from "effect/PlatformError"
import { FileSystem } from "../filesystem"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { AbsolutePath, NonNegativeInt, PositiveInt, RelativePath } from "../schema"
import { WorkspaceEnvironment } from "../workspace/environment"

export const MAX_READ_LINES = 2_000
export const MAX_READ_BYTES = 50 * 1024
export const MAX_MEDIA_INGEST_BYTES = 20 * 1024 * 1024
const MAX_LINE_LENGTH = 2_000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`

export class BinaryFileError extends Schema.TaggedErrorClass<BinaryFileError>()("ReadTool.BinaryFileError", {
  resource: Schema.String,
}) {
  override get message() {
    return `Cannot read binary file: ${this.resource}`
  }
}

export class MediaIngestLimitError extends Schema.TaggedErrorClass<MediaIngestLimitError>()(
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

export class MalformedUtf8Error extends Schema.TaggedErrorClass<MalformedUtf8Error>()("ReadTool.MalformedUtf8Error", {
  resource: Schema.String,
}) {
  override get message() {
    return `File is not valid UTF-8: ${this.resource}`
  }
}

export class OffsetOutOfRangeError extends Schema.TaggedErrorClass<OffsetOutOfRangeError>()(
  "ReadTool.OffsetOutOfRangeError",
  { offset: Schema.Number },
) {
  override get message() {
    return `Offset ${this.offset} is out of range`
  }
}

export class PathKindError extends Schema.TaggedErrorClass<PathKindError>()("ReadTool.PathKindError", {
  resource: Schema.String,
  expected: Schema.Literals(["a file", "a file or directory"]),
}) {
  override get message() {
    return `Path is not ${this.expected}: ${this.resource}`
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
  offset: Schema.optionalKey(NonNegativeInt),
  limit: Schema.optionalKey(NonNegativeInt.check(Schema.isLessThanOrEqualTo(MAX_READ_LINES))),
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

export class ListPage extends Schema.Class<ListPage>("ReadTool.ListPage")({
  type: Schema.Literal("list-page"),
  entries: Schema.Array(FileSystem.Entry),
  truncated: Schema.Boolean,
  next: Schema.optionalKey(PositiveInt),
}) {}

export interface Interface {
  readonly inspect: (path: AbsolutePath) => Effect.Effect<"file" | "directory", InspectError>
  readonly read: (
    path: AbsolutePath,
    resource: string,
    page?: PageInput,
  ) => Effect.Effect<FileContent | TextPage, ReadError>
  readonly list: (path: AbsolutePath, page?: PageInput) => Effect.Effect<ListPage, FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ReadToolFileSystem") {}

type FileType = WorkspaceEnvironment.FileInfo["type"]

/** The filesystem surface `read` consumes; FSUtil satisfies it structurally. */
export interface ReadSource {
  readonly realPath: (path: string) => Effect.Effect<string, FSUtil.Error>
  readonly open: (
    path: string,
    options: { readonly flag: "r" },
  ) => Effect.Effect<
    {
      readonly stat: Effect.Effect<{ readonly type: FileType; readonly size: bigint | number }, FSUtil.Error>
      readonly readAlloc: (bytes: number) => Effect.Effect<Option.Option<Uint8Array>, FSUtil.Error>
    },
    FSUtil.Error,
    Scope.Scope
  >
}

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
const mediaMime = (bytes: Uint8Array) => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]))
    return "image/webp"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"
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
const decodeUtf8 = (resource: string, decoder: TextDecoder, bytes?: Uint8Array) =>
  Effect.try({
    try: () => decoder.decode(bytes, { stream: bytes !== undefined }),
    catch: (error) => {
      if (error instanceof TypeError) return new MalformedUtf8Error({ resource })
      throw error
    },
  })
const decodeChunk = (resource: string, decoder: TextDecoder, bytes: Uint8Array) =>
  bytes.includes(0) ? Effect.fail(new BinaryFileError({ resource })) : decodeUtf8(resource, decoder, bytes)

export const inspect = Effect.fn("ReadTool.inspect")(function* (
  fs: { readonly stat: (path: string) => Effect.Effect<{ readonly type: FileType }, FSUtil.Error> },
  input: string,
) {
  const info = yield* fs.stat(input)
  const type = info.type === "File" ? "file" : info.type === "Directory" ? "directory" : undefined
  if (!type) return yield* Effect.fail(new PathKindError({ resource: input, expected: "a file or directory" }))
  return type
})

export const read = Effect.fn("ReadTool.read")(function* (
  fs: ReadSource,
  input: string,
  resource: string,
  page: PageInput = {},
) {
  const real = yield* fs.realPath(input)
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const file = yield* fs.open(real, { flag: "r" })
      const info = yield* file.stat
      if (info.type !== "File") return yield* Effect.fail(new PathKindError({ resource, expected: "a file" }))
      const first = Option.getOrElse(
        yield* file.readAlloc(Math.min(64 * 1024, Number(info.size) || 4 * 1024)),
        () => new Uint8Array(),
      )
      const mime = mediaMime(first)
      if (mime) {
        if (info.size > MAX_MEDIA_INGEST_BYTES)
          return yield* Effect.fail(new MediaIngestLimitError({ resource, maximumBytes: MAX_MEDIA_INGEST_BYTES }))
        const chunks = [first]
        let total = first.length
        while (total <= MAX_MEDIA_INGEST_BYTES) {
          const chunk = yield* file.readAlloc(Math.min(64 * 1024, MAX_MEDIA_INGEST_BYTES + 1 - total))
          if (Option.isNone(chunk)) break
          chunks.push(chunk.value)
          total += chunk.value.length
        }
        if (total > MAX_MEDIA_INGEST_BYTES)
          return yield* Effect.fail(new MediaIngestLimitError({ resource, maximumBytes: MAX_MEDIA_INGEST_BYTES }))
        return {
          type: "file" as const,
          uri: pathToFileURL(real).href,
          name: path.basename(real),
          content: Buffer.concat(chunks, total).toString("base64"),
          encoding: "base64" as const,
          mime,
        }
      }
      if (extensions.has(path.extname(resource).toLowerCase()))
        return yield* Effect.fail(new BinaryFileError({ resource }))
      const paged = info.size > MAX_READ_BYTES || page.offset !== undefined || page.limit !== undefined
      if (!paged) {
        if (binary(resource, first)) return yield* Effect.fail(new BinaryFileError({ resource }))
        const decoder = new TextDecoder("utf-8", { fatal: true })
        const text = [yield* decodeUtf8(resource, decoder, first)]
        while (true) {
          const chunk = yield* file.readAlloc(64 * 1024)
          if (Option.isNone(chunk)) break
          text.push(yield* decodeChunk(resource, decoder, chunk.value))
        }
        text.push(yield* decodeUtf8(resource, decoder))
        return {
          type: "file" as const,
          uri: pathToFileURL(real).href,
          name: path.basename(real),
          content: text.join(""),
          encoding: "utf8" as const,
          mime: FSUtil.mimeType(real),
        }
      }
      const offset = page.offset || 1
      const limit = Math.min(page.limit || MAX_READ_LINES, MAX_READ_LINES)
      const lines: string[] = []
      const decoder = new TextDecoder("utf-8", { fatal: true })
      let pending = ""
      let discard = false
      let line = 1
      let bytes = 0
      let next: number | undefined
      const append = (input: string) => {
        if (line < offset) {
          line++
          return true
        }
        if (lines.length >= limit || bytes >= MAX_READ_BYTES) {
          next = line
          return false
        }
        const text = input.length > MAX_LINE_LENGTH ? input.slice(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : input
        const size = Buffer.byteLength(text, "utf-8") + (lines.length > 0 ? 1 : 0)
        if (bytes + size > MAX_READ_BYTES) {
          next = line
          return false
        }
        lines.push(text)
        bytes += size
        line++
        return true
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
          if (!append(current.endsWith("\r") ? current.slice(0, -1) : current)) return false
        }
        return true
      }
      const consumeChunk = Effect.fnUntraced(function* (chunk: Uint8Array) {
        let start = 0
        while (start < chunk.length) {
          if (lines.length >= limit || bytes >= MAX_READ_BYTES) {
            next = line
            return false
          }
          const newline = chunk.indexOf(10, start)
          const end = newline === -1 ? chunk.length : newline + 1
          const segment = chunk.subarray(start, end)
          if (binary(resource, segment)) return yield* Effect.fail(new BinaryFileError({ resource }))
          if (!consume(yield* decodeUtf8(resource, decoder, segment))) return false
          start = end
        }
        return true
      })
      let done = !(yield* consumeChunk(first))
      while (!done) {
        const chunk = yield* file.readAlloc(64 * 1024)
        if (Option.isNone(chunk)) break
        done = !(yield* consumeChunk(chunk.value))
      }
      if (!done) {
        const tail = yield* decodeUtf8(resource, decoder)
        if (!discard) pending += tail
        if (pending) append(pending.endsWith("\r") ? pending.slice(0, -1) : pending)
      }
      if (lines.length === 0 && offset !== 1) return yield* Effect.fail(new OffsetOutOfRangeError({ offset }))
      return new TextPage({
        type: "text-page",
        content: lines.join("\n"),
        mime: FSUtil.mimeType(real),
        offset,
        truncated: next !== undefined,
        ...(next === undefined ? {} : { next }),
      })
    }),
  )
})

export const list = Effect.fn("ReadTool.list")(function* (fs: FSUtil.Interface, input: string, page: PageInput = {}) {
  const real = yield* fs.realPath(input)
  const items = yield* fs.readDirectoryEntries(real)
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
        return FileSystem.Entry.make({
          path: RelativePath.make(item.name + (type === "directory" ? path.sep : "")),
          type,
        })
      }),
    { concurrency: 16 },
  )
  return sortAndPage(
    entries.filter((item): item is FileSystem.Entry => item !== undefined),
    page,
  )
})

const sortAndPage = (entries: FileSystem.Entry[], page: PageInput) => {
  const offset = page.offset || 1
  const limit = Math.min(page.limit || MAX_READ_LINES, MAX_READ_LINES)
  const visible = entries.sort(FileSystem.compareEntries)
  const selected = visible.slice(offset - 1, offset - 1 + limit)
  const truncated = offset - 1 + selected.length < visible.length
  return new ListPage({
    type: "list-page",
    entries: selected,
    truncated,
    ...(truncated ? { next: offset + selected.length } : {}),
  })
}

const layer = Layer.effect(
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

export const node = makeLocationNode({ service: Service, layer, deps: [FSUtil.node] })

// Reads through WorkspaceEnvironment.Files so hosted sessions never touch the
// host filesystem. The environment has no ranged read, so file reads transfer
// the whole file once and page in memory.
const hostedLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const env = yield* WorkspaceEnvironment.Service

    // Absence surfaces as a platform NotFound so the read tool's missing-file
    // handling stays backend-agnostic; other failures become filesystem errors.
    const mapError =
      (method: string) =>
      (error: WorkspaceEnvironment.Error | WorkspaceEnvironment.NotFoundError): FSUtil.Error =>
        error._tag === "WorkspaceEnvironment.NotFoundError"
          ? systemError({ _tag: "NotFound", module: "FileSystem", method, pathOrDescriptor: error.path, cause: error })
          : WorkspaceEnvironment.toFileSystemError(method)(error)

    const stats = { stat: (target: string) => env.files.stat(target).pipe(Effect.mapError(mapError("stat"))) }

    const source: ReadSource = {
      // Paths arrive canonical from LocationMutation.resolve, so identity
      // avoids a provider canonicalization round trip per read.
      realPath: Effect.succeed,
      // The environment has no ranged read, so each read call transfers the
      // whole file once and pages in memory. Happy-path opens are that one
      // transfer; only the failure path stats to classify a non-file target,
      // which the shared read reports as PathKindError.
      // TODO: Bound and page large hosted reads once environments expose file
      // size and ranged reads.
      open: (target) =>
        env.files.read(target).pipe(
          Effect.map((bytes) => {
            let cursor = 0
            return {
              stat: Effect.succeed({ type: "File" as const, size: bytes.length }),
              readAlloc: (size: number) =>
                Effect.sync(() => {
                  if (cursor >= bytes.length) return Option.none<Uint8Array>()
                  const chunk = bytes.subarray(cursor, Math.min(cursor + size, bytes.length))
                  cursor += chunk.length
                  return Option.some(chunk)
                }),
            }
          }),
          Effect.catchTag("WorkspaceEnvironment.Error", (error) =>
            stats.stat(target).pipe(
              Effect.catch(() => Effect.fail(mapError("read")(error))),
              Effect.flatMap((info) =>
                info.type === "File"
                  ? Effect.fail(mapError("read")(error))
                  : Effect.succeed({
                      stat: Effect.succeed({ type: info.type, size: 0 }),
                      readAlloc: () => Effect.succeed(Option.none<Uint8Array>()),
                    }),
              ),
            ),
          ),
          Effect.catchTag("WorkspaceEnvironment.NotFoundError", (error) => Effect.fail(mapError("read")(error))),
        ),
    }

    // Matches the local list semantics: symlinks resolve and escape-filter
    // against the listed directory. Non-symlink types come from the listing
    // itself, keeping provider round trips proportional to symlink count.
    const resolveSymlink = Effect.fnUntraced(function* (parent: string, name: string) {
      const target = yield* env.files
        .realPath(path.posix.join(parent, name))
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (target === undefined || !FSUtil.containsPosix(parent, target)) return undefined
      const info = yield* env.files.stat(target).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (info?.type === "Directory") return "directory" as const
      if (info?.type === "File") return "file" as const
      return undefined
    })

    const list = Effect.fn("ReadTool.list")(function* (input: string, page: PageInput = {}) {
      const items = yield* env.files.list(input).pipe(Effect.mapError(mapError("list")))
      const entries = yield* Effect.forEach(
        items,
        (item) =>
          Effect.gen(function* () {
            const type =
              item.type === "file" || item.type === "directory"
                ? item.type
                : item.type === "symlink"
                  ? yield* resolveSymlink(input, item.name)
                  : undefined
            if (!type) return
            return FileSystem.Entry.make({
              path: RelativePath.make(item.name + (type === "directory" ? "/" : "")),
              type,
            })
          }),
        { concurrency: 4 },
      )
      return sortAndPage(
        entries.filter((item): item is FileSystem.Entry => item !== undefined),
        page,
      )
    })

    return Service.of({
      inspect: (target) => inspect(stats, target),
      read: (target, resource, page) => read(source, target, resource, page),
      list,
    })
  }),
)

export const hostedNode = makeLocationNode({
  service: Service,
  layer: hostedLayer,
  deps: [WorkspaceEnvironment.node],
})
