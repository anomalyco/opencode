export * as LocationSearch from "./location-search"

import path from "path"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { Location } from "./location"
import { Ripgrep } from "./ripgrep"
import { NonNegativeInt, PositiveInt, RelativePath } from "./schema"
import { ToolOutputStore } from "./tool-output-store"

/**
 * Location-scoped raw search substrate. Search authority is selected only by
 * FileSystem, preserving Location-relative paths. Model formatting, leaf-tool permissions, and HTTP transport stay
 * outside this service so future GlobTool, GrepTool, and HTTP consumers can
 * share the same bounded filesystem behavior.
 *
 * TODO: Expose this substrate through HTTP fs.search/fs.grep endpoints.
 * TODO: Reuse this substrate for instruction and skill discovery where suitable.
 */

export const DEFAULT_RESULT_LIMIT = 100
export const MAX_RESULT_LIMIT = 100
export const MAX_LINE_PREVIEW_LENGTH = 2_000

export const ResultLimit = PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_RESULT_LIMIT))

export const FilesInput = Schema.Struct({
  pattern: Schema.String,
  path: Schema.String.pipe(Schema.optional),
  limit: ResultLimit.pipe(Schema.optional),
})
export type FilesInput = typeof FilesInput.Type & { readonly signal?: AbortSignal }

export const GrepInput = Schema.Struct({
  pattern: Schema.String,
  include: Schema.String.pipe(Schema.optional),
  path: Schema.String.pipe(Schema.optional),
  limit: ResultLimit.pipe(Schema.optional),
})
export type GrepInput = typeof GrepInput.Type & { readonly signal?: AbortSignal }

export class File extends Schema.Class<File>("LocationSearch.File")({
  path: RelativePath,
  canonical: Schema.String,
  resource: Schema.String,
  mtime: Schema.Number,
}) {}

export class Submatch extends Schema.Class<Submatch>("LocationSearch.Submatch")({
  text: Schema.String,
  start: NonNegativeInt,
  end: NonNegativeInt,
}) {}

export class Match extends Schema.Class<Match>("LocationSearch.Match")({
  path: RelativePath,
  canonical: Schema.String,
  resource: Schema.String,
  lines: Schema.String,
  linePreviewTruncated: Schema.Boolean,
  line: PositiveInt,
  offset: NonNegativeInt,
  submatches: Schema.Array(Submatch),
  mtime: Schema.Number,
}) {}

export class FilesResult extends Schema.Class<FilesResult>("LocationSearch.FilesResult")({
  items: Schema.Array(File),
  truncated: Schema.Boolean,
  partial: Schema.Boolean,
}) {}

export class GrepResult extends Schema.Class<GrepResult>("LocationSearch.GrepResult")({
  items: Schema.Array(Match),
  truncated: Schema.Boolean,
  partial: Schema.Boolean,
}) {}

export interface Interface {
  readonly files: (input: FilesInput) => Effect.Effect<FilesResult, Ripgrep.Error>
  readonly grep: (input: GrepInput) => Effect.Effect<GrepResult, Ripgrep.Error | Ripgrep.InvalidPatternError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/LocationSearch") {}

const slash = (value: string) => value.replaceAll("\\", "/")
const cap = (limit?: number) => Math.min(limit ?? DEFAULT_RESULT_LIMIT, MAX_RESULT_LIMIT)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const global = yield* Effect.serviceOption(Global.Service)
    const ripgrep = yield* Ripgrep.Service

    const resolve = Effect.fnUntraced(function* (input?: string) {
      const directory = input && path.isAbsolute(input) ? path.dirname(input) : location.directory
      const absolute = path.resolve(location.directory, input ?? ".")
      if (!path.isAbsolute(input ?? "") && !FSUtil.contains(location.directory, absolute))
        return yield* Effect.die(new globalThis.Error("Path escapes the location"))
      if (path.isAbsolute(input ?? "")) {
        const managed = path.join(
          Option.match(global, { onNone: () => Global.Path.data, onSome: (value) => value.data }),
          ToolOutputStore.MANAGED_DIRECTORY,
        )
        if (directory !== managed || !path.basename(absolute).startsWith("tool_"))
          return yield* Effect.die(new globalThis.Error("Absolute path is not managed tool output"))
      }
      const real = yield* fs.realPath(absolute).pipe(Effect.orDie)
      const root = yield* fs.realPath(directory).pipe(Effect.orDie)
      if (!FSUtil.contains(root, real)) return yield* Effect.die(new globalThis.Error("Path escapes the search root"))
      const info = yield* fs.stat(real).pipe(Effect.orDie)
      const type = info.type === "File" ? ("file" as const) : info.type === "Directory" ? ("directory" as const) : undefined
      if (!type) return yield* Effect.die(new globalThis.Error("Search root is not a file or directory"))
      return { real, root, resource: slash(path.relative(root, real)) || ".", type }
    })

    const candidate = Effect.fnUntraced(function* (
      root: { readonly real: string; readonly root: string; readonly type: "file" | "directory" },
      cwd: string,
      value: string,
    ) {
      const absolute = path.resolve(cwd, value)
      const lexicallyContained =
        root.type === "directory" ? FSUtil.contains(root.real, absolute) : absolute === root.real
      if (!lexicallyContained) return
      const canonical = yield* fs.realPath(absolute).pipe(Effect.catch(() => Effect.void))
      if (!canonical || !FSUtil.contains(root.root, canonical)) return
      const info = yield* fs.stat(canonical).pipe(Effect.catch(() => Effect.void))
      if (!info || info.type !== "File") return
      const relative = slash(path.relative(root.root, canonical))
      return {
        path: RelativePath.make(relative),
        canonical,
        resource: relative,
        mtime: info.mtime.pipe(
          Option.map((date) => date.getTime()),
          Option.getOrElse(() => 0),
        ),
      }
    })

    return Service.of({
      files: Effect.fn("LocationSearch.files")(function* (input) {
        const root = yield* resolve(input.path)
        if (root.type !== "directory")
          return yield* Effect.die(new globalThis.Error("Files search path must be a directory"))
        const result = yield* ripgrep.files({
          cwd: root.real,
          pattern: input.pattern,
          limit: cap(input.limit),
          signal: input.signal,
        })
        const mapped = yield* Effect.forEach(result.items, (item) => candidate(root, root.real, item), {
          concurrency: 16,
        })
        const items = mapped.filter((item): item is File => item !== undefined).map((item) => new File(item))
        // TODO: Decide result ordering policy: V1 mtime sorting versus stable path ordering.
        // TODO: Report inaccessible paths discovered after bounded ripgrep termination when practical.
        return new FilesResult({
          items,
          truncated: result.truncated,
          partial: result.partial || items.length !== result.items.length,
        })
      }),
      grep: Effect.fn("LocationSearch.grep")(function* (input) {
        const root = yield* resolve(input.path)
        const cwd = root.type === "directory" ? root.real : path.dirname(root.real)
        const result = yield* ripgrep.grep({
          cwd,
          pattern: input.pattern,
          include: input.include,
          file: root.type === "file" ? path.basename(root.real) : undefined,
          limit: cap(input.limit),
          signal: input.signal,
        })
        const candidates = new Map<string, ReturnType<typeof candidate>>()
        for (const item of result.items) {
          if (!candidates.has(item.path.text)) {
            candidates.set(item.path.text, yield* Effect.cached(candidate(root, cwd, item.path.text)))
          }
        }
        const mapped = yield* Effect.forEach(
          result.items,
          (item) =>
            candidates.get(item.path.text)!.pipe(
              Effect.map(
                (file) =>
                  file &&
                  new Match({
                    ...file,
                    lines: item.lines.text.slice(0, MAX_LINE_PREVIEW_LENGTH),
                    linePreviewTruncated: item.lines.text.length > MAX_LINE_PREVIEW_LENGTH,
                    line: item.line_number,
                    offset: item.absolute_offset,
                    submatches: item.submatches.map(
                      (submatch) =>
                        new Submatch({ text: submatch.match.text, start: submatch.start, end: submatch.end }),
                    ),
                  }),
              ),
            ),
          { concurrency: 16 },
        )
        const items = mapped.filter((item): item is Match => item !== undefined)
        // TODO: Decide result ordering policy: V1 mtime sorting versus stable path ordering.
        // TODO: Report inaccessible paths discovered after bounded ripgrep termination when practical.
        return new GrepResult({
          items,
          truncated: result.truncated,
          partial: result.partial || items.length !== result.items.length,
        })
      }),
    })
  }),
)
