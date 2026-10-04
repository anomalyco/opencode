import type { Argv } from "yargs"
import path from "path"
import { Effect } from "effect"
import { SemanticIndexer } from "@opencode-ai/core/semantic/indexer"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"

interface IndexArgs {
  readonly path?: string
  readonly include?: string
  readonly model?: string
  readonly batchSize?: number
  readonly maxFiles?: number
}

interface StatusArgs {
  readonly model?: string
}

const IndexCommand = effectCmd({
  command: "index [path]",
  describe: "pre-index codebase chunks into local SQLite vector cache",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("path", {
        type: "string",
        describe: "directory to index (default: current working directory)",
      })
      .option("include", {
        type: "string",
        describe: "glob pattern of files to index",
        default: "**/*.{ts,tsx,js,jsx,py,go,rs,md}",
      })
      .option("model", {
        type: "string",
        describe: "embedding model name",
        default: process.env.OPENCODE_EMBED_MODEL || "nomic-embed-text",
      })
      .option("batch-size", {
        type: "number",
        describe: "batch size for embedding chunks",
        default: 20,
      })
      .option("max-files", {
        type: "number",
        describe: "maximum number of files to scan",
        default: 500,
      }),
  handler: Effect.fn("Cli.semantic.index")(function* (args: IndexArgs) {
    const targetDir = path.resolve(args.path ?? process.cwd())
    const indexer = yield* SemanticIndexer.Service

    UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "Starting local semantic pre-indexing..." + UI.Style.TEXT_NORMAL)
    UI.println(UI.Style.TEXT_DIM + `Target directory: ${targetDir}` + UI.Style.TEXT_NORMAL)

    const result = yield* indexer.indexDirectory({
      directory: targetDir,
      include: args.include,
      model: args.model,
      batchSize: args.batchSize,
      maxFiles: args.maxFiles,
    })

    if (!result.ok) {
      UI.println(
        UI.Style.TEXT_DANGER_BOLD +
          "✗ Semantic indexing failed: " +
          UI.Style.TEXT_NORMAL +
          (result.error ?? "Unknown error"),
      )
      UI.println(
        UI.Style.TEXT_DIM +
          `Ensure Ollama is running ('ollama serve') and model is available ('ollama pull ${args.model ?? "nomic-embed-text"}').` +
          UI.Style.TEXT_NORMAL,
      )
      return yield* fail(result.error ?? "Semantic indexing failed")
    }

    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ Semantic indexing completed successfully" + UI.Style.TEXT_NORMAL)
    UI.println(`  Directory:      ${UI.Style.TEXT_HIGHLIGHT}${result.directory}${UI.Style.TEXT_NORMAL}`)
    UI.println(`  Files scanned:  ${result.totalFiles} (${result.indexedFiles} indexed)`)
    UI.println(`  Total chunks:   ${result.totalChunks}`)
    UI.println(`  Cache hits:     ${result.cachedChunks} (already cached in SQLite, $0 remote tokens)`)
    UI.println(`  New embeddings: ${result.newChunks} chunks embedded in local hardware`)
    UI.println(`  Duration:       ${result.durationMs.toFixed(1)} ms`)
  }),
})

const StatusCommand = effectCmd({
  command: "status",
  describe: "show status of local vector cache and embedding provider",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.option("model", {
      type: "string",
      describe: "embedding model to check",
      default: process.env.OPENCODE_EMBED_MODEL || "nomic-embed-text",
    }),
  handler: Effect.fn("Cli.semantic.status")(function* (args: StatusArgs) {
    const indexer = yield* SemanticIndexer.Service
    const res = yield* indexer.status(args.model)

    UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "=== Local Semantic Search Status ===" + UI.Style.TEXT_NORMAL)
    UI.println(`  Model:           ${UI.Style.TEXT_HIGHLIGHT}${res.model}${UI.Style.TEXT_NORMAL}`)
    UI.println(
      `  Ollama Provider: ${
        res.available
          ? UI.Style.TEXT_SUCCESS_BOLD + "Online (Ollama)" + UI.Style.TEXT_NORMAL
          : UI.Style.TEXT_WARNING_BOLD + "Offline (Fallback to regex search active)" + UI.Style.TEXT_NORMAL
      }`,
    )
    UI.println(
      `  Cached Chunks:   ${res.modelCached} (for ${res.model}) / ${res.totalCached} (total across all models)`,
    )
  }),
})

export const SemanticCommand = effectCmd({
  command: "semantic",
  describe: "local semantic code search and indexing tools",
  instance: false,
  builder: (yargs: Argv) => yargs.command(IndexCommand).command(StatusCommand).demandCommand(),
  handler: Effect.fn("Cli.semantic")(function* () {}),
})
