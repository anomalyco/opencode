import { Global } from "../../../global"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { ConfigCommand } from "./config"
import { FileCommand } from "./file"
import { LSPCommand } from "./lsp"
import { RipgrepCommand } from "./ripgrep"
import { ScrapCommand } from "./scrap"
import { SkillCommand } from "./skill"
import { SnapshotCommand } from "./snapshot"
import { AgentCommand } from "./agent"

export const DebugCommand = cmd({
  command: "debug",
  describe: "debugging and troubleshooting tools",
  builder: (yargs) =>
    yargs
      .command(ConfigCommand)
      .command(LSPCommand)
      .command(RipgrepCommand)
      .command(FileCommand)
      .command(ScrapCommand)
      .command(SkillCommand)
      .command(SnapshotCommand)
      .command(AgentCommand)
      .command(PathsCommand)
      .command({
        command: "wait",
        describe: "wait indefinitely (for debugging)",
        async handler() {
          await bootstrap(process.cwd(), async () => {
            await new Promise((resolve) => setTimeout(resolve, 1_000 * 60 * 60 * 24))
          })
        },
      })
      .demandCommand(),
  async handler() {},
})

const PathsCommand = cmd({
  command: "paths",
  describe: "show global paths (data, config, cache, state)",
  handler() {
    for (const [key, value] of Object.entries(Global.Path)) {
      console.log(key.padEnd(10), value)
    }
  },
})
