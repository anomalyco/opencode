import { Server } from "../../server/server"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import open from "open"
import { networkInterfaces } from "os"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { Hono } from "hono"
import { proxy } from "hono/proxy"
import { parseSessionUrl } from "@/util/parse-session-url"

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
    return withNetworkOptions(yargs)
      .option("prompt", {
        describe: "prompt to use",
        type: "string",
      })
      .option("attach", {
        describe: "attach to an existing OpenCode server or session URL",
        type: "string",
      })
  },
  describe: "start opencode server and open web interface",
  handler: async (args) => {
    let server: ReturnType<typeof Server.listen> | Awaited<ReturnType<typeof Bun.serve>> | undefined
    let baseUrl: string
    let opts: Awaited<ReturnType<typeof resolveNetworkOptions>> | undefined
    let remoteUrl: string | undefined
    let sessionId: string | undefined

    if (args.attach) {
      const parsed = parseSessionUrl(args.attach)
      remoteUrl = parsed.baseUrl
      sessionId = parsed.sessionId
      opts = await resolveNetworkOptions(args)

      // Create a proxy server that forwards to the remote server
      const app = new Hono()
      app.all("*", async (c) => {
        const url = new URL(c.req.url)
        const targetUrl = `${remoteUrl}${url.pathname}${url.search}`
        return proxy(targetUrl, {
          ...c.req,
        })
      })

      server = Bun.serve({
        hostname: opts.hostname,
        port: opts.port,
        fetch: app.fetch,
      })

      baseUrl = opts.hostname === "0.0.0.0" ? `http://localhost:${server.port}` : server.url.toString()
    } else {
      if (!Flag.OPENCODE_SERVER_PASSWORD) {
        UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + "OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
      }
      opts = await resolveNetworkOptions(args)
      server = Server.listen(opts)
      baseUrl = opts.hostname === "0.0.0.0" ? `http://localhost:${server.port}` : server.url.toString()
    }
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()

    // If prompt is provided or sessionId is provided, create/use session
    if (args.prompt || sessionId) {
      const sdk = createOpencodeClient({
        baseUrl: remoteUrl ?? baseUrl,
      })

      if (opts.mdns) {
        UI.println(
          UI.Style.TEXT_INFO_BOLD + "  mDNS:              ",
          UI.Style.TEXT_NORMAL,
          `${opts.mdnsDomain}:${server.port}`,
        )
      }

      let actualSessionId: string

      if (sessionId) {
        // Use existing session from URL
        actualSessionId = sessionId
      } else {
        // Create new session
        const session = await sdk.session.create({ directory: process.cwd() })
        if (!session.data) throw new Error("Failed to create session")
        actualSessionId = session.data.id
      }

      const sessionUrl = `${baseUrl}/${actualSessionId}/session/${actualSessionId}`

      // Send the prompt to the session if provided (fire and forget)
      if (args.prompt) {
        sdk.session
          .prompt({
            sessionID: actualSessionId,
            directory: process.cwd(),
            parts: [
              {
                type: "text",
                text: args.prompt,
              },
            ],
          })
          .catch(() => {})
      }

      UI.println(UI.Style.TEXT_INFO_BOLD + "  Session URL:       ", UI.Style.TEXT_NORMAL, sessionUrl)
      UI.empty()

      // Open the session in browser
      open(sessionUrl).catch(() => {})
    } else {
      // Show server/proxy details (identical output for both)
      if (!server) return

      if (opts!.hostname === "0.0.0.0") {
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
        UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:     ", UI.Style.TEXT_NORMAL, displayUrl)
        open(displayUrl).catch(() => {})
      }
    }

    await new Promise(() => {})
    if (server) {
      await server.stop()
    }
  },
})
