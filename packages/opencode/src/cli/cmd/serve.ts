import { Effect } from "effect"
import { Server } from "../../server/server"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Config } from "../../config/config.js"
import { IntegrationManager } from "../../integration/manager.js"
import { bootstrapIntegrations } from "../../integration/bootstrap.js"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  // Server loads instances per-request via x-opencode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    // Bootstrap integrations (serve mode — no InstanceContext bus, uses HTTP client)
    const config = yield* Config.use.getGlobal()
    const client = createOpencodeClient({ baseUrl: `http://${server.hostname}:${server.port}` })
    const manager = new IntegrationManager(client)
    yield* Effect.promise(() => bootstrapIntegrations(manager, config.integrations))
    yield* Effect.promise(() => manager.startAll())

    yield* Effect.never
  }),
})
