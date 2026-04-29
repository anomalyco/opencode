import { cmd } from "../cmd"
import { withNetworkOptions } from "../../network"

export const AcpCommand = cmd({
  command: "acp",
  describe: "start ACP (Agent Client Protocol) server",
  builder: (yargs) => {
    return withNetworkOptions(yargs).option("cwd", {
      describe: "working directory",
      type: "string",
      default: process.cwd(),
    })
  },
  handler: async (args) => {
    await import("./handler").then(({ handler }) => handler(args))
  },
})

export type AcpArgs = Parameters<NonNullable<typeof AcpCommand.handler>>[0]
