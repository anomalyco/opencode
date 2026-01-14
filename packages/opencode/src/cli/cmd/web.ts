import { Server } from "../../server/server"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveServerOptions } from "../network"
import open from "open"
import { networkInterfaces } from "os"
import * as prompts from "@clack/prompts"
import { Clipboard } from "../../util/clipboard"

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

async function showServerDialog(input: { hostname: string; port: number; password: string }) {
  const address = `http://${input.hostname}:${input.port}`
  const action = await prompts.select({
    message: `Server running at ${address}`,
    options: [
      { label: "Copy password", value: "copy" },
      { label: "Dismiss", value: "dismiss" },
    ],
  })
  if (prompts.isCancel(action)) return
  if (action === "copy") {
    await Clipboard.copy(input.password)
      .then(() => prompts.log.success("Password copied to clipboard"))
      .catch(() => prompts.log.error("Failed to copy password"))
  }
}

export const WebCommand = cmd({
  command: "web",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "start opencode server and open web interface",
  handler: async (args) => {
    const opts = await resolveServerOptions(args)
    const server = Server.listen({
      hostname: opts.hostname,
      port: opts.port,
      mdns: opts.mdns,
      cors: opts.cors,
      randomPort: opts.randomPort,
      auth: {
        username: opts.auth.username,
        password: opts.auth.password,
      },
    })
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()

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

    await showServerDialog({
      hostname: server.hostname ?? "localhost",
      port: server.port ?? 4096,
      password: opts.auth.password,
    })
    await new Promise(() => {})
    await server.stop()
  },
})
