export * as FileSystem from "./filesystem"

import path from "path"
import { pathToFileURL } from "url"
import fuzzysort from "fuzzysort"
import ignore from "ignore"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { Location } from "./location"
import { ProjectReference } from "./project-reference"
import { NonNegativeInt, PositiveInt, RelativePath } from "./schema"
import { Protected } from "./filesystem/protected"
import { Ripgrep } from "./filesystem/ripgrep"
import { ToolOutputStore } from "./tool-output-store"

export const ReadInput = Schema.Struct({
  path: Schema.String,
  reference: Schema.NonEmptyString.pipe(Schema.optional),
})
export type ReadInput = typeof ReadInput.Type

export const MAX_READ_LINES = 2_000
export const MAX_READ_BYTES = 50 * 1024
export const READ_SAMPLE_BYTES = 4 * 1024
export const MAX_MEDIA_INGEST_BYTES = 20 * 1024 * 1024
const MAX_LINE_LENGTH = 2_000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`

export class BinaryFileError extends Error {
  constructor(readonly resource: string) {
    super(`Cannot read binary file: ${resource}`)
    this.name = "BinaryFileError"
  }
}

const BINARY_EXTENSIONS = new Set([
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

export const isBinary = (resource: string, bytes: Uint8Array) => {
  if (BINARY_EXTENSIONS.has(path.extname(resource).toLowerCase())) return true
  if (bytes.length === 0) return false
  let nonPrintable = 0
  for (const byte of bytes) {
    if (byte === 0) return true
    if (byte < 9 || (byte > 13 && byte < 32)) nonPrintable++
  }
  return nonPrintable / bytes.length > 0.3
}

const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((value, index) => bytes[index] === value)
const supportedImageMime = (bytes: Uint8Array) => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]))
    return "image/webp"
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

export class TextContent extends Schema.Class<TextContent>("FileSystem.TextContent")({
  type: Schema.Literal("text"),
  content: Schema.String,
  mime: Schema.String,
}) {}

export class BinaryContent extends Schema.Class<BinaryContent>("FileSystem.BinaryContent")({
  type: Schema.Literal("binary"),
  content: Schema.String,
  encoding: Schema.Literal("base64"),
  mime: Schema.String,
}) {}

export const Content = Schema.Union([TextContent, BinaryContent]).pipe(Schema.toTaggedUnion("type"))
export type Content = typeof Content.Type

export const TextPageInput = Schema.Struct({
  offset: PositiveInt.pipe(Schema.optional),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_READ_LINES)).pipe(Schema.optional),
})
export type TextPageInput = typeof TextPageInput.Type

export class TextPage extends Schema.Class<TextPage>("FileSystem.TextPage")({
  type: Schema.Literal("text-page"),
  content: Schema.String,
  mime: Schema.String,
  offset: PositiveInt,
  truncated: Schema.Boolean,
  next: PositiveInt.pipe(Schema.optional),
}) {}

export class ReadPath extends Schema.Class<ReadPath>("FileSystem.ReadPath")({
  type: Schema.Literals(["file", "directory"]),
  resource: Schema.String,
}) {}

export const ListInput = Schema.Struct({
  path: Schema.String.pipe(Schema.optional),
  reference: Schema.NonEmptyString.pipe(Schema.optional),
})
export type ListInput = typeof ListInput.Type

export const ListPageInput = Schema.Struct({
  ...ListInput.fields,
  offset: PositiveInt.pipe(Schema.optional),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(2_000)).pipe(Schema.optional),
})
export type ListPageInput = typeof ListPageInput.Type

export class ListTarget extends Schema.Class<ListTarget>("FileSystem.ListTarget")({
  absolute: Schema.String,
  real: Schema.String,
  directory: Schema.String,
  root: Schema.String,
  resource: Schema.String,
}) {}

/** Canonical root and permission resource for Location-scoped search. */
export class RootTarget extends Schema.Class<RootTarget>("FileSystem.RootTarget")({
  real: Schema.String,
  root: Schema.String,
  resource: Schema.String,
  reference: Schema.NonEmptyString.pipe(Schema.optional),
  type: Schema.Literals(["file", "directory"]),
}) {}

export class Entry extends Schema.Class<Entry>("FileSystem.Entry")({
  path: RelativePath,
  uri: Schema.String,
  type: Schema.Literals(["file", "directory"]),
  mime: Schema.String,
}) {}

export class ListPage extends Schema.Class<ListPage>("FileSystem.ListPage")({
  entries: Schema.Array(Entry),
  truncated: Schema.Boolean,
  next: PositiveInt.pipe(Schema.optional),
}) {}

export const FindInput = Schema.Struct({
  query: Schema.String,
  type: Schema.Literals(["file", "directory"]).pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
})
export type FindInput = typeof FindInput.Type

export const GrepInput = Schema.Struct({
  pattern: Schema.String,
  include: Schema.String.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
})
export type GrepInput = typeof GrepInput.Type

export class GrepMatch extends Schema.Class<GrepMatch>("FileSystem.GrepMatch")({
  path: RelativePath,
  lines: Schema.String,
  line: PositiveInt,
  offset: NonNegativeInt,
  submatches: Schema.Array(
    Schema.Struct({
      text: Schema.String,
      start: NonNegativeInt,
      end: NonNegativeInt,
    }),
  ),
}) {}

export const Event = {
  Edited: EventV2.define({
    type: "file.edited",
    schema: {
      file: Schema.String,
    },
  }),
}

export interface Interface {
  readonly read: (input: ReadInput) => Effect.Effect<Content>
  readonly resolveReadPath: (input: ReadInput) => Effect.Effect<ReadPath>
  readonly readTool: (input: ReadInput, page?: TextPageInput) => Effect.Effect<Content | TextPage>
  readonly list: (input?: ListInput) => Effect.Effect<Entry[]>
  /** Resolve a contained canonical search root and its permission resource. */
  readonly resolveRoot: (input?: ListInput) => Effect.Effect<RootTarget>
  readonly resolveList: (input?: ListInput) => Effect.Effect<ListTarget>
  readonly listResolved: (target: ListTarget) => Effect.Effect<Entry[]>
  readonly listPage: (input?: ListPageInput) => Effect.Effect<ListPage>
  readonly listPageResolved: (
    target: ListTarget,
    page?: Pick<ListPageInput, "offset" | "limit">,
  ) => Effect.Effect<ListPage>
  readonly find: (input: FindInput) => Effect.Effect<Entry[]>
  readonly grep: (input: GrepInput) => Effect.Effect<GrepMatch[]>
  readonly isIgnored: (path: RelativePath, type: "file" | "directory") => boolean
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileSystem") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const global = yield* Effect.serviceOption(Global.Service)
    const references = yield* ProjectReference.Service
    const ripgrep = yield* Ripgrep.Service
    const root = yield* fs.realPath(location.directory).pipe(Effect.orDie)
    const ignored = ignore()
    const gitignore = yield* fs
      .readFileString(path.join(location.project.directory, ".gitignore"))
      .pipe(Effect.catch(() => Effect.succeed("")))
    if (gitignore) ignored.add(gitignore)
    const ignorefile = yield* fs
      .readFileString(path.join(location.project.directory, ".ignore"))
      .pipe(Effect.catch(() => Effect.succeed("")))
    if (ignorefile) ignored.add(ignorefile)
    const select = Effect.fnUntraced(function* (reference?: string) {
      if (!reference) return { directory: location.directory, root }
      const resolved = yield* references.get(reference)
      if (!resolved) return yield* Effect.die(new Error(`Unknown project reference: ${reference}`))
      if (resolved.kind === "invalid") return yield* Effect.die(new Error(resolved.message))
      if (resolved.kind === "git") yield* references.ensurePath(resolved.path).pipe(Effect.orDie)
      return { directory: resolved.path, root: yield* fs.realPath(resolved.path).pipe(Effect.orDie) }
    })
    const resolve = Effect.fnUntraced(function* (input?: string, reference?: string) {
      const managed = path.join(
        Option.match(global, { onNone: () => Global.Path.data, onSome: (value) => value.data }),
        ToolOutputStore.MANAGED_DIRECTORY,
      )
      if (input && path.isAbsolute(input)) {
        if (reference) return yield* Effect.die(new Error("Absolute paths cannot use a project reference"))
        if (path.dirname(input) !== managed || !path.basename(input).startsWith("tool_"))
          return yield* Effect.die(new Error("Absolute path is not managed tool output"))
        const real = yield* fs.realPath(input).pipe(Effect.orDie)
        const managedRoot = yield* fs.realPath(managed).pipe(Effect.orDie)
        if (path.dirname(real) !== managedRoot || !path.basename(real).startsWith("tool_"))
          return yield* Effect.die(new Error("Path escapes managed tool output"))
        return { absolute: input, real, directory: managed, root: managedRoot }
      }
      const selected = yield* select(reference)
      const absolute = path.resolve(selected.directory, input ?? ".")
      if (!FSUtil.contains(selected.directory, absolute))
        return yield* Effect.die(new Error("Path escapes the location"))
      const real = yield* fs.realPath(absolute).pipe(Effect.orDie)
      if (!FSUtil.contains(selected.root, real)) return yield* Effect.die(new Error("Path escapes the location"))
      return { absolute, real, ...selected }
    })
    const entry = Effect.fnUntraced(function* (absolute: string, selected = { directory: location.directory, root }) {
      const real = yield* fs.realPath(absolute).pipe(Effect.catch(() => Effect.void))
      if (!real) return
      if (!FSUtil.contains(selected.root, real)) return
      const info = yield* fs.stat(real).pipe(Effect.catch(() => Effect.void))
      if (!info) return
      const type = info.type === "Directory" ? "directory" : info.type === "File" ? "file" : undefined
      if (!type) return
      return new Entry({
        path: RelativePath.make(path.relative(selected.directory, absolute)),
        uri: pathToFileURL(real).href,
        type,
        mime: type === "directory" ? "application/x-directory" : FSUtil.mimeType(real),
      })
    })

    const scan = Effect.fnUntraced(function* () {
      if (location.directory === Global.Path.home && location.project.id === "global") {
        const protectedNames = Protected.names()
        const nested = new Set(["node_modules", "dist", "build", "target", "vendor"])
        return (yield* Effect.forEach(
          yield* fs.readDirectoryEntries(location.directory).pipe(Effect.orElseSucceed(() => [])),
          (item) =>
            Effect.gen(function* () {
              if (item.type !== "directory" || item.name.startsWith(".") || protectedNames.has(item.name)) return []
              const directory = path.join(location.directory, item.name)
              return [
                item.name + "/",
                ...(yield* fs.readDirectoryEntries(directory).pipe(Effect.orElseSucceed(() => []))).flatMap((child) =>
                  child.type === "directory" && !child.name.startsWith(".") && !nested.has(child.name)
                    ? [`${item.name}/${child.name}/`]
                    : [],
                ),
              ]
            }),
        )).flat()
      }

      const files = Array.from(yield* ripgrep.files({ cwd: location.directory }).pipe(Stream.runCollect, Effect.orDie))
      const dirs = new Set<string>()
      for (const file of files) {
        let current = file
        while (true) {
          const directory = path.dirname(current)
          if (directory === "." || directory === current) break
          current = directory
          dirs.add(directory + "/")
        }
      }
      return [...files, ...dirs]
    })

    const resolveReadPath = Effect.fn("FileSystem.resolveReadPath")(function* (input: ReadInput) {
      const target = yield* resolve(input.path, input.reference)
      const info = yield* fs.stat(target.real).pipe(Effect.orDie)
      const type = info.type === "File" ? "file" : info.type === "Directory" ? "directory" : undefined
      if (!type) return yield* Effect.die(new Error("Path is not a file or directory"))
      const relative = path.relative(target.root, target.real).replaceAll("\\", "/") || "."
      return new ReadPath({
        type,
        resource: input.reference === undefined ? relative : `${input.reference}:${relative}`,
      })
    })
    const resolveFile = Effect.fnUntraced(function* (input: ReadInput) {
      const target = yield* resolve(input.path, input.reference)
      const info = yield* fs.stat(target.real).pipe(Effect.orDie)
      if (info.type !== "File") return yield* Effect.die(new Error("Path is not a file"))
      const relative = path.relative(target.root, target.real).replaceAll("\\", "/") || "."
      return {
        real: target.real,
        resource: input.reference === undefined ? relative : `${input.reference}:${relative}`,
      }
    })
    const content = (target: { readonly real: string }, bytes: Uint8Array) =>
      Effect.gen(function* () {
        const mime = FSUtil.mimeType(target.real)
        if (!bytes.includes(0)) {
          const content = yield* Effect.sync(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).pipe(
            Effect.option,
          )
          if (content._tag === "Some") return new TextContent({ type: "text", content: content.value, mime })
        }
        return new BinaryContent({
          type: "binary",
          content: Buffer.from(bytes).toString("base64"),
          encoding: "base64",
          mime,
        })
      })
    const readTool = Effect.fn("FileSystem.readTool")(function* (input: ReadInput, page: TextPageInput = {}) {
      const target = yield* resolveFile(input)
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fs.open(target.real, { flag: "r" }).pipe(Effect.orDie)
          const info = yield* file.stat.pipe(Effect.orDie)
          if (info.type !== "File") return yield* Effect.die(new Error("Path is not a file"))

          const first = Option.getOrElse(
            yield* file.readAlloc(Math.min(64 * 1024, Number(info.size) || READ_SAMPLE_BYTES)).pipe(Effect.orDie),
            () => new Uint8Array(),
          )
          const mime = supportedImageMime(first)
          if (mime) {
            if (info.size > MAX_MEDIA_INGEST_BYTES)
              return yield* Effect.die(new MediaIngestLimitError(target.resource, MAX_MEDIA_INGEST_BYTES))
            const chunks = [first]
            let total = first.length
            while (total <= MAX_MEDIA_INGEST_BYTES) {
              const chunk = yield* file
                .readAlloc(Math.min(64 * 1024, MAX_MEDIA_INGEST_BYTES + 1 - total))
                .pipe(Effect.orDie)
              if (Option.isNone(chunk)) break
              chunks.push(chunk.value)
              total += chunk.value.length
            }
            if (total > MAX_MEDIA_INGEST_BYTES)
              return yield* Effect.die(new MediaIngestLimitError(target.resource, MAX_MEDIA_INGEST_BYTES))
            return new BinaryContent({
              type: "binary",
              content: Buffer.concat(
                chunks.map((chunk) => Buffer.from(chunk)),
                total,
              ).toString("base64"),
              encoding: "base64",
              mime,
            })
          }
          if (startsWith(first, [0x25, 0x50, 0x44, 0x46]) || isBinary(target.resource, first))
            return yield* Effect.die(new BinaryFileError(target.resource))

          const paged = info.size > MAX_READ_BYTES || page.offset !== undefined || page.limit !== undefined
          if (!paged) {
            const decoder = new TextDecoder("utf-8", { fatal: true })
            const text = [yield* Effect.sync(() => decoder.decode(first, { stream: true }))]
            while (true) {
              const chunk = yield* file.readAlloc(64 * 1024).pipe(Effect.orDie)
              if (Option.isNone(chunk)) break
              if (chunk.value.includes(0)) return yield* Effect.die(new BinaryFileError(target.resource))
              text.push(yield* Effect.sync(() => decoder.decode(chunk.value, { stream: true })))
            }
            text.push(yield* Effect.sync(() => decoder.decode()))
            return new TextContent({ type: "text", content: text.join(""), mime: FSUtil.mimeType(target.real) })
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
              next ??= line
              line++
              return
            }
            found = true
            const text = input.length > MAX_LINE_LENGTH ? input.slice(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : input
            const size = Buffer.byteLength(text, "utf-8") + (lines.length > 0 ? 1 : 0)
            if (bytes + size > MAX_READ_BYTES) {
              truncated = true
              next ??= line
              line++
              return
            }
            lines.push(text)
            bytes += size
            line++
          }

          const consume = (chunk: Uint8Array) => {
            if (chunk.includes(0)) throw new BinaryFileError(target.resource)
            let text = decoder.decode(chunk, { stream: true })
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

          yield* Effect.sync(() => consume(first))
          while (true) {
            const chunk = yield* file.readAlloc(64 * 1024).pipe(Effect.orDie)
            if (Option.isNone(chunk)) break
            yield* Effect.sync(() => consume(chunk.value))
          }
          const tail = yield* Effect.sync(() => decoder.decode())
          if (!discard) pending += tail
          if (pending) append(pending.endsWith("\r") ? pending.slice(0, -1) : pending)
          if (!found && offset !== 1) return yield* Effect.die(new Error(`Offset ${offset} is out of range`))

          const text = lines.join("\n")
          return new TextPage({
            type: "text-page",
            content: text,
            mime: FSUtil.mimeType(target.real),
            offset,
            truncated,
            ...(next === undefined ? {} : { next }),
          })
        }),
      )
    })
    const resolveList = Effect.fn("FileSystem.resolveList")(function* (input: ListInput = {}) {
      const directory = yield* resolve(input.path, input.reference)
      const info = yield* fs.stat(directory.real).pipe(Effect.orDie)
      if (info.type !== "Directory") return yield* Effect.die(new Error("Path is not a directory"))
      const relative = path.relative(directory.root, directory.real).replaceAll("\\", "/") || "."
      return new ListTarget({
        ...directory,
        resource: input.reference === undefined ? relative : `${input.reference}:${relative}`,
      })
    })
    const resolveRoot = Effect.fn("FileSystem.resolveRoot")(function* (input: ListInput = {}) {
      const target = yield* resolve(input.path, input.reference)
      const info = yield* fs.stat(target.real).pipe(Effect.orDie)
      const type = info.type === "File" ? "file" : info.type === "Directory" ? "directory" : undefined
      if (!type) return yield* Effect.die(new Error("Path is not a file or directory"))
      const relative = path.relative(target.root, target.real).replaceAll("\\", "/") || "."
      return new RootTarget({
        ...target,
        resource: input.reference === undefined ? relative : `${input.reference}:${relative}`,
        reference: input.reference,
        type,
      })
    })
    const listResolved = Effect.fn("FileSystem.listResolved")(function* (directory: ListTarget) {
      return yield* fs.readDirectoryEntries(directory.real).pipe(
        Effect.orDie,
        Effect.flatMap((items) =>
          Effect.forEach(items, (item) => entry(path.join(directory.absolute, item.name), directory), {
            concurrency: "unbounded",
          }),
        ),
        Effect.map((items) =>
          items
            .filter((item): item is Entry => item !== undefined)
            .sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1)),
        ),
      )
    })
    const listPageResolved = Effect.fn("FileSystem.listPageResolved")(function* (
      target: ListTarget,
      page: Pick<ListPageInput, "offset" | "limit"> = {},
    ) {
      type Candidate = Entry | { readonly name: string; readonly type: "file" | "directory" }
      const offset = page.offset ?? 1
      const limit = Math.min(page.limit ?? 2_000, 2_000)
      const items = yield* fs.readDirectoryEntries(target.real).pipe(Effect.orDie)
      const candidates = yield* Effect.forEach(
        items,
        (item): Effect.Effect<Candidate | undefined> => {
          if (item.type === "other") return Effect.succeed(undefined)
          if (item.type === "symlink") return entry(path.join(target.absolute, item.name), target)
          return Effect.succeed({ name: item.name, type: item.type } as const)
        },
        { concurrency: 16 },
      ).pipe(Effect.map((items) => items.filter((item): item is Candidate => item !== undefined)))
      candidates.sort((a, b) => {
        return a.type === b.type
          ? (a instanceof Entry ? a.path : a.name).localeCompare(b instanceof Entry ? b.path : b.name)
          : a.type === "directory"
            ? -1
            : 1
      })
      const selected = candidates.slice(offset - 1, offset - 1 + limit)
      const entries = yield* Effect.forEach(
        selected,
        (item) => (item instanceof Entry ? Effect.succeed(item) : entry(path.join(target.absolute, item.name), target)),
        {
          concurrency: 16,
        },
      ).pipe(Effect.map((items) => items.filter((item): item is Entry => item !== undefined)))
      const truncated = offset - 1 + selected.length < candidates.length
      return new ListPage({ entries, truncated, ...(truncated ? { next: offset + selected.length } : {}) })
    })

    return Service.of({
      read: Effect.fn("FileSystem.read")(function* (input) {
        const target = yield* resolveFile(input)
        return yield* content(target, yield* fs.readFile(target.real).pipe(Effect.orDie))
      }),
      resolveReadPath,
      readTool,
      list: Effect.fn("FileSystem.list")(function* (input) {
        return yield* listResolved(yield* resolveList(input))
      }),
      resolveRoot,
      resolveList,
      listResolved,
      listPage: Effect.fn("FileSystem.listPage")(function* (input) {
        return yield* listPageResolved(yield* resolveList(input), input)
      }),
      listPageResolved,
      find: Effect.fn("FileSystem.find")(function* (input) {
        const items = (yield* scan()).filter((item) => input.type !== "file" || !item.endsWith("/"))
        const filtered = items.filter((item) => input.type !== "directory" || item.endsWith("/"))
        const sorted = input.query.trim()
          ? fuzzysort.go(input.query.trim(), filtered, { limit: input.limit ?? 100 }).map((item) => item.target)
          : filtered.slice(0, input.limit)
        return yield* Effect.forEach(sorted, (item) => entry(path.join(location.directory, item))).pipe(
          Effect.map((items) => items.filter((item): item is Entry => item !== undefined)),
        )
      }),
      grep: Effect.fn("FileSystem.grep")(function* (input) {
        return (yield* ripgrep
          .search({
            cwd: location.directory,
            pattern: input.pattern,
            glob: input.include ? [input.include] : undefined,
            limit: input.limit,
          })
          .pipe(Effect.orDie)).items.map(
          (item) =>
            new GrepMatch({
              path: RelativePath.make(item.path.text),
              lines: item.lines.text,
              line: item.line_number,
              offset: item.absolute_offset,
              submatches: item.submatches.map((submatch) => ({
                text: submatch.match.text,
                start: submatch.start,
                end: submatch.end,
              })),
            }),
        )
      }),
      isIgnored: (input, type) =>
        ignored.ignores(
          path.relative(location.project.directory, path.join(location.directory, input)) +
            (type === "directory" ? "/" : ""),
        ),
    })
  }),
)

export const locationLayer = layer.pipe(
  Layer.provide(Ripgrep.defaultLayer),
  Layer.provideMerge(ProjectReference.locationLayer),
)
