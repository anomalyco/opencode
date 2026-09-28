import fs from "fs/promises"
import path from "path"
import { Effect, Logger, References, Schema } from "effect"
import { ToolFailure } from "@opencode-ai/llm"
import type { Ripgrep } from "@opencode-ai/core/ripgrep"
import type { RunToolContext } from "../contract"
import GLOB from "@/tool/glob.txt"
import GREP from "@/tool/grep.txt"
import { define } from "./fs"

const LIMIT = 100
const MAX_LINE = 2000
const PATH_DESCRIPTION =
  "The directory to search in. Defaults to the current working directory; omit it for the default."

const GlobParameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The glob pattern to match files against" }),
  path: Schema.optional(Schema.String).annotate({ description: PATH_DESCRIPTION }),
})
const GrepParameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The regex pattern to search for in file contents" }),
  path: Schema.optional(Schema.String).annotate({ description: PATH_DESCRIPTION }),
  include: Schema.optional(Schema.String).annotate({
    description: 'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")',
  }),
})

export function searchTools(ctx: RunToolContext) {
  const resolve = (dir: string | undefined) => path.resolve(ctx.cwd, dir ?? ".")
  return [
    define({
      name: "glob",
      description: GLOB,
      parameters: GlobParameters,
      readOnly: true,
      access: (params) => ({ permission: "glob", patterns: [params.pattern], always: ["*"] }),
      summarize: (params) => `glob ${params.pattern}`,
      paths: (params) => [{ path: resolve(params.path), kind: "directory" }],
      execute: (params) =>
        Effect.gen(function* () {
          const dir = resolve(params.path)
          const stat = yield* Effect.promise(() => fs.stat(dir).catch(() => undefined))
          if (stat?.isFile()) return yield* new ToolFailure({ message: `glob path must be a directory: ${dir}` })
          const files = yield* ripgrep((rg) => rg.glob({ cwd: dir, pattern: params.pattern, limit: LIMIT }))
          if (files.length === 0) return "No files found"
          const truncated =
            files.length === LIMIT
              ? [
                  "",
                  `(Results are truncated: showing first ${LIMIT} results. Consider using a more specific path or pattern.)`,
                ]
              : []
          return [...files.map((file) => path.resolve(dir, file.path)), ...truncated].join("\n")
        }),
    }),
    define({
      name: "grep",
      description: GREP,
      parameters: GrepParameters,
      readOnly: true,
      access: (params) => ({ permission: "grep", patterns: [params.pattern], always: ["*"] }),
      summarize: (params) => `grep ${params.pattern}`,
      paths: (params) => [{ path: resolve(params.path), kind: "directory" }],
      execute: (params) =>
        Effect.gen(function* () {
          const target = resolve(params.path)
          const stat = yield* Effect.promise(() => fs.stat(target).catch(() => undefined))
          const dir = stat?.isFile() ? path.dirname(target) : target
          const found = yield* ripgrep((rg) =>
            rg.grep({
              cwd: dir,
              pattern: params.pattern,
              include: stat?.isFile() ? path.basename(target) : params.include,
              limit: LIMIT,
            }),
          )
          if (found.length === 0) return "No files found"
          const groups = Map.groupBy(found, (match) => path.resolve(dir, match.entry.path))
          const lines = [...groups].flatMap(([file, matches], index) => [
            ...(index ? [""] : []),
            `${file}:`,
            ...matches.map((match) => `  Line ${match.line}: ${match.text.replace(/\r?\n$/, "").slice(0, MAX_LINE)}`),
          ])
          const more = found.length === LIMIT
          return [
            `Found ${found.length} matches${more ? " (more matches available)" : ""}`,
            ...lines,
            ...(more ? ["", "(Results truncated. Consider using a more specific path or pattern.)"] : []),
          ].join("\n")
        }),
    }),
  ]
}

// Ripgrep (binary resolution + process layer) costs ~0.2 s to import, so it loads on the first search only.
function ripgrep<A>(use: (rg: Ripgrep.Interface) => Effect.Effect<A, Ripgrep.Error | Ripgrep.InvalidPatternError>) {
  return Effect.gen(function* () {
    const { Ripgrep } = yield* Effect.promise(() => import("@opencode-ai/core/ripgrep"))
    const { LayerNode } = yield* Effect.promise(() => import("@opencode-ai/core/effect/layer-node"))
    const service = Effect.gen(function* () {
      const rg = yield* Ripgrep.Service
      return yield* use(rg)
    })
    // The binary layer logs "downloading ripgrep" on first use; stdout belongs to the answer, so logs go to stderr.
    return yield* service.pipe(
      Effect.provide(LayerNode.compile(Ripgrep.node)),
      Effect.provideService(References.CurrentLoggers, new Set([Logger.withConsoleError(Logger.formatLogFmt)])),
    )
  }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
}
