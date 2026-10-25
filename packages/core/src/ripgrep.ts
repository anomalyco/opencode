export * as Ripgrep from "./ripgrep.js"

import fs from "node:fs"
import path from "node:path"
import { Context, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Entry, Match } from "@bolt-ai/schema/filesystem"
import { makeGlobalNode } from "./effect/app-node"
import { AppProcess, collectStream, waitForAbort } from "./process"
import { NonNegativeInt, PositiveInt, RelativePath } from "./schema"
import { RipgrepBinary } from "./ripgrep/binary"

/**
 * Small core-owned ripgrep execution adapter. It deliberately exposes raw
 * process-oriented rows, not model text or permission behavior. Search maps
 * these rows into filesystem results; leaf tools own
 * presentation and permission prompts.
 */

const ERROR_BYTES = 8 * 1024
const MAX_SUBMATCHES = 100

// Extra agent-only ignore rules: .boltignore uses .gitignore syntax and hides
// committed files from search without touching .gitignore. It lives at the
// repository root only. Ripgrep resolves --ignore-file patterns relative to
// its working directory, so when a search starts below the root the process
// runs from the root instead (with the walk confined to the requested
// directory) to keep root-anchored rules like `/src/generated/` correctly
// scoped. User globs and output paths are translated between the two bases.
function boltignore(cwd: string) {
  const base = root(cwd)
  const file = path.join(base, ".boltignore")
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return { cwd, args: [], search: ".", prefix: "" }
  const search = path.relative(base, cwd)
  return {
    cwd: base,
    args: [`--ignore-file=${file}`],
    search: search || ".",
    prefix: search ? `${search.replaceAll("\\", "/")}/` : "",
  }
}

function root(cwd: string) {
  let dir = cwd
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return cwd
    dir = parent
  }
}

// Whether a .boltignore governs this directory. Search backends without
// ignore-file support (fff) must fall back to ripgrep when this is true.
export function ignored(cwd: string) {
  return fs.statSync(path.join(root(cwd), ".boltignore"), { throwIfNoEntry: false })?.isFile() === true
}

// -g globs follow .gitignore rules relative to the ripgrep working directory:
// slash-less globs match basenames at any depth and survive re-basing, while
// globs with a non-trailing slash are anchored and must be re-anchored onto
// the search directory.
function reroot(glob: string, prefix: string): string {
  if (!prefix) return glob
  if (glob.startsWith("!")) return `!${reroot(glob.slice(1), prefix)}`
  if (glob.startsWith("/")) return `/${prefix}${glob.slice(1)}`
  if (glob.slice(0, -1).includes("/")) return prefix + glob
  return glob
}

// Normalizes a ripgrep output path and re-bases it from the process working
// directory back onto the requested search cwd.
function rebase(line: string, prefix: string) {
  const normalized = line.replace(/^(?:\.[\\/])+/u, "").replaceAll("\\", "/")
  const stripped = prefix && normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized
  return stripped.replace(/^\/+/u, "")
}

const RawMatch = Schema.Struct({
  type: Schema.Literal("match"),
  data: Schema.Struct({
    path: Schema.Struct({ text: Schema.String }),
    lines: Schema.Struct({ text: Schema.String }),
    line_number: PositiveInt,
    absolute_offset: NonNegativeInt,
    submatches: Schema.Array(
      Schema.Struct({
        match: Schema.Struct({ text: Schema.String }),
        start: NonNegativeInt,
        end: NonNegativeInt,
      }),
    ),
  }),
})
const decodeJsonRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

type RawMatchData = (typeof RawMatch.Type)["data"]

export class Error extends Schema.TaggedError<Error>()("Ripgrep.Error", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class InvalidPatternError extends Schema.TaggedError<InvalidPatternError>()("Ripgrep.InvalidPatternError", {
  pattern: Schema.String,
  message: Schema.String,
}) {}

export interface FindInput {
  readonly cwd: string
  readonly pattern: string
  readonly limit: number
  readonly exclude?: readonly string[]
  readonly hidden?: boolean
  readonly follow?: boolean
  readonly signal?: AbortSignal
  readonly onEntry?: (entry: Entry) => Effect.Effect<void>
}

export interface GlobInput {
  readonly cwd: string
  readonly pattern: string
  readonly limit: number
  readonly hidden?: boolean
  readonly follow?: boolean
  readonly signal?: AbortSignal
}

export interface GrepInput {
  readonly cwd: string
  readonly pattern: string
  readonly file?: string
  readonly include?: string
  readonly literal?: boolean
  readonly caseSensitive?: boolean
  readonly limit: number
  readonly signal?: AbortSignal
}

export interface Interface {
  readonly find: (input: FindInput) => Effect.Effect<readonly Entry[], Error>
  readonly glob: (input: GlobInput) => Effect.Effect<readonly Entry[], Error>
  readonly grep: (input: GrepInput) => Effect.Effect<readonly Match[], Error | InvalidPatternError>
}

export class Service extends Context.Service<Service, Interface>()("@bolt/v2/Ripgrep") {}

const failure = (message: string, cause?: unknown) => new Error({ message, cause })

const normalizePath = (value: string) =>
  value
    .replace(/^(?:\.[\\/])+/u, "")
    .replace(/^[\\/]+/u, "")
    .replaceAll("\\", "/")

const isInvalidPattern = (stderr: string) =>
  stderr.includes("regex parse error") || stderr.includes("error parsing regex")

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    const binary = yield* RipgrepBinary.Service

    const run = <A>(input: {
      readonly cwd: string
      readonly args: string[]
      readonly limit: number
      readonly signal?: AbortSignal
      readonly parse: (line: string) => Effect.Effect<A | undefined, Error>
      readonly pattern?: string
      readonly onItem?: (item: A) => Effect.Effect<void>
    }) => {
      const program = Effect.scoped(
        Effect.gen(function* () {
          // Hosted environments will resolve rg through their driver image; the spawner is the execution seam.
          const handle = yield* environment.spawner.spawn(
            ChildProcess.make(yield* binary.filepath, input.args, { cwd: input.cwd, extendEnv: true, stdin: "ignore" }),
          )
          const stderrFiber = yield* collectStream(handle.stderr, ERROR_BYTES).pipe(
            Effect.map((output) => output.buffer.toString("utf8")),
            Effect.forkScoped,
          )
          let observed = 0
          const rows = yield* Stream.decodeText(handle.stdout).pipe(
            Stream.splitLines,
            Stream.filter((line) => line.length > 0),
            Stream.mapEffect(input.parse),
            Stream.filter((row): row is A => row !== undefined),
            Stream.tap((row) => {
              if (!input.onItem || observed++ >= input.limit) return Effect.void
              return input.onItem(row)
            }),
            Stream.take(input.limit + 1),
            Stream.runCollect,
          )
          const truncated = rows.length > input.limit
          if (truncated) return rows.slice(0, input.limit)

          const code = yield* handle.exitCode
          const stderr = yield* Fiber.join(stderrFiber)
          if (input.pattern && code === 2 && isInvalidPattern(stderr)) {
            return yield* new InvalidPatternError({ pattern: input.pattern, message: stderr.trim() })
          }
          if (code !== 0 && code !== 1 && code !== 2) {
            return yield* failure(stderr.trim() || `ripgrep failed with code ${code}`)
          }
          return code === 1 ? [] : rows
        }),
      )
      const abortable = input.signal ? program.pipe(Effect.raceFirst(waitForAbort(input.signal))) : program
      return abortable.pipe(
        Effect.mapError((cause) =>
          cause instanceof Error || cause instanceof InvalidPatternError
            ? cause
            : failure("ripgrep execution failed", cause),
        ),
      )
    }

    return Service.of({
      glob: (input) => {
        const scoped = boltignore(input.cwd)
        return run<string>({
          cwd: scoped.cwd,
          limit: input.limit,
          signal: input.signal,
          args: [
            "--no-config",
            "--files",
            ...scoped.args,
            ...(input.hidden ? ["--hidden"] : []),
            ...(input.follow ? ["--follow"] : []),
            `--glob=${reroot(input.pattern, scoped.prefix)}`,
            "--glob=!**/.git/**",
            scoped.search,
          ],
          parse: (line) => Effect.succeed(rebase(line, scoped.prefix)),
        }).pipe(
          Effect.map((result) =>
            result.map((relative) =>
              Entry.make({
                path: RelativePath.make(relative),
                type: "file",
              }),
            ),
          ),
          Effect.catchTag("Ripgrep.InvalidPatternError", (cause) => Effect.fail(failure(cause.message, cause))),
        )
      },
      find: (input) => {
        const scoped = boltignore(input.cwd)
        return run<Entry>({
          cwd: scoped.cwd,
          limit: input.limit,
          signal: input.signal,
          args: [
            "--no-config",
            "--files",
            ...scoped.args,
            ...(input.hidden ? ["--hidden"] : []),
            ...(input.follow ? ["--follow"] : []),
            ...(input.pattern === "*" ? [] : [`--glob=${reroot(input.pattern, scoped.prefix)}`]),
            "--glob=!**/.git/**",
            scoped.search,
          ],
          parse: (line) =>
            Effect.succeed(
              Entry.make({
                path: RelativePath.make(rebase(line, scoped.prefix)),
                type: "file",
              }),
            ),
          onItem: input.onEntry,
        }).pipe(
          Effect.map((result) => result.items),
          Effect.catchTag("Ripgrep.InvalidPatternError", (cause) => Effect.fail(failure(cause.message, cause))),
        )
      },
      grep: (input) => {
        const scoped = boltignore(input.cwd)
        const target =
          input.file && path.isAbsolute(input.file) ? input.file : path.join(scoped.search, input.file ?? ".")
        return run<RawMatchData>({
          cwd: scoped.cwd,
          limit: input.limit,
          signal: input.signal,
          pattern: input.pattern,
          args: [
            "--no-config",
            "--json",
            "--hidden",
            "--no-messages",
            ...scoped.args,
            ...(input.include ? [`--glob=${reroot(input.include, scoped.prefix)}`] : []),
            "--glob=!**/.git/**",
            "--",
            input.pattern,
            target,
          ],
          parse: (line) =>
            decodeJsonRecord(line).pipe(
              Effect.mapError((cause) => failure("Invalid ripgrep JSON output", cause)),
              Effect.flatMap((json) => {
                if (!json || typeof json !== "object" || !("type" in json) || json.type !== "match")
                  return Effect.undefined
                return Schema.decodeUnknownEffect(RawMatch)(json).pipe(
                  Effect.map((match) => ({
                    ...match.data,
                    path: { text: normalizePath(match.data.path.text) },
                    submatches: match.data.submatches.slice(0, MAX_SUBMATCHES),
                  })),
                  Effect.mapError((cause) => failure("Invalid ripgrep match output", cause)),
                )
              }),
            ),
        }).pipe(
          Effect.map((result) =>
            result.items.map((match) => {
              const relative = rebase(match.path.text, scoped.prefix)
              return Match.make({
                entry: Entry.make({
                  path: RelativePath.make(match.path.text),
                  type: "file",
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
        )
      },
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Environment.node, RipgrepBinary.node] })
