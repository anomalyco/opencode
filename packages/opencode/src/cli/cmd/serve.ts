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
    // ADR-0001 production-startup gate.  Two valid auth models:
    //   - OPENCODE_SERVER_PASSWORD set (basic auth gate)
    //   - OPENCODE_AUTH_MODE=collab    (OAuth-cookie gate; basic is OFF)
    // Either one in production is enough.  OPENCODE_ALLOW_UNAUTHENTICATED=1
    // overrides both for local dev.
    //
    // Collab mode additionally requires GITHUB_ORG_NAME so the OAuth
    // callback's org-membership probe has something to compare against.
    const authMode = process.env["OPENCODE_AUTH_MODE"] ?? "basic"
    const hasPassword = !!Flag.OPENCODE_SERVER_PASSWORD
    const isCollabMode = authMode === "collab"
    const allowUnauthenticated = process.env["OPENCODE_ALLOW_UNAUTHENTICATED"] === "1"

    if (process.env["NODE_ENV"] === "production" && !allowUnauthenticated) {
      if (!hasPassword && !isCollabMode) {
        console.error(
          "FATAL: no auth configured in production.  Set OPENCODE_SERVER_PASSWORD " +
            "(basic auth) or OPENCODE_AUTH_MODE=collab (OAuth cookie).  Use " +
            "OPENCODE_ALLOW_UNAUTHENTICATED=1 only for private dev boxes.",
        )
        process.exit(1)
      }
      if (isCollabMode && !process.env["GITHUB_ORG_NAME"]) {
        console.error(
          "FATAL: OPENCODE_AUTH_MODE=collab requires GITHUB_ORG_NAME to be set. " +
            "The OAuth callback's org-membership check has nothing to compare against otherwise.",
        )
        process.exit(1)
      }
    } else if (!hasPassword && !isCollabMode) {
      console.log("Warning: no auth configured; server is unsecured (NODE_ENV != production).")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
