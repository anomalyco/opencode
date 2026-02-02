import { Server } from "../../server/server"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import open from "open"
import { networkInterfaces } from "os"

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
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "start opencode server and open web interface",
  handler: async (args) => {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + "OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = await Server.listen(opts)
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()

    if (opts.hostname === "0.0.0.0") {
      // Show localhost for local access
      const baseUrl = opts.rootPath ? new URL(opts.rootPath, `http://localhost:${server.port}`).toString() : `http://localhost:${server.port}`
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Local access:      ", UI.Style.TEXT_NORMAL, baseUrl)

      // Show network IPs for remote access
      const networkIPs = getNetworkIPs()
      if (networkIPs.length > 0) {
        for (const ip of networkIPs) {
          const networkUrl = opts.rootPath ? new URL(opts.rootPath, `http://${ip}:${server.port}`).toString() : `http://${ip}:${server.port}`
          UI.println(
            UI.Style.TEXT_INFO_BOLD + "  Network access:    ",
            UI.Style.TEXT_NORMAL,
            networkUrl,
          )
        }
      }

      if (opts.mdns) {
        UI.println(
          UI.Style.TEXT_INFO_BOLD + "  mDNS:              ",
          UI.Style.TEXT_NORMAL,
          `opencode.local:${server.port}`,
        )
      }

      // Open localhost in browser
      open(baseUrl.toString()).catch(() => { })
    } else {
      let displayUrl = server.url.toString()
      if (opts.rootPath) {
        displayUrl = new URL(opts.rootPath, server.url).toString()
      }
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:    ", UI.Style.TEXT_NORMAL, displayUrl)
      open(displayUrl).catch(() => { })
    }

    await new Promise(() => { })
    await server.stop()
  },
})
