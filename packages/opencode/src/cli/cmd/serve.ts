import { Server } from "../../server/server"
import { ServerRegistry } from "../../server/registry"
import { Config } from "../../config/config"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { randomBytes } from "crypto"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    // Self-registration if durableStreams is enabled
    const config = await Config.get()
    const shouldRegister = config.experimental?.durableStreams ?? false

    let heartbeatInterval: Timer | undefined
    const serverId = randomBytes(8).toString("hex")

    if (shouldRegister) {
      const url = `http://${server.hostname}:${server.port}`
      await ServerRegistry.register({
        id: serverId,
        url,
        port: server.port!,
        pid: process.pid,
        lastHeartbeat: Date.now(),
      })

      // Heartbeat every 15 seconds
      heartbeatInterval = setInterval(async () => {
        await ServerRegistry.heartbeat(serverId)
      }, 15_000)

      console.log(`Server registered with id: ${serverId}`)
    }

    // Cleanup on shutdown
    const cleanup = async () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval)
      }
      if (shouldRegister) {
        await ServerRegistry.unregister(serverId)
        console.log(`Server ${serverId} unregistered`)
      }
    }

    process.on("SIGINT", async () => {
      await cleanup()
      await server.stop()
      process.exit(0)
    })

    process.on("SIGTERM", async () => {
      await cleanup()
      await server.stop()
      process.exit(0)
    })

    await new Promise(() => {})
    await cleanup()
    await server.stop()
  },
})
