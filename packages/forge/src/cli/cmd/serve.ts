import { Server } from "../../server/server"
import { ACPOrchestrator } from "../../acp/orchestrator"
import { cmd } from "./cmd"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) =>
    yargs
      .option("port", {
        alias: ["p"],
        type: "number",
        describe: "port to listen on",
        default: 0,
      })
      .option("hostname", {
        type: "string",
        describe: "hostname to listen on",
        default: "127.0.0.1",
      }),
  describe: "starts a headless forge server",
  handler: async (args) => {
    const hostname = args.hostname
    const port = args.port
    const server = Server.listen({
      port,
      hostname,
    })
    console.log(`forge server listening on http://${server.hostname}:${server.port}`)

    // Cleanup ACP subprocesses on shutdown
    const cleanup = async () => {
      console.log("Cleaning up ACP sessions...")
      await ACPOrchestrator.cleanupAll()
      await server.stop()
      process.exit(0)
    }

    process.on("SIGTERM", cleanup)
    process.on("SIGINT", cleanup)

    await new Promise(() => {})
    await server.stop()
  },
})
