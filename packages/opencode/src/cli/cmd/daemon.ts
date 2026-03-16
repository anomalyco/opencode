import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { DaemonService } from "../../daemon/service"

export const DaemonCommand = cmd({
  command: "daemon [action]",
  builder: (yargs) =>
    withNetworkOptions(yargs).positional("action", {
      type: "string",
      choices: ["start", "install", "uninstall", "status"] as const,
      default: "start",
      describe: "daemon action to perform",
    }),
  describe: "starts a directory-agnostic daemon server that manages multiple sessions",
  handler: async (args) => {
    const action = args.action ?? "start"

    if (action === "install") {
      const opts = await resolveNetworkOptions(args)
      await DaemonService.install(opts)
      console.log("Daemon service installed and started.")
      return
    }

    if (action === "uninstall") {
      await DaemonService.uninstall()
      console.log("Daemon service removed.")
      return
    }

    if (action === "status") {
      const running = await DaemonService.status()
      console.log(running ? "Daemon is running." : "Daemon is not running.")
      return
    }

    // action === "start"
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen({ ...opts, daemon: true })
    await DaemonService.saveConfig({
      hostname: server.hostname ?? opts.hostname,
      port: server.port ?? opts.port,
      mdns: opts.mdns,
      mdnsDomain: opts.mdnsDomain,
      cors: opts.cors,
    })
    console.log(`opencode daemon listening on http://${server.hostname}:${server.port}`)

    // Block forever — daemon runs until killed
    await new Promise(() => {})
  },
})
