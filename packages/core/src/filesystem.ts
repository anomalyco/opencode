export * as FileSystem from "./filesystem"

import path from "path"
import { pathToFileURL } from "url"
import fuzzysort from "fuzzysort"
import ignore from "ignore"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { Location } from "./location"
import { ProjectReference } from "./project-reference"
import { NonNegativeInt, PositiveInt, RelativePath } from "./schema"
import { Protected } from "./filesystem/protected"
import { Ripgrep } from "./filesystem/ripgrep"

export const ReadInput = Schema.Struct({
  path: RelativePath,
  reference: Schema.NonEmptyString.pipe(Schema.optional),
})
export type ReadInput = typeof ReadInput.Type

export class TextContent extends Schema.Class<TextContent>("LocationFileSystem.TextContent")({
  type: Schema.Literal("text"),
  content: Schema.String,
  mime: Schema.String,
}) {}

export class BinaryContent extends Schema.Class<BinaryContent>("LocationFileSystem.BinaryContent")({
  type: Schema.Literal("binary"),
  content: Schema.String,
  encoding: Schema.Literal("base64"),
  mime: Schema.String,
}) {}

export const Content = Schema.Union([TextContent, BinaryContent]).pipe(Schema.toTaggedUnion("type"))
export type Content = typeof Content.Type

export class ReadTarget extends Schema.Class<ReadTarget>("LocationFileSystem.ReadTarget")({
  real: Schema.String,
  resource: Schema.String,
  size: NonNegativeInt,
}) {}

export const ListInput = Schema.Struct({
  path: RelativePath.pipe(Schema.optional),
  reference: Schema.NonEmptyString.pipe(Schema.optional),
})
export type ListInput = typeof ListInput.Type

export const ListPageInput = Schema.Struct({
  ...ListInput.fields,
  offset: PositiveInt.pipe(Schema.optional),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(2_000)).pipe(Schema.optional),
})
export type ListPageInput = typeof ListPageInput.Type

export class ListTarget extends Schema.Class<ListTarget>("LocationFileSystem.ListTarget")({
  absolute: Schema.String,
  real: Schema.String,
  directory: Schema.String,
  root: Schema.String,
  resource: Schema.String,
}) {}

export type ReadPathTarget =
  | { readonly type: "file"; readonly target: ReadTarget }
  | { readonly type: "directory"; readonly target: ListTarget }

export class Entry extends Schema.Class<Entry>("LocationFileSystem.Entry")({
  path: RelativePath,
  uri: Schema.String,
  type: Schema.Literals(["file", "directory"]),
  mime: Schema.String,
}) {}

export class ListPage extends Schema.Class<ListPage>("LocationFileSystem.ListPage")({
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

export class GrepMatch extends Schema.Class<GrepMatch>("LocationFileSystem.GrepMatch")({
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
  readonly resolveReadPath: (input: ReadInput) => Effect.Effect<ReadPathTarget>
  readonly resolveRead: (input: ReadInput) => Effect.Effect<ReadTarget>
  readonly readResolved: (target: ReadTarget, maximumBytes?: number) => Effect.Effect<Content>
  readonly list: (input?: ListInput) => Effect.Effect<Entry[]>
  readonly resolveList: (input?: ListInput) => Effect.Effect<ListTarget>
  readonly listResolved: (target: ListTarget) => Effect.Effect<Entry[]>
  readonly listPage: (input?: ListPageInput) => Effect.Effect<ListPage>
  readonly listPageResolved: (target: ListTarget, page?: Pick<ListPageInput, "offset" | "limit">) => Effect.Effect<ListPage>
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
    const resolve = Effect.fnUntraced(function* (input?: RelativePath, reference?: string) {
      if (input && path.isAbsolute(input)) return yield* Effect.die(new Error("Path must be relative to the location"))
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
      const file = yield* resolve(input.path, input.reference)
      const info = yield* fs.stat(file.real).pipe(Effect.orDie)
      const relative = path.relative(file.root, file.real).replaceAll("\\", "/")
      const resource = input.reference === undefined ? relative || "." : `${input.reference}:${relative || "."}`
      if (info.type === "File") {
        return { type: "file" as const, target: new ReadTarget({ real: file.real, resource, size: Number(info.size) }) }
      }
      if (info.type === "Directory") {
        return { type: "directory" as const, target: new ListTarget({ ...file, resource }) }
      }
      return yield* Effect.die(new Error("Path is not a file or directory"))
    })
    const resolveRead = Effect.fn("FileSystem.resolveRead")(function* (input: ReadInput) {
      const resolved = yield* resolveReadPath(input)
      if (resolved.type !== "file") return yield* Effect.die(new Error("Path is not a file"))
      return resolved.target
    })
    const content = (target: ReadTarget, bytes: Uint8Array) => Effect.gen(function* () {
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
    const readResolved = Effect.fn("FileSystem.readResolved")(function* (
      target: ReadTarget,
      maximumBytes?: number,
    ) {
      if (maximumBytes === undefined) return yield* content(target, yield* fs.readFile(target.real).pipe(Effect.orDie))
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fs.open(target.real, { flag: "r" }).pipe(Effect.orDie)
          const info = yield* file.stat.pipe(Effect.orDie)
          if (info.type !== "File") return yield* Effect.die(new Error("Path is not a file"))
          if (info.size > maximumBytes) return yield* Effect.die(new Error(`File exceeds ${maximumBytes} byte read limit`))
          const bytes = yield* file.readAlloc(maximumBytes + 1).pipe(Effect.orDie)
          if (bytes._tag === "Some" && bytes.value.length > maximumBytes)
            return yield* Effect.die(new Error(`File exceeds ${maximumBytes} byte read limit`))
          return yield* content(target, bytes._tag === "Some" ? bytes.value : new Uint8Array())
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
      const candidates = yield* Effect.forEach(items, (item): Effect.Effect<Candidate | undefined> => {
        if (item.type === "other") return Effect.succeed(undefined)
        if (item.type === "symlink") return entry(path.join(target.absolute, item.name), target)
        return Effect.succeed({ name: item.name, type: item.type } as const)
      }, { concurrency: 16 }).pipe(
        Effect.map((items) => items.filter((item): item is Candidate => item !== undefined)),
      )
      candidates.sort((a, b) => {
        return a.type === b.type
          ? (a instanceof Entry ? a.path : a.name).localeCompare(b instanceof Entry ? b.path : b.name)
          : a.type === "directory" ? -1 : 1
      })
      const selected = candidates.slice(offset - 1, offset - 1 + limit)
      const entries = yield* Effect.forEach(selected, (item) =>
        item instanceof Entry ? Effect.succeed(item) : entry(path.join(target.absolute, item.name), target), {
        concurrency: 16,
      }).pipe(Effect.map((items) => items.filter((item): item is Entry => item !== undefined)))
      const truncated = offset - 1 + selected.length < candidates.length
      return new ListPage({ entries, truncated, ...(truncated ? { next: offset + selected.length } : {}) })
    })

    return Service.of({
      read: Effect.fn("FileSystem.read")(function* (input) {
        return yield* readResolved(yield* resolveRead(input))
      }),
      resolveReadPath,
      resolveRead,
      readResolved,
      list: Effect.fn("FileSystem.list")(function* (input) {
        return yield* listResolved(yield* resolveList(input))
      }),
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
