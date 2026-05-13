import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { ServerAuthConfig } from "@/server/auth/config"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    if (ServerAuthConfig.resolve(opts.auth).mode === "disabled") {
      console.log("Warning: server auth is disabled; server is unsecured.")
    }
    const server = await Server.listen(opts)
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    await new Promise(() => {})
    await server.stop()
  },
})
