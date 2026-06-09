export * as Search from "./index"

import path from "path"
import { pathToFileURL } from "url"
import { Context, Effect, Fiber, Layer, Schema, Scope } from "effect"
import { Fff } from "#fff"
import fuzzysort from "fuzzysort"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { Ripgrep } from "../ripgrep"
import { AbsolutePath, NonNegativeInt, PositiveInt, RelativePath } from "../schema"

export class FindInput extends Schema.Class<FindInput>("Search.FindInput")({
  /** Absolute directory to search. */
  cwd: AbsolutePath,
  /** Text used to rank file and directory names. */
  query: Schema.String,
  /** Restricts results to files or directories. Omission searches both. */
  type: Schema.Literals(["file", "directory"]).pipe(Schema.optional),
  /** Maximum number of results to return. */
  limit: PositiveInt.pipe(Schema.optional),
}) {}

export class GlobInput extends Schema.Class<GlobInput>("Search.GlobInput")({
  /** Absolute directory to search. */
  cwd: AbsolutePath,
  /** Glob pattern matched against paths beneath the search root. */
  pattern: Schema.String,
  /** Maximum number of results to return. */
  limit: PositiveInt.pipe(Schema.optional),
}) {}

export class GrepInput extends Schema.Class<GrepInput>("Search.GrepInput")({
  /** Absolute directory to search. */
  cwd: AbsolutePath,
  /** Regular expression matched against file contents. */
  pattern: Schema.String,
  /** Glob pattern restricting which files are searched. */
  include: Schema.String.pipe(Schema.optional),
  /** Maximum number of matches to return. */
  limit: PositiveInt.pipe(Schema.optional),
}) {}

export const Submatch = Schema.Struct({
  /** Text matched by this range. */
  text: Schema.String,
  /** Zero-based byte offset where the range begins within the matched text. */
  start: NonNegativeInt,
  /** Zero-based exclusive byte offset where the range ends within the matched text. */
  end: NonNegativeInt,
})
export type Submatch = typeof Submatch.Type

export class Match extends Schema.Class<Match>("Search.Match")({
  /** File containing the match. */
  entry: FileSystem.Entry,
  /** One-based line number containing the match. */
  line: PositiveInt,
  /** Zero-based byte offset of the match within the file. */
  offset: NonNegativeInt,
  /** Text containing the match. */
  text: Schema.String,
  /** Match ranges within the returned text. */
  submatches: Schema.Array(Submatch),
}) {}

export class Error extends Schema.TaggedErrorClass<Error>()("Search.Error", {
  /** Underlying search backend failure. */
  cause: Schema.Defect,
}) {}

export interface Interface {
  readonly find: (input: FindInput) => Effect.Effect<readonly FileSystem.Entry[], Error>
  readonly glob: (input: GlobInput) => Effect.Effect<readonly FileSystem.Entry[], Error>
  readonly grep: (input: GrepInput) => Effect.Effect<readonly Match[], Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Search") {}

export const ripgrepLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const ripgrep = yield* Ripgrep.Service
    const fs = yield* FSUtil.Service
    const scope = yield* Scope.Scope
    const cache = new Map<
      string,
      {
        files: string[]
        directories: string[]
        scan?: Fiber.Fiber<void, Error>
      }
    >()
    return Service.of({
      find: (input) =>
        Effect.gen(function* () {
          const cwd = FSUtil.resolve(input.cwd)
          const existing = cache.get(cwd)
          const result =
            existing ??
            (yield* Effect.gen(function* () {
              const state = {
                files: [] as string[],
                directories: [] as string[],
                scan: undefined as Fiber.Fiber<void, Error> | undefined,
              }
              state.scan = yield* (cwd === Global.Path.home
                ? Effect.gen(function* () {
                    const ignored = new Set([
                      "node_modules",
                      "dist",
                      "build",
                      "target",
                      "vendor",
                      ...(process.platform === "darwin" ? ["Library"] : []),
                      ...(process.platform === "win32" ? ["AppData"] : []),
                    ])
                    const top = yield* fs.readDirectoryEntries(cwd).pipe(Effect.catch(() => Effect.succeed([])))
                    state.directories = yield* Effect.forEach(
                      top.filter(
                        (entry) => entry.type === "directory" && !entry.name.startsWith(".") && !ignored.has(entry.name),
                      ),
                      (entry) =>
                        fs.readDirectoryEntries(path.join(cwd, entry.name)).pipe(
                          Effect.catch(() => Effect.succeed([])),
                          Effect.map((children) => [
                            entry.name + path.sep,
                            ...children
                              .filter(
                                (child) =>
                                  child.type === "directory" &&
                                  !child.name.startsWith(".") &&
                                  !ignored.has(child.name),
                              )
                              .map((child) => path.join(entry.name, child.name) + path.sep),
                          ]),
                        ),
                      { concurrency: "unbounded" },
                    ).pipe(Effect.map((entries) => entries.flat()))
                  })
                : ripgrep.files({ cwd, pattern: "*", limit: Number.MAX_SAFE_INTEGER }).pipe(
                    Effect.tap((result) =>
                      Effect.sync(() => {
                        state.files = result.items.map((item) => item.replaceAll("\\", "/"))
                        state.directories = Array.from(
                          new Set(
                            state.files.flatMap((file) => {
                              const parts = file.split("/")
                              return parts
                                .slice(0, -1)
                                .map((_, index) => parts.slice(0, index + 1).join("/") + path.sep)
                            }),
                          ),
                        )
                      }),
                    ),
                    Effect.asVoid,
                  )
              ).pipe(Effect.mapError((cause) => new Error({ cause })), Effect.forkIn(scope))
              cache.set(cwd, state)
              return state
            }))
          if (cwd === Global.Path.home && result.scan) yield* Fiber.join(result.scan)
          const items =
            input.type === "file"
              ? result.files
              : input.type === "directory"
                ? result.directories
                : [...result.files, ...result.directories]
          const query = input.query.trim()
          const selected = query
            ? fuzzysort.go(query, items, { limit: input.limit ?? Number.MAX_SAFE_INTEGER }).map((item) => item.target)
            : items.slice(0, input.limit ?? Number.MAX_SAFE_INTEGER)
          return selected.map((value) => {
            const type = value.endsWith(path.sep) ? ("directory" as const) : ("file" as const)
            const absolute = path.resolve(cwd, value)
            return new FileSystem.Entry({
              path: RelativePath.make(value),
              uri: pathToFileURL(absolute).href,
              type,
              mime: type === "directory" ? "application/x-directory" : FSUtil.mimeType(absolute),
            })
          })
        }),
      glob: (input) =>
        ripgrep.files({ cwd: input.cwd, pattern: input.pattern, limit: input.limit ?? Number.MAX_SAFE_INTEGER }).pipe(
          Effect.map((result) =>
            result.items.map((value) => {
              const absolute = path.resolve(input.cwd, value)
              return new FileSystem.Entry({
                path: RelativePath.make(path.relative(input.cwd, absolute).replaceAll("\\", "/")),
                uri: pathToFileURL(absolute).href,
                type: "file",
                mime: FSUtil.mimeType(absolute),
              })
            }),
          ),
          Effect.mapError((cause) => new Error({ cause })),
        ),
      grep: (input) =>
        ripgrep
          .grep({
            cwd: input.cwd,
            pattern: input.pattern,
            include: input.include,
            limit: input.limit ?? Number.MAX_SAFE_INTEGER,
          })
          .pipe(
            Effect.map((result) =>
              result.items.map(
                (match) =>
                  new Match({
                    entry: new FileSystem.Entry({
                      path: RelativePath.make(match.path.text.replaceAll("\\", "/")),
                      uri: pathToFileURL(path.resolve(input.cwd, match.path.text)).href,
                      type: "file",
                      mime: FSUtil.mimeType(match.path.text),
                    }),
                    line: match.line_number,
                    offset: match.absolute_offset,
                    text: match.lines.text.length > 2_000 ? match.lines.text.slice(0, 2_000) + "..." : match.lines.text,
                    submatches: match.submatches.map((submatch) => ({
                      text: submatch.match.text,
                      start: submatch.start,
                      end: submatch.end,
                    })),
                  }),
              ),
            ),
            Effect.mapError((cause) => new Error({ cause })),
          ),
    })
  }),
)

export const fffLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const pickers = new Map<string, Fff.Picker>()
    yield* Effect.addFinalizer(() =>
      Effect.forEach(pickers.values(), (picker) => Effect.sync(() => picker.destroy()).pipe(Effect.ignore), {
        discard: true,
      }),
    )

    const picker = Effect.fnUntraced(function* (cwd: string) {
      const root = FSUtil.resolve(cwd)
      const existing = pickers.get(root)
      if (existing) return existing
      const result = yield* Effect.try({
        try: () => Fff.create({ basePath: root, aiMode: true }),
        catch: (cause) => new Error({ cause }),
      })
      if (!result.ok) return yield* new Error({ cause: result.error })
      const scanned = yield* Effect.tryPromise({
        try: () => result.value.waitForScan(5_000),
        catch: (cause) => new Error({ cause }),
      })
      if (!scanned.ok || !scanned.value) {
        result.value.destroy()
        return yield* new Error({ cause: scanned.ok ? "fff scan timed out" : scanned.error })
      }
      pickers.set(root, result.value)
      return result.value
    })

    return Service.of({
      find: (input) =>
        picker(input.cwd).pipe(
          Effect.flatMap(
            Effect.fnUntraced(function* (picker) {
              const options = { pageIndex: 0, pageSize: input.limit }
              const result = yield* Effect.try({
                try: () => {
                  if (input.type === "file") {
                    const result = picker.fileSearch(input.query.trim(), options)
                    if (!result.ok) throw new globalThis.Error(result.error)
                    return result.value.items.map((item) => ({
                      relativePath: item.relativePath,
                      type: "file" as const,
                    }))
                  }
                  if (input.type === "directory") {
                    const result = picker.directorySearch(input.query.trim(), options)
                    if (!result.ok) throw new globalThis.Error(result.error)
                    return result.value.items.map((item) => ({
                      relativePath: item.relativePath,
                      type: "directory" as const,
                    }))
                  }
                  const result = picker.mixedSearch(input.query.trim(), options)
                  if (!result.ok) throw new globalThis.Error(result.error)
                  return result.value.items.map((item) => ({ relativePath: item.item.relativePath, type: item.type }))
                },
                catch: (cause) => new Error({ cause }),
              })
              return result.map((item) => {
                const relativePath = item.relativePath.replaceAll("\\", "/").replace(/\/$/, "")
                const absolute = path.resolve(input.cwd, relativePath)
                return new FileSystem.Entry({
                  path: RelativePath.make(relativePath + (item.type === "directory" ? path.sep : "")),
                  uri: pathToFileURL(absolute).href,
                  type: item.type,
                  mime: item.type === "directory" ? "application/x-directory" : FSUtil.mimeType(absolute),
                })
              })
            }),
          ),
        ),
      glob: (input) =>
        picker(input.cwd).pipe(
          Effect.flatMap((picker) => {
            return Effect.try({
              try: () => picker.glob(input.pattern.replaceAll("\\", "/"), { pageIndex: 0, pageSize: input.limit }),
              catch: (cause) => new Error({ cause }),
            }).pipe(
              Effect.flatMap((result) =>
                result.ok ? Effect.succeed(result.value.items) : Effect.fail(new Error({ cause: result.error })),
              ),
            )
          }),
          Effect.map((result) =>
            result.map((item) => {
              const absolute = path.resolve(input.cwd, item.relativePath)
              return new FileSystem.Entry({
                path: RelativePath.make(item.relativePath.replaceAll("\\", "/")),
                uri: pathToFileURL(absolute).href,
                type: "file",
                mime: FSUtil.mimeType(absolute),
              })
            }),
          ),
        ),
      grep: (input) =>
        picker(input.cwd).pipe(
          Effect.flatMap((picker) => {
            return Effect.try({
              try: () =>
                picker.grep([input.include, input.pattern].filter((value) => value !== undefined).join(" "), {
                  mode: "regex",
                  pageSize: input.limit,
                  timeBudgetMs: 1_500,
                }),
              catch: (cause) => new Error({ cause }),
            }).pipe(
              Effect.flatMap((result) => {
                if (!result.ok) return Effect.fail(new Error({ cause: result.error }))
                if (result.value.regexFallbackError)
                  return Effect.fail(new Error({ cause: result.value.regexFallbackError }))
                return Effect.succeed(result.value.items)
              }),
            )
          }),
          Effect.map((result) =>
            result.map((match) => {
              const bytes = Buffer.from(match.lineContent)
              return new Match({
                entry: new FileSystem.Entry({
                  path: RelativePath.make(match.relativePath.replaceAll("\\", "/")),
                  uri: pathToFileURL(path.resolve(input.cwd, match.relativePath)).href,
                  type: "file",
                  mime: FSUtil.mimeType(match.relativePath),
                }),
                line: match.lineNumber,
                offset: match.byteOffset,
                text: match.lineContent.length > 2_000 ? match.lineContent.slice(0, 2_000) + "..." : match.lineContent,
                submatches: match.matchRanges.map(([start, end]) => ({
                  text: bytes.subarray(start, end).toString("utf8"),
                  start,
                  end,
                })),
              })
            }),
          ),
        ),
    })
  }),
)

export const layer = Layer.unwrap(
  Effect.sync(() => {
    return ripgrepLayer
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Ripgrep.defaultLayer), Layer.provide(FSUtil.defaultLayer))
