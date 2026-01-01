import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Global } from "../../global"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    // Change cwd to home directory to ensure shell commands without explicit cwd
    // don't fail when the server is started from a nested/temporary directory
    process.chdir(Global.Path.home)
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)
    await new Promise(() => {})
    await server.stop()
  },
})
