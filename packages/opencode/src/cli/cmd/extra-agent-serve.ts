import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { getBridge, listBridgeIds } from "@/extra-agent/registry"

export const ExtraAgentServeCommand = cmd({
  command: "extra-agent-serve",
  describe: "start an extra-agent bridge server by id",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .option("id", {
        type: "string",
        describe: "extra-agent id (e.g. openclaw, genericagent)",
        demandOption: true,
      })
      .option("config", {
        type: "string",
        describe: "JSON-encoded bridge config (agent-specific, e.g. '{\"gatewayUrl\":\"ws://...\"}')",
      }),
  handler: async (args) => {
    const bridge = getBridge(args.id)
    if (!bridge) {
      const known = listBridgeIds().join(", ") || "(none)"
      throw new Error(`Unknown extra-agent id "${args.id}". Known: ${known}`)
    }
    const net = await resolveNetworkOptions(args)
    let config: Record<string, unknown> | undefined
    if (args.config) {
      try {
        const parsed = JSON.parse(args.config)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          config = parsed as Record<string, unknown>
        } else {
          throw new Error("--config must be a JSON object")
        }
      } catch (err) {
        throw new Error(`Failed to parse --config: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const server = bridge.listen({
      hostname: net.hostname,
      port: net.port,
      cors: net.cors,
      config,
    })
    console.log(`extra-agent ${bridge.id} listening on http://${server.hostname ?? net.hostname}:${server.port ?? net.port}`)

    let shuttingDown = false
    const shutdown = async (sig: NodeJS.Signals) => {
      if (shuttingDown) return
      shuttingDown = true
      console.log(`extra-agent ${bridge.id} received ${sig}, shutting down`)
      try {
        await server.stop()
      } catch (err) {
        console.error(`extra-agent ${bridge.id} stop failed:`, err)
      }
      process.exit(0)
    }
    process.on("SIGTERM", shutdown)
    process.on("SIGINT", shutdown)
    process.on("SIGHUP", shutdown)

    await new Promise(() => {})
  },
})
