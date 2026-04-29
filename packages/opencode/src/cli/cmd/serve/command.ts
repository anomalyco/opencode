import { cmd } from "../cmd"
import { withNetworkOptions } from "../../network"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    await import("./handler").then(({ handler }) => handler(args))
  },
})

export type ServeArgs = Parameters<NonNullable<typeof ServeCommand.handler>>[0]
