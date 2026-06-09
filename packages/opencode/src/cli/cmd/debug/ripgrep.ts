import { EOL } from "os"
import { Effect, Stream } from "effect"
import { Ripgrep } from "@opencode-ai/core/filesystem/ripgrep"
import { Search } from "@opencode-ai/core/filesystem/search"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { effectCmd } from "../../effect-cmd"
import { cmd } from "../cmd"
import { InstanceRef } from "@/effect/instance-ref"

export const RipgrepCommand = cmd({
  command: "rg",
  describe: "ripgrep debugging utilities",
  builder: (yargs) => yargs.command(TreeCommand).command(FilesCommand).command(SearchCommand).demandCommand(),
  async handler() {},
})

const TreeCommand = effectCmd({
  command: "tree",
  describe: "show file tree using ripgrep",
  builder: (yargs) =>
    yargs.option("limit", {
      type: "number",
    }),
  handler: Effect.fn("Cli.debug.rg.tree")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const tree = yield* Effect.orDie(Ripgrep.Service.use((svc) => svc.tree({ cwd: ctx.directory, limit: args.limit })))
    process.stdout.write(tree + EOL)
  }),
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
      .files({
        cwd: ctx.directory,
        glob: args.glob ? [args.glob] : undefined,
      })
      .pipe(
        Stream.take(args.limit ?? Infinity),
        Stream.runCollect,
        Effect.map((c) => [...c]),
        Effect.orDie,
      )
    process.stdout.write(files.join(EOL) + EOL)
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
    const results = yield* Effect.orDie(
      Search.Service.use((svc) =>
        svc.grep({
          cwd: AbsolutePath.make(ctx.directory),
          pattern: args.pattern,
          include: args.glob?.[0],
          limit: args.limit,
        }),
      ),
    )
    process.stdout.write(JSON.stringify(results, null, 2) + EOL)
  }),
})
