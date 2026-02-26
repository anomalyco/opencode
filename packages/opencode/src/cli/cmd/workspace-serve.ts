import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Installation } from "../../installation"

export const WorkspaceServeCommand = cmd({
  command: "workspace-serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a remote workspace websocket server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    const server = Bun.serve<{ id: string }>({
      hostname: opts.hostname,
      port: opts.port,
      fetch(req, server) {
        const url = new URL(req.url)
        if (url.pathname === "/ws") {
          const id = Bun.randomUUIDv7()
          if (server.upgrade(req, { data: { id } })) return
          return new Response("Upgrade failed", { status: 400 })
        }

        if (url.pathname === "/health") {
          return new Response("ok", {
            status: 200,
            headers: {
              "content-type": "text/plain; charset=utf-8",
            },
          })
        }

        return new Response(
          JSON.stringify({
            service: "workspace-server",
            ws: `ws://${server.hostname}:${server.port}/ws`,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
          },
        )
      },
      websocket: {
        open(ws) {
          ws.send(JSON.stringify({ type: "ready", id: ws.data.id }))
        },
        message(ws, msg) {
          const text = typeof msg === "string" ? msg : msg.toString()
          ws.send(JSON.stringify({ type: "message", id: ws.data.id, text }))
        },
        close() {},
      },
    })

    console.log(`workspace websocket server listening on ws://${server.hostname}:${server.port}/ws`)
    await new Promise(() => {})
  },
})
