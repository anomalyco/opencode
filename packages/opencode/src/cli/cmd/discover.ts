import { cmd } from "./cmd"
import { MDNS } from "../../mdns"
import * as prompts from "@clack/prompts"

export const DiscoverCommand = cmd({
  command: "discover",
  describe: "Discover OpenCode servers on the local network via mDNS",
  builder: (yargs) => {
    return yargs.option("timeout", {
      type: "number",
      default: 3000,
      describe: "Time to wait for responses (ms)",
    })
  },
  handler: async (args) => {
    prompts.intro("Discovering OpenCode servers")

    try {
      const servers = await MDNS.find(AbortSignal.timeout(args.timeout))
      if (servers.length === 0) {
        prompts.log.warn("No OpenCode servers found on the network")
        prompts.outro("Done")
        return
      }

      console.log("Name                  URL")
      console.log("────────────────────  ──────────────────────────────")
      servers.forEach((server) => console.log(formatServerRow(server)))

      prompts.outro(`Found ${servers.length} server(s)`)
      return
    } catch (error) {
      prompts.log.error(`Discovery failed: ${error instanceof Error ? error.message : String(error)}`)
      prompts.outro("Done")
      process.exit(1)
    }
  },
})

function formatServerRow(server: MDNS.DiscoveredServer) {
  return `${server.name.padEnd(20)}  ${server.fullUrl}`
}
