import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    try {
      const { IMManager } = await import("@opencode-ai/im-integration")
      const imManager = new IMManager()
      await imManager.initialize()
      await imManager.start()
      console.log("🚀 IM integration initialized")
    } catch (error) {
      console.warn("⚠️  IM integration failed to initialize:", (error as Error).message)
      console.log("   Continuing without IM support...")
    }

    await new Promise(() => {})

    try {
      const imManager = (await import("@opencode-ai/im-integration")).IMManager
      await imManager.stop()
    } catch {}

    await server.stop()
  },
})
