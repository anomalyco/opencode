import { EOL } from "os"
import { Effect } from "effect"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { effectCmd } from "../../effect-cmd"
import { cmd } from "../cmd"
import { InstanceRef } from "@/effect/instance-ref"

export const RipgrepCommand = cmd({
  command: "rg",
  describe: "ripgrep debugging utilities",
  builder: (yargs) => yargs.command(FilesCommand).command(SearchCommand).demandCommand(),
  async handler() {},
})

const FilesCommand = effectCmd({
  command: "files",
  describe: "list files using ripgrep",
  builder: (yargs) =>
    yargs
      .option("query", {
        type: "string",
        description: "Filter files by query",
      })
      .option("glob", {
        type: "string",
        description: "Glob pattern to match files",
      })
      .option("limit", {
        type: "number",
        description: "Limit number of results",
      }),
  handler: Effect.fn("Cli.debug.rg.files")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const ripgrep = yield* Ripgrep.Service
    const files = yield* ripgrep
      .glob({
        cwd: ctx.directory,
        pattern: args.glob ?? "**/*",
        limit: args.limit ?? 10_000,
      })
      .pipe(Effect.orDie)
    process.stdout.write(files.map((file) => file.path).join(EOL) + EOL)
  }),
})

const SearchCommand = effectCmd({
  command: "search <pattern>",
  describe: "search file contents using ripgrep",
  builder: (yargs) =>
    yargs
      .positional("pattern", {
        type: "string",
        demandOption: true,
        description: "Search pattern",
      })
      .option("glob", {
        type: "array",
        description: "File glob patterns",
      })
      .option("limit", {
        type: "number",
        description: "Limit number of results",
      }),
  handler: Effect.fn("Cli.debug.rg.search")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const ripgrep = yield* Ripgrep.Service
    const results = yield* ripgrep
      .grep({
        cwd: ctx.directory,
        pattern: args.pattern,
        include: args.glob?.[0],
        limit: args.limit ?? 10_000,
      })
      .pipe(Effect.orDie)
    process.stdout.write(JSON.stringify(results, null, 2) + EOL)
  }),
})
