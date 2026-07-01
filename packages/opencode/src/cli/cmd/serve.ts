import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) =>
    withNetworkOptions(yargs).option("shutdown-after-last-client", {
      type: "boolean",
      hidden: true,
      default: false,
    }),
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
    const server = yield* Effect.promise(() =>
      Server.listen({ ...opts, shutdownAfterLastClient: args["shutdown-after-last-client"] }),
    )
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    const idle = server.idle
    if (idle) {
      yield* Effect.promise(() => idle)
      yield* Effect.promise(() => server.stop(true))
      return
    }

    yield* Effect.never
  }),
})
