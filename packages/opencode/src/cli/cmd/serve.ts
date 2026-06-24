import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptionsNoConfig } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server" as const,
  async handler(args) {
    const { Server } = await import("../../server/server")
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = resolveNetworkOptionsNoConfig(args)
    const server = await Server.listen(opts)
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    // Block forever
    await new Promise(() => {})
  },
})
