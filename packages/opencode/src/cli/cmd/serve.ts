import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  // Server loads instances per-request via x-opencode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    // Trap SIGTERM/SIGINT and run the real shutdown path instead of letting
    // Node kill the process outright. `server.stop(true)` closes the root
    // scope, which runs every MCP client finalizer (see mcp/index.ts) and
    // sends SIGTERM to their child processes, e.g. `docker run` containers
    // that would otherwise leak past every restart.
    const shutdown = () => {
      void server.stop(true).finally(() => process.exit(0))
    }
    process.on("SIGTERM", shutdown)
    process.on("SIGINT", shutdown)

    yield* Effect.never
  }),
})
