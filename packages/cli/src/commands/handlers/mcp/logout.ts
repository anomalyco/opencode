import { EOL } from "node:os"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"
import { resolveIntegration } from "./resolve"

const location = { directory: process.cwd() }

export default Runtime.handler(
  Commands.commands.mcp.commands.logout,
  Effect.fn("cli.mcp.logout")(function* (input) {
    const daemon = yield* Daemon.Service
    const client = yield* daemon.client()

    const integration = yield* resolveIntegration(client, input.name, location)
    if (!integration) {
      process.stdout.write(`No stored credentials for ${input.name}` + EOL)
      return
    }

    const credentials = integration.connections.filter((connection) => connection.type === "credential")
    if (credentials.length === 0) {
      process.stdout.write(`No stored credentials for ${input.name}` + EOL)
      return
    }

    yield* Effect.forEach(
      credentials,
      (connection) => Effect.promise(() => client.v2.credential.remove({ credentialID: connection.id, location })),
      { discard: true },
    )
    process.stdout.write(`Removed OAuth credentials for ${input.name}` + EOL)
  }),
)
