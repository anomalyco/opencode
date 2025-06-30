import { App } from "../../app/app"
import { Ripgrep } from "../../file/ripgrep"
import { LSP } from "../../lsp"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"

export const DebugCommand = cmd({
  command: "debug",
  builder: (yargs) =>
    yargs
      .command(DiagnosticsCommand)
      .command(TreeCommand)
      .command(SymbolsCommand)
      .command(FilesCommand)
      .demandCommand(),
  async handler() {},
})

const DiagnosticsCommand = cmd({
  command: "diagnostics <file>",
  builder: (yargs) =>
    yargs.positional("file", { type: "string", demandOption: true }),
  async handler(args) {
    await bootstrap({ cwd: process.cwd() }, async () => {
      await LSP.touchFile(args.file, true)
      console.log(await LSP.diagnostics())
    })
  },
})

const TreeCommand = cmd({
  command: "tree",
  builder: (yargs) =>
    yargs.option("limit", {
      type: "number",
    }),
  async handler(args) {
    await bootstrap({ cwd: process.cwd() }, async () => {
      const app = App.info()
      console.log(await Ripgrep.tree({ cwd: app.path.cwd, limit: args.limit }))
    })
  },
})

const SymbolsCommand = cmd({
  command: "symbols <query>",
  builder: (yargs) =>
    yargs.positional("query", { type: "string", demandOption: true }),
  async handler(args) {
    await bootstrap({ cwd: process.cwd() }, async () => {
      await LSP.touchFile("./src/index.ts", true)
      await new Promise((resolve) => setTimeout(resolve, 3000))
      const results = await LSP.workspaceSymbol(args.query)
      console.log(JSON.stringify(results, null, 2))
    })
  },
})

const FilesCommand = cmd({
  command: "files",
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
  async handler(args) {
    await bootstrap({ cwd: process.cwd() }, async () => {
      const app = App.info()
      const files = await Ripgrep.files({
        cwd: app.path.cwd,
        query: args.query,
        glob: args.glob,
        limit: args.limit,
      })
      console.log(files.join("\n"))
    })
  },
})
