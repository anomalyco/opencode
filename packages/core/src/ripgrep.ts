export * as Ripgrep from "./ripgrep"

import { Context, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { Command } from "effect/unstable/process/ChildProcess"
import { Entry, Match } from "@opencode-ai/schema/filesystem"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { AppProcess, collectStream, waitForAbort } from "@opencode-ai/util/process"
import { NonNegativeInt, PositiveInt, RelativePath } from "./schema"
import { RipgrepBinary } from "./ripgrep/binary"
import { WorkspaceEnvironment } from "./workspace/environment"

/**
 * Small core-owned ripgrep execution adapter. It deliberately exposes raw
 * process-oriented rows, not model text or permission behavior. Search maps
 * these rows into filesystem results; leaf tools own
 * presentation and permission prompts.
 */

const ERROR_BYTES = 8 * 1024
const MAX_SUBMATCHES = 100

/**
 * Provider-side kill for hosted searches, since hosted process kill is not
 * implemented. Kept below FileSystem.DEFAULT_SEARCH_TIMEOUT_MS so the sandbox
 * process dies before the caller's timeout fires.
 */
export const HOSTED_KILL_TIMEOUT_SECONDS = 29

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
const decodeJsonRecord = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)

type RawMatchData = (typeof RawMatch.Type)["data"]

export class Error extends Schema.TaggedErrorClass<Error>()("Ripgrep.Error", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class InvalidPatternError extends Schema.TaggedErrorClass<InvalidPatternError>()("Ripgrep.InvalidPatternError", {
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
  readonly limit: number
  readonly signal?: AbortSignal
}

export interface Interface {
  readonly find: (input: FindInput) => Effect.Effect<readonly Entry[], Error>
  readonly glob: (input: GlobInput) => Effect.Effect<readonly Entry[], Error>
  readonly grep: (input: GrepInput) => Effect.Effect<readonly Match[], Error | InvalidPatternError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Ripgrep") {}

const failure = (message: string, cause?: unknown) => new Error({ message, cause })

const isInvalidPattern = (stderr: string) =>
  stderr.includes("regex parse error") || stderr.includes("error parsing regex")

const normalizeRelativePath = (value: string) =>
  value
    .replace(/^(?:\.[\\/])+/u, "")
    .replace(/^[\\/]+/u, "")
    .replaceAll("\\", "/")

interface Backend {
  readonly spawn: AppProcess.Interface["spawn"]
  readonly awaitTruncated: boolean
  readonly command: (input: {
    readonly cwd: string
    readonly args: string[]
    readonly limit: number
    readonly output: "lines" | "matches"
  }) => Effect.Effect<Command, globalThis.Error>
}

const make = (backend: Backend) => {
  const run = <A>(input: {
    readonly cwd: string
    readonly args: string[]
    readonly limit: number
    readonly signal?: AbortSignal
    readonly parse: (line: string) => Effect.Effect<A | undefined, Error>
    readonly output: "lines" | "matches"
    readonly pattern?: string
    readonly onItem?: (item: A) => Effect.Effect<void>
  }) => {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* backend.spawn(yield* backend.command(input))
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
          Effect.map((chunk) => [...chunk]),
        )
        const truncated = rows.length > input.limit
        if (truncated) {
          if (backend.awaitTruncated)
            yield* Effect.all([handle.exitCode, Fiber.join(stderrFiber)], { concurrency: "unbounded" })
          return { items: rows.slice(0, input.limit), truncated, partial: false }
        }

        const code = yield* handle.exitCode
        const stderr = yield* Fiber.join(stderrFiber)
        if (input.pattern && code === 2 && isInvalidPattern(stderr)) {
          return yield* new InvalidPatternError({ pattern: input.pattern, message: stderr.trim() })
        }
        if (code !== 0 && code !== 1 && code !== 2) {
          return yield* failure(stderr.trim() || `ripgrep failed with code ${code}`)
        }
        return { items: code === 1 ? [] : rows, truncated: false, partial: code === 2 }
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
    glob: (input) =>
      run<string>({
        cwd: input.cwd,
        limit: input.limit,
        signal: input.signal,
        output: "lines",
        args: [
          "--no-config",
          "--files",
          ...(input.hidden ? ["--hidden"] : []),
          ...(input.follow ? ["--follow"] : []),
          `--glob=${input.pattern}`,
          "--glob=!**/.git/**",
          ".",
        ],
        parse: (line) => Effect.succeed(normalizeRelativePath(line)),
      }).pipe(
        Effect.map((result) =>
          result.items.map((relative) =>
            Entry.make({
              path: RelativePath.make(relative),
              type: "file",
            }),
          ),
        ),
        Effect.catchTag("Ripgrep.InvalidPatternError", (cause) => Effect.fail(failure(cause.message, cause))),
      ),
    find: (input) =>
      run<Entry>({
        cwd: input.cwd,
        limit: input.limit,
        signal: input.signal,
        output: "lines",
        args: [
          "--no-config",
          "--files",
          ...(input.hidden ? ["--hidden"] : []),
          ...(input.follow ? ["--follow"] : []),
          ...(input.pattern === "*" ? [] : [`--glob=${input.pattern}`]),
          ...(input.exclude ?? []).map((pattern) => `--glob=!${pattern}`),
          "--glob=!**/.git/**",
          ".",
        ],
        parse: (line) => {
          return Effect.succeed(
            Entry.make({
              path: RelativePath.make(normalizeRelativePath(line)),
              type: "file",
            }),
          )
        },
        onItem: input.onEntry,
      }).pipe(
        Effect.map((result) => result.items),
        Effect.catchTag("Ripgrep.InvalidPatternError", (cause) => Effect.fail(failure(cause.message, cause))),
      ),
    grep: (input) =>
      run<RawMatchData>({
        ...input,
        output: "matches",
        args: [
          "--no-config",
          "--json",
          "--hidden",
          "--no-messages",
          ...(input.include ? [`--glob=${input.include}`] : []),
          "--glob=!**/.git/**",
          "--",
          input.pattern,
          input.file ?? ".",
        ],
        parse: (line) =>
          decodeJsonRecord(line).pipe(
            Effect.mapError((cause) => failure("Invalid ripgrep JSON output", cause)),
            Effect.flatMap((json) => {
              if (!json || typeof json !== "object" || !("type" in json) || json.type !== "match")
                return Effect.succeed(undefined)
              return Schema.decodeUnknownEffect(RawMatch)(json).pipe(
                Effect.map((match) => ({
                  ...match.data,
                  submatches: match.data.submatches.slice(0, MAX_SUBMATCHES),
                })),
                Effect.mapError((cause) => failure("Invalid ripgrep match output", cause)),
              )
            }),
          ),
      }).pipe(
        Effect.map((result) =>
          result.items.map((match) => {
            return Match.make({
              entry: Entry.make({
                path: RelativePath.make(normalizeRelativePath(match.path.text)),
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
            })
          }),
        ),
      ),
  })
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const process = yield* AppProcess.Service
    const binary = yield* RipgrepBinary.Service
    return make({
      spawn: (command) => process.spawn(command),
      awaitTruncated: false,
      command: (input) =>
        binary.filepath.pipe(
          Effect.map((executable) =>
            ChildProcess.make(executable, input.args, {
              cwd: input.cwd,
              extendEnv: true,
              stdin: "ignore",
            }),
          ),
        ),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [RipgrepBinary.node, AppProcess.node] })

export const hostedNode = makeLocationNode({
  service: Service,
  layer: Layer.effect(
    Service,
    Effect.gen(function* () {
      const env = yield* WorkspaceEnvironment.Service
      return make({
        spawn: (command) => env.process.spawn(command),
        awaitTruncated: true,
        command: (input) =>
          Effect.succeed(
            ChildProcess.make(
              env.shell.executable,
              [
                ...env.shell.args(
                  input.output === "lines"
                    ? `set -o pipefail; limit=$1; shift; timeout --signal=KILL ${HOSTED_KILL_TIMEOUT_SECONDS}s rg "$@" | head -n "$limit"`
                    : `set -o pipefail; limit=$1; shift; timeout --signal=KILL ${HOSTED_KILL_TIMEOUT_SECONDS}s rg "$@" | awk -v limit="$limit" '{ print } /"type":"match"/ { if (++matches >= limit) exit }'`,
                ),
                "opencode-ripgrep",
                String(input.limit + 1),
                ...input.args,
              ],
              {
                cwd: input.cwd,
                env: env.shell.environmentOverrides,
                extendEnv: false,
                detached: env.shell.detached,
                stdin: "ignore",
              },
            ),
          ),
      })
    }),
  ),
  deps: [WorkspaceEnvironment.node],
})
