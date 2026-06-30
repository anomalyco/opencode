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

    // Resolve through the MCP-owned integrationID rather than matching integration names: the shared
    // integration registry also holds provider/plugin integrations, whose names could collide with a server.
    const servers = yield* Effect.promise(() => client.v2.mcp.list({ location }))
    const server = (servers.data?.data ?? []).find((entry) => entry.name === input.name)
    if (!server) return yield* Effect.fail(new Error(`MCP server not found: ${input.name}`))
    const integrationID = server.integrationID
    if (!integrationID) {
      process.stdout.write(`No stored credentials for ${input.name}` + EOL)
      return
    }
    const found = yield* Effect.promise(() => client.v2.integration.get({ integrationID, location }))
    const integration = found.data?.data
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
