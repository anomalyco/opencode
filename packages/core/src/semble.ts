export * as Semble from "./semble"

import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import path from "path"
import { makeGlobalNode } from "./effect/app-node"
import { AppProcess } from "./process"
import { Ripgrep } from "./ripgrep"
import { PositiveInt } from "./schema"

export const SembleChunk = Schema.Struct({
  file: Schema.String.annotate({ description: "Relative file path of the matched code chunk" }),
  startLine: PositiveInt.annotate({ description: "Starting line number (1-indexed)" }),
  endLine: PositiveInt.annotate({ description: "Ending line number (1-indexed)" }),
  score: Schema.Number.annotate({ description: "Relevance score from hybrid RRF ranking" }),
  content: Schema.String.annotate({ description: "Syntax-aware code chunk content" }),
  type: Schema.optional(Schema.String).annotate({ description: "Syntactic AST node type (e.g. function, class, method)" }),
})

export type SembleChunk = typeof SembleChunk.Type

export class Error extends Schema.TaggedErrorClass<Error>()("Semble.Error", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface SearchInput {
  readonly cwd: string
  readonly query: string
  readonly limit?: number
  readonly maxTokens?: number
  readonly maxCharacters?: number
  readonly path?: string
  readonly signal?: AbortSignal
}

export interface Interface {
  readonly isAvailable: () => Effect.Effect<boolean>
  readonly search: (input: SearchInput) => Effect.Effect<readonly SembleChunk[], Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Semble") {}

const failure = (message: string, cause?: unknown) => new Error({ message, cause })

const RawSembleOutput = Schema.Array(
  Schema.Struct({
    file_path: Schema.optional(Schema.String),
    file: Schema.optional(Schema.String),
    path: Schema.optional(Schema.String),
    start_line: Schema.optional(Schema.Number),
    startLine: Schema.optional(Schema.Number),
    end_line: Schema.optional(Schema.Number),
    endLine: Schema.optional(Schema.Number),
    score: Schema.optional(Schema.Number),
    content: Schema.optional(Schema.String),
    code: Schema.optional(Schema.String),
    type: Schema.optional(Schema.String),
  }),
)

export const parseSembleJson = (raw: string, cwd: string): Effect.Effect<readonly SembleChunk[], Error> =>
  Effect.gen(function* () {
    const trimmed = raw.trim()
    if (!trimmed) return []

    // Try finding JSON array or objects within output
    const jsonStart = trimmed.indexOf("[")
    const jsonEnd = trimmed.lastIndexOf("]")
    const jsonStr = jsonStart >= 0 && jsonEnd > jsonStart ? trimmed.slice(jsonStart, jsonEnd + 1) : trimmed

    const parsed = yield* Effect.try({
      try: () => JSON.parse(jsonStr) as unknown,
      catch: (cause) => failure("Failed to parse Semble JSON output", cause),
    })

    const decode = Schema.decodeUnknownOption(RawSembleOutput)
    const option = decode(parsed)
    if (option._tag !== "Some") {
      return []
    }

    return option.value.map((item, idx) => {
      const rawPath = item.file_path || item.file || item.path || `chunk_${idx}`
      const relPath = path.isAbsolute(rawPath) ? path.relative(cwd, rawPath) : rawPath
      const start = item.start_line || item.startLine || 1
      const end = item.end_line || item.endLine || start
      const score = item.score ?? 1.0
      const content = item.content || item.code || ""
      return {
        file: relPath.replaceAll("\\", "/"),
        startLine: Math.max(1, Math.floor(start)),
        endLine: Math.max(start, Math.floor(end)),
        score,
        content,
        type: item.type,
      }
    })
  })

/**
 * Dynamically packs and bounds chunks based on requested token or character limits.
 */
export function applyBudgetLimits(
  chunks: readonly SembleChunk[],
  options?: { maxTokens?: number; maxCharacters?: number; limit?: number },
): readonly SembleChunk[] {
  if (!options) return chunks

  let result = chunks
  if (options.limit && options.limit > 0) {
    result = result.slice(0, options.limit)
  }

  const charBudget = options.maxCharacters ?? (options.maxTokens ? options.maxTokens * 4 : undefined)
  if (charBudget === undefined) return result

  let accumulated = 0
  const budgeted: SembleChunk[] = []
  for (const chunk of result) {
    const chunkChars = chunk.content.length + chunk.file.length + 50
    if (budgeted.length > 0 && accumulated + chunkChars > charBudget) {
      break
    }
    budgeted.push(chunk)
    accumulated += chunkChars
  }

  return budgeted
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const process = yield* AppProcess.Service
    const ripgrep = yield* Ripgrep.Service

    const isAvailable = () =>
      Effect.gen(function* () {
        const direct = yield* process
          .run(ChildProcess.make("semble", ["--version"]))
          .pipe(
            Effect.map((res) => res.exitCode === 0),
            Effect.catch(() => Effect.succeed(false)),
          )
        if (direct) return true

        return yield* process
          .run(ChildProcess.make("uvx", ["--from", "semble[mcp]", "semble", "--version"]))
          .pipe(
            Effect.map((res) => res.exitCode === 0),
            Effect.catch(() => Effect.succeed(false)),
          )
      })

    const runSembleSearch = (input: SearchInput) =>
      Effect.gen(function* () {
        const targetDir = input.path ? path.resolve(input.cwd, input.path) : input.cwd
        const fetchCount = input.limit ? Math.max(input.limit, 10) : 20

        // Attempt 1: Run local `semble search`
        const localRun = yield* process
          .run(
            ChildProcess.make(
              "semble",
              ["search", input.query, "--limit", String(fetchCount), "--json"],
              { cwd: targetDir },
            ),
            { signal: input.signal, timeout: "15 seconds" },
          )
          .pipe(
            Effect.map((res) => res.stdout.toString("utf8")),
            Effect.catch(() => Effect.succeed(undefined)),
          )

        if (localRun) {
          const parsed = yield* parseSembleJson(localRun, input.cwd)
          if (parsed.length > 0) return parsed
        }

        // Attempt 2: Run via uvx if local command wasn't present
        const uvxRun = yield* process
          .run(
            ChildProcess.make(
              "uvx",
              ["--from", "semble[mcp]", "semble", "search", input.query, "--limit", String(fetchCount), "--json"],
              { cwd: targetDir },
            ),
            { signal: input.signal, timeout: "30 seconds" },
          )
          .pipe(
            Effect.map((res) => res.stdout.toString("utf8")),
            Effect.catch(() => Effect.succeed(undefined)),
          )

        if (uvxRun) {
          const parsed = yield* parseSembleJson(uvxRun, input.cwd)
          if (parsed.length > 0) return parsed
        }

        return undefined
      })

    const fallbackRipgrep = (input: SearchInput) =>
      Effect.gen(function* () {
        const count = input.limit ?? 10
        const matches = yield* ripgrep
          .grep({
            cwd: input.cwd,
            pattern: input.query.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&"),
            limit: count,
            signal: input.signal,
          })
          .pipe(
            Effect.catch(() => Effect.succeed([])),
          )

        return matches.map((m, idx) => ({
          file: m.entry.path,
          startLine: m.line,
          endLine: m.line,
          score: 1.0 - idx * 0.05,
          content: m.text,
          type: "line_match",
        }))
      })

    const search = (input: SearchInput) =>
      Effect.gen(function* () {
        const rawResults = yield* runSembleSearch(input).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        )

        const chunks = (rawResults && rawResults.length > 0) ? rawResults : yield* fallbackRipgrep(input)

        return applyBudgetLimits(chunks, {
          limit: input.limit,
          maxTokens: input.maxTokens,
          maxCharacters: input.maxCharacters,
        })
      })

    return Service.of({
      isAvailable,
      search,
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [AppProcess.node, Ripgrep.node] })
