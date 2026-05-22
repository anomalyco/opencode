import { Effect } from "effect"
import { Server } from "../../server/server"
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
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      // ADR-0001: refuse to start in production without a password.  Without one,
      // the opencode HttpApi is publicly reachable (PTY, file API, session creation
      // can be driven by anyone who can reach the URL).  Set OPENCODE_ALLOW_UNAUTHENTICATED=1
      // for the rare cases (single-tenant dev box on a private network) where you
      // genuinely want this disabled — it must be explicit, not the default.
      if (process.env["NODE_ENV"] === "production" && process.env["OPENCODE_ALLOW_UNAUTHENTICATED"] !== "1") {
        console.error(
          "FATAL: OPENCODE_SERVER_PASSWORD is not set in production. " +
            "Refusing to start an unsecured server. " +
            "Set OPENCODE_SERVER_PASSWORD, or set OPENCODE_ALLOW_UNAUTHENTICATED=1 to override.",
        )
        process.exit(1)
      }
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
