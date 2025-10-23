import { ACPServer } from "../../acp/server"
import { cmd } from "./cmd"

export const AcpCommand = cmd({
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
    if (opts.cwd) process.chdir(opts["cwd"])
    await ACPServer.start()
  },
})
