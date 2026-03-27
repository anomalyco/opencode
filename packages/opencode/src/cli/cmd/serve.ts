import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Log } from "../../util/log"

const log = Log.create({ service: "startup" })

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    const timer = log.time("serve", {
      client: Flag.OPENCODE_CLIENT,
    })

    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }

    log.info("serve.flags", {
      client: Flag.OPENCODE_CLIENT,
      has_password: !!Flag.OPENCODE_SERVER_PASSWORD,
      has_username: !!Flag.OPENCODE_SERVER_USERNAME,
    })

    const network = log.time("resolve_network")
    const opts = await resolveNetworkOptions(args)
    network.stop()

    const listen = log.time("server.listen", {
      hostname: opts.hostname,
      port: opts.port,
    })
    const server = Server.listen(opts)
    listen.stop()
    log.info("server.listening", {
      hostname: server.hostname,
      port: server.port,
    })
    timer.stop()

    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    await new Promise(() => {})
    await server.stop()
  },
})
