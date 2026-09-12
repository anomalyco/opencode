import { AppRuntime } from "./effect/app-runtime"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Server } from "./server/server"
import { UI } from "./cli/ui"
import { networkInterfaces } from "os"
import open from "open"

process.env.AGENT = "1"
process.env.OPENCODE = "1"
process.env.OPENCODE_PID = String(process.pid)

const port = process.env.PORT || process.env.OPENCODE_PORT
const hostname = process.env.HOSTNAME || process.env.OPENCODE_HOSTNAME || "127.0.0.1"
const mdns = process.env.MDNS === "true" || process.env.OPENCODE_MDNS === "true"
const mdnsDomain = process.env.MDNS_DOMAIN || process.env.OPENCODE_MDNS_DOMAIN || "opencode.local"
const cors = process.env.CORS ? process.env.CORS.split(",") : []
const openWeb = process.env.OPEN_WEB || "false"

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

const ServerRuntimeLaunch = Effect.fn("ServerRuntime.launch")(function* () {
  if (!Flag.OPENCODE_SERVER_PASSWORD) {
    console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
  }

  const opts = {
    port: port ? parseInt(port, 10) : 4096,
    hostname,
    mdns,
    mdnsDomain,
    cors,
  }

  const server = yield* Effect.promise(() => Server.listen(opts))
  console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

  if (openWeb === "true") {
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
          `${opts.mdnsDomain}:${server.port}`,
        )
      }

      // Open localhost in browser
      open(localhostUrl).catch(() => { })
    } else {
      const displayUrl = server.url.toString()
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:    ", UI.Style.TEXT_NORMAL, displayUrl)
      open(displayUrl).catch(() => { })
    }
  }

  yield* Effect.never
})

try {
  await AppRuntime.runPromise(ServerRuntimeLaunch())
} catch (e) {
  console.error("Server runtime error:", e)
  process.exitCode = 1
} finally {
  process.exit()
}

