import { Effect } from "effect"
import { Server } from "../../server/server"
import { ServerAuth } from "../../server/auth"
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
    const opts = yield* resolveNetworkOptions(args)
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      if (ServerAuth.requiresPasswordForBind(opts)) {
        console.error(
          `Refusing to bind ${opts.hostname}${opts.mdns ? " (mDNS)" : ""} without authentication.\n` +
            "Set OPENCODE_SERVER_PASSWORD to expose the server on the network, " +
            "or bind 127.0.0.1 for local-only access.",
        )
        return yield* Effect.sync(() => process.exit(1))
      }
      console.log("Warning: AIXPLAIN_CODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
