import { LSP } from "@/lsp/lsp"
import { Effect } from "effect"
import { effectCmd } from "../../effect-cmd"
import { cmd } from "../cmd"
import * as Log from "@opencode-ai/core/util/log"
import { EOL } from "os"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"

export const LSPCommand = cmd({
  command: "lsp",
  describe: "LSP debugging utilities",
  builder: (yargs) =>
    yargs.command(DiagnosticsCommand).command(SymbolsCommand).command(DocumentSymbolsCommand).demandCommand(),
  async handler() {},
})

const DiagnosticsCommand = effectCmd({
  command: "diagnostics <file>",
  describe: "get diagnostics for a file",
  builder: (yargs) => yargs.positional("file", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.debug.lsp.diagnostics")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      const out = yield* LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          yield* lsp.touchFile(args.file, "full")
          return yield* lsp.diagnostics()
        }),
      )
      process.stdout.write(JSON.stringify(out, null, 2) + EOL)
    }).pipe(Effect.ensuring(store.dispose(ctx)))
  }),
})

export const SymbolsCommand = effectCmd({
  command: "symbols <query>",
  describe: "search workspace symbols",
  builder: (yargs) => yargs.positional("query", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.debug.lsp.symbols")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      using _ = Log.Default.time("symbols")
      const results = yield* LSP.Service.use((lsp) => lsp.workspaceSymbol(args.query))
      process.stdout.write(JSON.stringify(results, null, 2) + EOL)
    }).pipe(Effect.ensuring(store.dispose(ctx)))
  }),
})

export const DocumentSymbolsCommand = effectCmd({
  command: "document-symbols <uri>",
  describe: "get symbols from a document",
  builder: (yargs) => yargs.positional("uri", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.debug.lsp.documentSymbols")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      using _ = Log.Default.time("document-symbols")
      const results = yield* LSP.Service.use((lsp) => lsp.documentSymbol(args.uri))
      process.stdout.write(JSON.stringify(results, null, 2) + EOL)
    }).pipe(Effect.ensuring(store.dispose(ctx)))
  }),
})
