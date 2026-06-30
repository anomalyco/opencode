import { EOL } from "node:os"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

const location = { directory: process.cwd() }

export default Runtime.handler(
  Commands.commands.mcp.commands.logout,
  Effect.fn("cli.mcp.logout")(function* (input) {
    const daemon = yield* Daemon.Service
    const client = yield* daemon.client()

    const integrations = yield* Effect.promise(() => client.v2.integration.list({ location }))
    const integration = (integrations.data?.data ?? []).find((entry) => entry.name === input.name)
    if (!integration) return yield* Effect.fail(new Error(`MCP server not found: ${input.name}`))

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
