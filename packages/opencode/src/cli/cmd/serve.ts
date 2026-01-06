import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import path from "path"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) =>
    withNetworkOptions(yargs).option("cwd", {
      describe: "working directory",
      type: "string",
    }),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    // Resolve working directory similar to TUI command
    const baseCwd = process.env.PWD ?? process.cwd()
    const cwd = args.cwd ? path.resolve(baseCwd, args.cwd) : process.cwd()
    try {
      process.chdir(cwd)
    } catch (e) {
      console.error("Failed to change directory to " + cwd)
      return
    }

    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)
    await new Promise(() => {})
    await server.stop()
  },
})
