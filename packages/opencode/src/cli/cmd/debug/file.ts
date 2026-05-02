import { EOL } from "os"
import { Effect } from "effect"
import { File } from "../../../file"
import { Ripgrep } from "@/file/ripgrep"
import { effectCmd } from "../../effect-cmd"
import { cmd } from "../cmd"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"

const FileSearchCommand = effectCmd({
  command: "search <query>",
  describe: "search files by query",
  builder: (yargs) =>
    yargs.positional("query", {
      type: "string",
      demandOption: true,
      description: "Search query",
    }),
  handler: Effect.fn("Cli.debug.file.search")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      const results = yield* File.Service.use((svc) => svc.search({ query: args.query }))
      process.stdout.write(results.join(EOL) + EOL)
    }).pipe(Effect.ensuring(store.dispose(ctx)))
  }),
})

const FileReadCommand = effectCmd({
  command: "read <path>",
  describe: "read file contents as JSON",
  builder: (yargs) =>
    yargs.positional("path", {
      type: "string",
      demandOption: true,
      description: "File path to read",
    }),
  handler: Effect.fn("Cli.debug.file.read")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      const content = yield* File.Service.use((svc) => svc.read(args.path))
      process.stdout.write(JSON.stringify(content, null, 2) + EOL)
    }).pipe(Effect.ensuring(store.dispose(ctx)))
  }),
})

const FileStatusCommand = effectCmd({
  command: "status",
  describe: "show file status information",
  builder: (yargs) => yargs,
  handler: Effect.fn("Cli.debug.file.status")(function* () {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      const status = yield* File.Service.use((svc) => svc.status())
      process.stdout.write(JSON.stringify(status, null, 2) + EOL)
    }).pipe(Effect.ensuring(store.dispose(ctx)))
  }),
})

const FileListCommand = effectCmd({
  command: "list <path>",
  describe: "list files in a directory",
  builder: (yargs) =>
    yargs.positional("path", {
      type: "string",
      demandOption: true,
      description: "File path to list",
    }),
  handler: Effect.fn("Cli.debug.file.list")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      const files = yield* File.Service.use((svc) => svc.list(args.path))
      process.stdout.write(JSON.stringify(files, null, 2) + EOL)
    }).pipe(Effect.ensuring(store.dispose(ctx)))
  }),
})

const FileTreeCommand = effectCmd({
  command: "tree [dir]",
  describe: "show directory tree",
  builder: (yargs) =>
    yargs.positional("dir", {
      type: "string",
      description: "Directory to tree",
      default: process.cwd(),
    }),
  handler: Effect.fn("Cli.debug.file.tree")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      const tree = yield* Effect.orDie(Ripgrep.Service.use((svc) => svc.tree({ cwd: args.dir, limit: 200 })))
      console.log(JSON.stringify(tree, null, 2))
    }).pipe(Effect.ensuring(store.dispose(ctx)))
  }),
})

export const FileCommand = cmd({
  command: "file",
  describe: "file system debugging utilities",
  builder: (yargs) =>
    yargs
      .command(FileReadCommand)
      .command(FileStatusCommand)
      .command(FileListCommand)
      .command(FileSearchCommand)
      .command(FileTreeCommand)
      .demandCommand(),
  async handler() {},
})
