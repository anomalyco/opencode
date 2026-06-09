export * as Search from "./index"

import path from "path"
import { pathToFileURL } from "url"
import { Context, Effect, Layer, Schema } from "effect"
import { Fff } from "#fff"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Ripgrep } from "../ripgrep"
import { AbsolutePath, NonNegativeInt, PositiveInt, RelativePath } from "../schema"

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
  readonly glob: (input: GlobInput) => Effect.Effect<readonly FileSystem.Entry[], Error>
  readonly grep: (input: GrepInput) => Effect.Effect<readonly Match[], Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Search") {}

export const ripgrepLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const ripgrep = yield* Ripgrep.Service
    return Service.of({
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

export const defaultLayer = layer.pipe(Layer.provide(Ripgrep.defaultLayer))
