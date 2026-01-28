import { Server } from "../../server/server"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import open from "open"
import { networkInterfaces } from "os"
import * as prompts from "@clack/prompts"

type Decision = "allow" | "confirm" | "deny"

function normalizeHost(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return ""
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed.slice(1, -1).toLowerCase()
  return trimmed.toLowerCase()
}

function isLoopbackHost(hostname: string) {
  const host = normalizeHost(hostname)
  if (!host) return true
  return host === "127.0.0.1" || host === "localhost" || host === "::1"
}

export function webSecurityDecision(input: { hostname: string; passwordSet: boolean; yes?: boolean; isTTY: boolean }): Decision {
  if (input.passwordSet) return "allow"
  if (isLoopbackHost(input.hostname)) return "allow"
  if (input.yes) return "allow"
  return input.isTTY ? "confirm" : "deny"
}

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
  builder: (yargs) =>
    withNetworkOptions(yargs).option("yes", {
      alias: "y",
      type: "boolean",
      describe: "skip confirmation prompts",
      default: false,
    }),
  describe: "start opencode server and open web interface",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args as any)
    const passwordSet = !!Flag.OPENCODE_SERVER_PASSWORD
    const decision = webSecurityDecision({
      hostname: opts.hostname,
      passwordSet,
      yes: (args as any).yes,
      isTTY: !!process.stdin.isTTY,
    })

    if (!passwordSet) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + "OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }

    if (decision === "deny") {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + "Refusing to start unsecured server on non-loopback hostname.")
      UI.println(UI.Style.TEXT_DIM + "Set OPENCODE_SERVER_PASSWORD, or pass --yes to explicitly accept this risk.")
      process.exitCode = 1
      return
    }

    if (decision === "confirm") {
      prompts.intro("Start unsecured server?")
      prompts.log.warn(`Hostname: ${opts.hostname}`)
      prompts.log.warn("OPENCODE_SERVER_PASSWORD is not set; anyone who can reach this host can access the server.")
      const confirm = await prompts.confirm({
        message: "Start anyway?",
        initialValue: false,
      })
      if (!confirm || prompts.isCancel(confirm)) {
        prompts.outro("Cancelled")
        return
      }
      prompts.outro("Starting server")
    }

    const server = Server.listen(opts)
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
        UI.println(
          UI.Style.TEXT_INFO_BOLD + "  mDNS:              ",
          UI.Style.TEXT_NORMAL,
          `opencode.local:${server.port}`,
        )
      }

      // Open localhost in browser
      open(localhostUrl.toString()).catch(() => {})
    } else {
      const displayUrl = server.url.toString()
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:    ", UI.Style.TEXT_NORMAL, displayUrl)
      open(displayUrl).catch(() => {})
    }

    await new Promise(() => {})
    await server.stop()
  },
})
