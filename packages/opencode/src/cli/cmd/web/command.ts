import { cmd } from "../cmd"
import { withNetworkOptions } from "../../network"

export const WebCommand = cmd({
  command: "web",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "start opencode server and open web interface",
  handler: async (args) => {
    await import("./handler").then(({ handler }) => handler(args))
  },
})

export type WebArgs = Parameters<NonNullable<typeof WebCommand.handler>>[0]
