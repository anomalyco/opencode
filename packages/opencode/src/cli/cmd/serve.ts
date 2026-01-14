import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveServerOptions } from "../network"
import * as prompts from "@clack/prompts"
import { Clipboard } from "../../util/clipboard"

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

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
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
    const hostname = server.hostname ?? "localhost"
    const port = server.port ?? 4096
    console.log(`opencode server listening on http://${hostname}:${port}`)
    await showServerDialog({
      hostname,
      port,
      password: opts.auth.password,
    })
    await new Promise(() => {})
    await server.stop()
  },
})
