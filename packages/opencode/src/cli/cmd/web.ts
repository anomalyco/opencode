import { Server } from "../../server/server"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import open from "open"
import { networkInterfaces } from "os"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

function getNetworkIPs() {
  const nets = networkInterfaces()
  const results: string[] = []

  for (const name of Object.keys(nets)) {
    const net = nets[name]
    if (!net) continue

    for (const netInfo of net) {
      // Skip internal and non-IPv4 addresses
      if (netInfo.internal || netInfo.family !== "IPv4") continue

      // Skip Docker bridge networks (typically 172.x.x.x)
      if (netInfo.address.startsWith("172.")) continue

      results.push(netInfo.address)
    }
  }

  return results
}

export const WebCommand = cmd({
  command: "web",
  builder: (yargs) => {
    return withNetworkOptions(yargs).option("prompt", {
      describe: "prompt to use",
      type: "string",
    })
  },
  describe: "start opencode server and open web interface",
  handler: async (args) => {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + "OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()

    const baseUrl = opts.hostname === "0.0.0.0" ? `http://localhost:${server.port}` : server.url.toString()

    // If prompt is provided, create a session and send the prompt
    if (args.prompt) {
      const sdk = createOpencodeClient({
        baseUrl,
      })

      if (opts.mdns) {
        UI.println(
          UI.Style.TEXT_INFO_BOLD + "  mDNS:              ",
          UI.Style.TEXT_NORMAL,
          `${opts.mdnsDomain}:${server.port}`,
        )
      }

      const session = await sdk.session.create({ directory: process.cwd() })
      if (!session.data) throw new Error("Failed to create session")
      const sessionUrl = `${baseUrl}/${session.data.id}/session/${session.data.id}`

      // Send the prompt to the session (fire and forget)
      sdk.session
        .prompt({
          sessionID: session.data.id,
          directory: process.cwd(),
          parts: [
            {
              type: "text",
              text: args.prompt,
            },
          ],
        })
        .catch(() => {})

      UI.println(UI.Style.TEXT_INFO_BOLD + "  Session URL:       ", UI.Style.TEXT_NORMAL, sessionUrl)
      UI.empty()

      // Open the session in browser
      open(sessionUrl).catch(() => {})
    } else {
      if (opts.hostname === "0.0.0.0") {
        // Show localhost for local access
        const localhostUrl = `http://localhost:${server.port}`
        UI.println(UI.Style.TEXT_INFO_BOLD + "  Local access:      ", UI.Style.TEXT_NORMAL, localhostUrl)

        // Show network IPs for remote access
        const networkIPs = getNetworkIPs()
        if (networkIPs.length > 0) {
          for (const ip of networkIPs) {
            UI.println(
              UI.Style.TEXT_INFO_BOLD + "  Network access:    ",
              UI.Style.TEXT_NORMAL,
              `http://${ip}:${server.port}`,
            )
          }
        }

        if (opts.mdns) {
          UI.println(UI.Style.TEXT_INFO_BOLD + "  mDNS:              ", UI.Style.TEXT_NORMAL, "opencode.local")
        }

        // Open localhost in browser
        open(localhostUrl.toString()).catch(() => {})
      } else {
        const displayUrl = server.url.toString()
        UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:    ", UI.Style.TEXT_NORMAL, displayUrl)
        open(displayUrl).catch(() => {})
      }
    }

    await new Promise(() => {})
    await server.stop()
  },
})
