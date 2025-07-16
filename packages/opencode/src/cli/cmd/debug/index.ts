import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { FileCommand } from "./file"
import { LSPCommand } from "./lsp"
import { RipgrepCommand } from "./ripgrep"
import { ScrapCommand } from "./scrap"
import { SnapshotCommand } from "./snapshot"

export const DebugCommand = cmd({
  command: "debug",
  builder: (yargs) =>
    yargs
      .command(LSPCommand)
      .command(RipgrepCommand)
      .command(FileCommand)
      .command(ScrapCommand)
      .command(SnapshotCommand)
      .command({
        command: "wait",
        async handler() {
          await bootstrap({ cwd: process.cwd() }, async () => {
            await new Promise((resolve) => setTimeout(resolve, 1_000 * 60 * 60 * 24))
          })
        },
      })
      .demandCommand(),
  async handler() {},
})
