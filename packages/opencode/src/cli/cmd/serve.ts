import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Workspace } from "../../control-plane/workspace"
import { Project } from "../../project/project"
import { Installation } from "../../installation"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { Hono } from "hono"
import { proxy } from "hono/proxy"
import { parseSessionUrl } from "@/util/parse-session-url"

export const ServeCommand = cmd({
  command: "serve",
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
  describe: "starts a headless opencode server",
  handler: async (args) => {
    let server: ReturnType<typeof Server.listen> | Awaited<ReturnType<typeof Bun.serve>> | undefined
    let baseUrl: string
    let remoteUrl: string | undefined
    let sessionId: string | undefined

    if (args.attach) {
      const parsed = parseSessionUrl(args.attach)
      remoteUrl = parsed.baseUrl
      sessionId = parsed.sessionId
      const opts = await resolveNetworkOptions(args)

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

      baseUrl = `http://${server.hostname}:${server.port}`
    } else {
      if (!Flag.OPENCODE_SERVER_PASSWORD) {
        console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
      }
      const opts = await resolveNetworkOptions(args)
      server = Server.listen(opts)
      baseUrl = `http://${server.hostname}:${server.port}`
    }

    // If prompt is provided or sessionId is provided, create/use session
    if (args.prompt || sessionId) {
      const sdk = createOpencodeClient({
        baseUrl: remoteUrl ?? baseUrl,
      })

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

      console.log(`opencode server listening on ${baseUrl}`)
      console.log(`session created: ${baseUrl}/${actualSessionId}/session/${actualSessionId}`)
    } else {
      console.log(`opencode server listening on ${baseUrl}`)
    }

    await new Promise(() => {})
    if (server) {
      await server.stop()
    }
  },
})
