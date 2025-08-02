import { LSP } from "../../../lsp"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { Log } from "../../../util/log"

export const LSPCommand = cmd({
  command: "lsp",
  describe: "LSP server debugging tools",
  builder: (yargs) =>
    yargs.command(DiagnosticsCommand).command(SymbolsCommand).command(DocumentSymbolsCommand).demandCommand(),
  async handler() {},
})

const DiagnosticsCommand = cmd({
  command: "diagnostics <file>",
  describe: "get LSP diagnostics for a file",
  builder: (yargs) => yargs.positional("file", { type: "string", demandOption: true }),
  async handler(args) {
    await bootstrap({ cwd: process.cwd() }, async () => {
      await LSP.touchFile(args.file, true)
      console.log(await LSP.diagnostics())
    })
  },
})

export const SymbolsCommand = cmd({
  command: "symbols <query>",
  describe: "search workspace symbols",
  builder: (yargs) => yargs.positional("query", { type: "string", demandOption: true }),
  async handler(args) {
    await bootstrap({ cwd: process.cwd() }, async () => {
      using _ = Log.Default.time("symbols")
      const results = await LSP.workspaceSymbol(args.query)
      console.log(JSON.stringify(results, null, 2))
    })
  },
})

export const DocumentSymbolsCommand = cmd({
  command: "document-symbols <uri>",
  describe: "get document symbols for a file",
  builder: (yargs) => yargs.positional("uri", { type: "string", demandOption: true }),
  async handler(args) {
    await bootstrap({ cwd: process.cwd() }, async () => {
      using _ = Log.Default.time("document-symbols")
      const results = await LSP.documentSymbol(args.uri)
      console.log(JSON.stringify(results, null, 2))
    })
  },
})
