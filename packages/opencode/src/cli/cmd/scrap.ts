import { App } from "../../app/app"
import { LSP } from "../../lsp"
import { cmd } from "./cmd"

export const ScrapCommand = cmd({
  command: "scrap <file>",
  builder: (yargs) =>
    yargs.positional("file", { type: "string", demandOption: true }),
  async handler(args) {
    await App.provide({ cwd: process.cwd() }, async () => {
      await LSP.touchFile(args.file, true)
      console.log(await LSP.diagnostics())
    })
  },
})
