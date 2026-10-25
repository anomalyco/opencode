import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { SemanticRank } from "./semantic-rank"
import DESCRIPTION from "./semantic-search.txt"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import { FSUtil } from "@bolt-ai/core/fs-util"
import { Ripgrep } from "@bolt-ai/core/ripgrep"

const MAX_FILES = 4000
const MAX_FILE_BYTES = 200_000
const DEFAULT_LIMIT = 8

const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".go",
  ".rs",
  ".py",
  ".rb",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".cs",
  ".php",
  ".scala",
  ".sh",
  ".bash",
  ".zig",
  ".lua",
  ".sql",
  ".html",
  ".css",
  ".scss",
  ".vue",
  ".svelte",
  ".md",
  ".yml",
  ".yaml",
  ".toml",
])

export const Parameters = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: 'What to look for, described by meaning (e.g. "where sessions get refreshed")',
  }),
  path: Schema.optional(Schema.String).annotate({
    description: "Directory to scope the search to. Defaults to the current working directory.",
  }),
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))).annotate({
    description: "Maximum number of results to return. Defaults to 8.",
  }),
})

export const SemanticSearchTool = Tool.define(
  "semantic_search",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const root = args.path
            ? path.isAbsolute(args.path)
              ? args.path
              : path.join(instance.directory, args.path)
            : instance.directory
          yield* assertExternalDirectoryEffect(ctx, root, { bypass: false, kind: "directory" })

          yield* ctx.ask({
            permission: "semantic_search",
            patterns: [args.query],
            always: ["*"],
            metadata: { query: args.query, path: root },
          })

          const dir = yield* fs.isDir(root)
          if (!dir) throw new Error(`Directory not found: ${root}`)

          const entries = yield* ripgrep.find({ cwd: root, pattern: "*", limit: MAX_FILES })
          const targets = entries
            .map((entry) => path.join(root, entry.path))
            .filter((file) => EXTENSIONS.has(path.extname(file)))

          const nested = yield* Effect.forEach(
            targets,
            (file) =>
              Effect.promise(async () => {
                const handle = Bun.file(file)
                if (handle.size > MAX_FILE_BYTES) return []
                const text = await handle.text().catch(() => "")
                if (!text) return []
                return SemanticRank.chunk(path.relative(instance.worktree, file) || file, text)
              }),
            { concurrency: 16 },
          )
          const chunks = nested.flat()

          const limit = args.limit ?? DEFAULT_LIMIT
          const hits = SemanticRank.rank(args.query, chunks, limit)
          const terms = SemanticRank.tokenize(args.query)

          if (hits.length === 0) {
            return {
              title: args.query,
              metadata: { files: targets.length, chunks: chunks.length, results: 0 },
              output: "No matching code found. Try different wording, or grep for exact strings.",
            }
          }

          const blocks = hits.map(
            (hit) =>
              `${hit.chunk.file}:${hit.chunk.start}-${hit.chunk.end} (score ${hit.score.toFixed(2)})\n${SemanticRank.snippet(hit.chunk, terms)}`,
          )
          return {
            title: args.query,
            metadata: { files: targets.length, chunks: chunks.length, results: hits.length },
            output: [`Top ${hits.length} result${hits.length === 1 ? "" : "s"}:`, ...blocks].join("\n\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
