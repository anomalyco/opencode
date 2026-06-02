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
  reference: Schema.String.pipe(Schema.optional),
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

export const ListInput = Schema.Struct({
  path: RelativePath.pipe(Schema.optional),
  reference: Schema.String.pipe(Schema.optional),
})
export type ListInput = typeof ListInput.Type

export class Entry extends Schema.Class<Entry>("LocationFileSystem.Entry")({
  path: RelativePath,
  uri: Schema.String,
  type: Schema.Literals(["file", "directory"]),
  mime: Schema.String,
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
  readonly list: (input?: ListInput) => Effect.Effect<Entry[]>
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

    return Service.of({
      read: Effect.fn("FileSystem.read")(function* (input) {
        const file = yield* resolve(input.path, input.reference)
        const info = yield* fs.stat(file.real).pipe(Effect.orDie)
        if (info.type !== "File") return yield* Effect.die(new Error("Path is not a file"))
        const bytes = yield* fs.readFile(file.real).pipe(Effect.orDie)
        const mime = FSUtil.mimeType(file.real)
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
      }),
      list: Effect.fn("FileSystem.list")(function* (input = {}) {
        const directory = yield* resolve(input.path, input.reference)
        const info = yield* fs.stat(directory.real).pipe(Effect.orDie)
        if (info.type !== "Directory") return yield* Effect.die(new Error("Path is not a directory"))
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
      }),
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
