import { cmd } from "./cmd"
import { MDNS } from "../../mdns"
import * as prompts from "@clack/prompts"
import { EOL } from "os"

export const DiscoverCommand = cmd({
  command: "discover",
  describe: "Discover OpenCode servers on the local network via mDNS",
  builder: (yargs) => {
    return yargs
      .option("timeout", {
        type: "number",
        default: 5000,
        describe: "Time to wait for responses (ms)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output as JSON",
      })
  },
  handler: async (args) => {
    prompts.intro("Discovering OpenCode servers")

    try {
      const servers = await MDNS.find(args.timeout)

      if (servers.length === 0) {
        prompts.log.warn("No OpenCode servers found on the network")
        prompts.outro("Done")
        return
      }

      if (args.json) {
        console.log(JSON.stringify(servers, null, 2))
      } else {
        console.log(formatServerTable(servers))
      }

      prompts.outro(`Found ${servers.length} server(s)`)
      return
    } catch (error) {
      prompts.log.error(`Discovery failed: ${error instanceof Error ? error.message : String(error)}`)
      prompts.outro("Done")
      process.exit(1)
    }
  },
})

function formatServerTable(servers: MDNS.DiscoveredServer[]): string {
  const lines: string[] = []

  const maxNameWidth = Math.max(20, ...servers.map((s) => s.name.length))
  const maxUrlWidth = Math.max(30, ...servers.map((s) => s.fullUrl.length))

  const header = `Name${" ".repeat(maxNameWidth - 4)}  URL${" ".repeat(maxUrlWidth - 3)}`
  lines.push(header)
  lines.push("─".repeat(header.length))

  for (const server of servers) {
    const name = server.name.padEnd(maxNameWidth)
    const url = server.fullUrl.padEnd(maxUrlWidth)
    lines.push(`${name}  ${url}`)
  }

  return lines.join(EOL)
}
