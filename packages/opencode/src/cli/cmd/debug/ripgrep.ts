import { EOL } from "os"
import { Effect, Stream } from "effect"
import { Ripgrep } from "../../../file/ripgrep"
import { effectCmd } from "../../effect-cmd"
import { cmd } from "../cmd"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"

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
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      const tree = yield* Effect.orDie(Ripgrep.Service.use((svc) => svc.tree({ cwd: ctx.directory, limit: args.limit })))
      process.stdout.write(tree + EOL)
    }).pipe(Effect.ensuring(store.dispose(ctx)))
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
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      const rg = yield* Ripgrep.Service
      const files = yield* rg
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
    }).pipe(Effect.ensuring(store.dispose(ctx)))
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
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      const results = yield* Effect.orDie(
        Ripgrep.Service.use((svc) =>
          svc.search({
            cwd: ctx.directory,
            pattern: args.pattern,
            glob: args.glob as string[] | undefined,
            limit: args.limit,
          }),
        ),
      )
      process.stdout.write(JSON.stringify(results.items, null, 2) + EOL)
    }).pipe(Effect.ensuring(store.dispose(ctx)))
  }),
})
