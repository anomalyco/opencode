import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { TraceLogger } from "../../util/trace-logger"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) =>
    withNetworkOptions(yargs).option("trace-dir", {
      type: "string",
      describe: "directory to save request-response trace logs (also configurable via OPENCODE_TRACE_DIR env variable)",
    }),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    // Initialize trace logger if trace-dir is provided
    if (args.traceDir) {
      TraceLogger.init(args.traceDir)
    }

    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)
    await new Promise(() => {})
    await server.stop()
  },
})
