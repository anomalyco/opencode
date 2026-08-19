import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  // The wrapper in effect-cmd.ts (see `instance: true` branch) runs
  // InstanceBootstrap at startup, which calls `Plugin.init()`. Without it, HTTP
  // serve mode would never materialise the Plugin service (upstream issue
  // anomalyco/opencode#38470). Each per-request `x-opencode-directory` still
  // gets its own InstanceStore.load (and ScopedCache entry) so the ambient cwd
  // is just the warm-up, not a replacement of the per-request semantics.
  //
  // The ambient InstanceContext is intentionally kept alive for the lifetime
  // of the serve (the handler is `Effect.never`, so the disposer in the
  // wrapper's `finally` never runs).
  instance: true,
  directory: () => process.cwd(),
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
