import type { CommandModule } from "yargs"
import { ACPServer } from "../../acp/server"

export const AcpCommand: CommandModule = {
  command: "acp",
  describe: "Start ACP (Agent Client Protocol) server",
  builder: (yargs) => {
    return yargs.option("cwd", {
      describe: "working directory",
      type: "string",
      default: process.cwd(),
    })
  },
  handler: async (opts) => {
    if (opts["cwd"] && typeof opts["cwd"] === "string") {
      process.chdir(opts["cwd"])
    }

    await ACPServer.start()
  },
}
