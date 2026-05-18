import { LSP } from "@/lsp/lsp"
import { AppRuntime } from "../../../effect/app-runtime"
import { Effect } from "effect"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import * as Log from "@opencode-ai/core/util/log"
import { EOL } from "os"

export const LSPCommand = cmd({
  command: "lsp",
  describe: "LSP debugging utilities",
  builder: (yargs) =>
    yargs.command(DiagnosticsCommand).command(SymbolsCommand).command(DocumentSymbolsCommand).demandCommand(),
  async handler() {},
})

const DiagnosticsCommand = cmd({
  command: "diagnostics <file>",
  describe: "get diagnostics for a file",
  builder: (yargs) => yargs.positional("file", { type: "string", demandOption: true }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const out = await AppRuntime.runPromise(
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            yield* lsp.touchFile(args.file, "full")
            return yield* lsp.diagnostics()
          }),
        ),
      )
      process.stdout.write(JSON.stringify(out, null, 2) + EOL)
    })
  },
})

export const SymbolsCommand = cmd({
  command: "symbols <query>",
  describe: "search workspace symbols",
  builder: (yargs) => yargs.positional("query", { type: "string", demandOption: true }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      using _ = Log.Default.time("symbols")
      const results = await AppRuntime.runPromise(LSP.Service.use((lsp) => lsp.workspaceSymbol(args.query)))
      process.stdout.write(JSON.stringify(results, null, 2) + EOL)
    })
  },
})

export const DocumentSymbolsCommand = cmd({
  command: "document-symbols <uri>",
  describe: "get symbols from a document",
  builder: (yargs) => yargs.positional("uri", { type: "string", demandOption: true }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      using _ = Log.Default.time("document-symbols")
      const results = await AppRuntime.runPromise(LSP.Service.use((lsp) => lsp.documentSymbol(args.uri)))
      process.stdout.write(JSON.stringify(results, null, 2) + EOL)
    })
  },
})
